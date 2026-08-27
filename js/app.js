/* RunStrong — app logic */
'use strict';

/* ================= state & storage ================= */
const DB_KEY = 'runstrong.db';
const SCHEMA_VERSION = 12;
/* Equipment tags an exercise can carry (see EXERCISES[x].equip in program.js).
   Settings toggles default every one of these ON, so a fresh install and every
   existing user see identical swap suggestions until they actually mark
   something unavailable. */
const EQUIP_KEYS = ['barbell', 'dumbbell', 'bench', 'machine', 'cable', 'band', 'box'];
const EQUIP_LABEL = { barbell: 'Barbell', dumbbell: 'Dumbbells', bench: 'Bench', machine: 'Machines', cable: 'Cable stack', band: 'Resistance bands', box: 'Plyo box / step' };
function defaultEquip() { const e = {}; for (const k of EQUIP_KEYS) e[k] = true; return e; }

function defaultState() {
  return {
    schemaVersion: SCHEMA_VERSION,
    settings: { step: WEIGHT_STEP_DEFAULT, barWeight: 20, equip: defaultEquip(), sound: true, vibrate: true, seenInstall: false, disclaimerSeen: false, notifPrimed: false },
    program: buildProgram(),
    sessions: {},          // sessionId (== date) → session record
    runs: {},              // date → {km, min, feel, note}
    fitness: { daily: {}, vo2: {}, skipped: null },  // daily: date→{hrv,rhr}; vo2: date→ml/kg/min; skipped: last skipped date
    strava: { clientId: '', clientSecret: '', tokenUrl: '', auth: null, activities: {}, lastSync: null, includeOther: false },
    weeklySummaries: [],   // archived Sunday summaries (data, not markup)
    races: { geelong: { checklist: {}, result: null, feel: null, note: '', projAtRace: null }, melbourne: { checklist: {}, result: null, feel: null, note: '', projAtRace: null } },
    maintenance: { active: false, startedOn: null, program: 'balanced', mesoStart: null },
    routines: {},          // date → {prep, stretch} — warm-ups and run cool-downs
    soreLog: [],           // [{date, areas: [STRETCH_AREAS ids]}] — from the on-demand stretch picker
    lastBackup: null,      // ts of last JSON export
    activeSessionId: null,
    timer: null,           // {endTs, total, label}
  };
}

const MIGRATIONS = {
  // 1 → 2: program start moved to Thu 2026-08-13 (9-week plan with partial intro week).
  // Rebuild the program; sessions are keyed by date and survive untouched.
  1: (s) => { s.program = buildProgram(); s.schemaVersion = 2; return s; },
  // 2 → 3: run logging + backup nudge fields.
  2: (s) => { s.runs = s.runs || {}; s.lastBackup = s.lastBackup || null; s.schemaVersion = 3; return s; },
  // 3 → 4: HRV / RHR / VO2 max tracking (Garmin morning check-in).
  3: (s) => { s.fitness = s.fitness || { daily: {}, vo2: {}, skipped: null }; s.schemaVersion = 4; return s; },
  // 4 → 5: Strava integration. A full backup of the pre-migration state is written
  // to localStorage 'runstrong.backup.v4' BEFORE the schema changes — recoverable from Settings.
  4: (s) => {
    try { localStorage.setItem('runstrong.backup.v4', JSON.stringify(s)); } catch (e) {}
    s.strava = s.strava || { clientId: '', clientSecret: '', tokenUrl: '', auth: null, activities: {}, lastSync: null, includeOther: false };
    s.schemaVersion = 5; return s;
  },
  // 5 → 6: readiness guidance + stretch + weekly summaries. Purely ADDITIVE:
  // new top-level weeklySummaries[], one settings flag; sessions may gain optional
  // guidance/stretch fields going forward. Existing history untouched.
  5: (s) => {
    s.weeklySummaries = s.weeklySummaries || [];
    s.settings.disclaimerSeen = s.settings.disclaimerSeen || false;
    s.schemaVersion = 6; return s;
  },
  // 6 → 7: race kits + maintenance mode. Additive: races{}, maintenance{}.
  6: (s) => {
    s.races = s.races || { geelong: { checklist: {}, result: null, feel: null, note: '', projAtRace: null }, melbourne: { checklist: {}, result: null, feel: null, note: '', projAtRace: null } };
    s.maintenance = s.maintenance || { active: false, startedOn: null };
    s.schemaVersion = 7; return s;
  },
  // 7 → 8: weight increment default drops 2.5 kg → 1 kg (WEIGHT_STEP_DEFAULT).
  // Anyone still on the old 2.5 default moves to 1 kg; a deliberately chosen
  // 0.5 / 1.25 / 5 is left alone. History is untouched.
  7: (s) => {
    if (!s.settings.step || s.settings.step === 2.5) s.settings.step = WEIGHT_STEP_DEFAULT;
    s.schemaVersion = 8; return s;
  },
  // 8 → 9: warm-up before sessions + cool-down after runs. Additive: one new
  // top-level routines{}, keyed by date → { prep, stretch }. Deliberately NOT
  // stored on ST.runs[date], which saveRun() replaces wholesale. Lift stretches
  // keep living on the session object as before. History untouched.
  8: (s) => {
    s.routines = s.routines || {};
    s.schemaVersion = 9; return s;
  },
  // 9 → 10: plate calculator (bar weight) + equipment-aware swap suggestions.
  // Additive settings only: barWeight defaults to a standard 20 kg Olympic bar,
  // equip defaults every tag ON so existing users see no change in swap
  // ordering until they actually mark something unavailable. History untouched.
  9: (s) => {
    if (s.settings.barWeight == null) s.settings.barWeight = 20;
    s.settings.equip = Object.assign(defaultEquip(), s.settings.equip || {});
    s.schemaVersion = 10; return s;
  },
  // 10 → 11: hypertrophy phase (post-Melbourne, chest & arms priority, 5
  // sessions/week, periodized exercise rotation). Additive: two new fields on
  // the existing maintenance object. `program` defaults to 'balanced' so
  // anyone already in maintenance mode sees no change; `mesoStart` is null
  // until a hypertrophy phase actually starts (see startMaintenance()).
  10: (s) => {
    if (s.maintenance.program == null) s.maintenance.program = 'balanced';
    if (s.maintenance.mesoStart === undefined) s.maintenance.mesoStart = null;
    s.schemaVersion = 11; return s;
  },
  // 11 → 12: RACE_CHECKLIST moved from positional-index keys to stable ids
  // (see program.js) — remap existing checked state using the array's
  // CURRENT order, which is exactly what makes a future reorder safe from
  // here on. Also adds soreLog[] for the area-targeted stretch picker's
  // repeat-pattern note. Additive/remapping only; no history lost.
  11: (s) => {
    for (const key of Object.keys(s.races || {})) {
      const old = s.races[key].checklist || {};
      const remapped = {};
      RACE_CHECKLIST.forEach((item, i) => { if (old[i] != null) remapped[item.id] = old[i]; });
      s.races[key].checklist = remapped;
    }
    s.soreLog = s.soreLog || [];
    s.schemaVersion = 12; return s;
  },
};

function migrate(s) {
  let v = s.schemaVersion || 1;
  while (v < SCHEMA_VERSION) {
    const fn = MIGRATIONS[v];
    if (!fn) break;
    s = fn(s); v = s.schemaVersion;
  }
  s.schemaVersion = SCHEMA_VERSION;
  return s;
}

function loadState() {
  try {
    const raw = localStorage.getItem(DB_KEY);
    if (!raw) return defaultState();
    const s = migrate(JSON.parse(raw));
    if (!s.program) s.program = buildProgram();
    return s;
  } catch (e) {
    console.error('state load failed', e);
    return defaultState();
  }
}

/* Derived-data caches. Declared up here, above save(), on purpose: save() runs
   once at boot to persist migrations, and it clears these — a `let` sitting
   further down the file would still be in its temporal dead zone at that point
   and take the whole app down before the first render. */
let _exHistCache = null, _mergedAllCache = null, _actIndex = null, _actIndexKey = null, _actIndexOther = null;

let ST = loadState();
function save() {
  // Every mutation funnels through here, which makes it the honest place to drop
  // the derived caches — they are rebuilt lazily on the next read.
  invalidateExHistory(); invalidateMergedRuns(); invalidateActivityIndex();
  // Unlike loadState(), this used to have no guard at all: a quota-exceeded
  // device or a private-browsing storage restriction would throw straight out
  // of whatever handler called save() — nearly every mutating handler in the
  // app — losing the set you just logged with no feedback that anything went
  // wrong. toast() only (never alert()) because save() can fire mid-set.
  try {
    localStorage.setItem(DB_KEY, JSON.stringify(ST));
  } catch (e) {
    console.error('save failed', e);
    if (typeof toast === 'function') toast('⚠️ Could not save — device storage may be full. Export a backup and free up space.', 5000);
  }
}
save(); // persist immediately so migrations and first-visit program generation stick

/* ================= helpers ================= */
const $ = sel => document.querySelector(sel);
const APP_VERSION = 'v30';   // keep in step with the sw.js CACHE bump each deploy
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function toast(msg, ms) {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div'); el.id = 'toast';
    // every confirmation in the app goes through here, so this is the one place
    // that decides whether feedback is perceivable without looking at the screen
    el.setAttribute('role', 'status'); el.setAttribute('aria-live', 'polite');
    document.body.appendChild(el);
  }
  el.textContent = msg; el.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove('show'), ms || 3500);
}
/* off-screen announcement for things that are signalled visually only (the
   full-screen rest flash, which is aria-hidden because it's decorative) */
function announce(msg) {
  const el = document.getElementById('live');
  if (!el) return;
  el.textContent = '';
  setTimeout(() => { el.textContent = msg; }, 50);
}

function weekFor(date) {
  return ST.program.weeks.find(w => date >= w.days[0].date && date <= w.days[w.days.length - 1].date) || null;
}
function dayFor(date) {
  const w = weekFor(date);
  return w ? w.days.find(d => d.date === date) : null;
}
function phaseLabel(date) {
  const w = weekFor(date);
  if (!w) return date < ST.program.startDate ? 'Pre-program' : 'Program complete';
  return `Week ${w.num} — ${w.phase}`;
}

/* full history for an exercise variant: [{date, sets:[...]}] oldest→newest, completed sessions only */
/* ---- per-exercise history ----
   This used to re-sort every session key and rescan every session on each call,
   and the Progress → Log view calls it once per exercise in EXERCISES — 54 full
   scans plus 54 array sorts to answer "which lifts have any history?". It was
   the single most expensive thing in the app, and it got worse with every
   session logged.

   One pass now builds the whole exId → visits index. Cache is cleared by save()
   (every mutation goes through it) and again at the top of render(), so it is
   rebuilt at most once per redraw and can never outlive a change to the data.
   Still returns a fresh array per call, exactly as before, so no caller can be
   surprised by a shared reference. */

function invalidateExHistory() { _exHistCache = null; }
function exHistoryIndex() {
  if (_exHistCache) return _exHistCache;
  const idx = new Map();
  for (const id of Object.keys(ST.sessions).sort()) {
    const s = ST.sessions[id];
    if (s.status !== 'done' && id !== ST.activeSessionId) continue;
    for (const e of s.exercises) {
      const sets = e.sets.filter(x => x.done);
      if (!sets.length) continue;
      let arr = idx.get(e.exId);
      if (!arr) { arr = []; idx.set(e.exId, arr); }
      arr.push({ date: s.date, sets });
    }
  }
  _exHistCache = idx;
  return idx;
}
function exHistory(exId, beforeDate) {
  const all = exHistoryIndex().get(exId);
  if (!all) return [];
  return beforeDate ? all.filter(h => h.date < beforeDate) : all.slice();
}

function vibrate(pattern) { if (ST.settings.vibrate && navigator.vibrate) { try { navigator.vibrate(pattern); } catch (e) {} } }

/* audio chime — AudioContext created on first user gesture */
let audioCtx = null;
function ensureAudio() { if (!audioCtx) { try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} } if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume(); }
function chime() {
  if (!ST.settings.sound || !audioCtx) return;
  try {
    const t = audioCtx.currentTime;
    [880, 1100, 880].forEach((f, i) => {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.frequency.value = f; o.type = 'sine';
      g.gain.setValueAtTime(0.0001, t + i * 0.22);
      g.gain.exponentialRampToValueAtTime(0.35, t + i * 0.22 + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.22 + 0.2);
      o.connect(g); g.connect(audioCtx.destination);
      o.start(t + i * 0.22); o.stop(t + i * 0.22 + 0.22);
    });
  } catch (e) {}
}

/* wake lock */
let wakeLock = null;
async function acquireWakeLock() {
  try { if ('wakeLock' in navigator && ST.activeSessionId) wakeLock = await navigator.wakeLock.request('screen'); } catch (e) {}
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') { acquireWakeLock(); tickTimer(); }
});

/* ================= rest timer (timestamp-based) ================= */
let timerInterval = null;
let bgNotifyTimeout = null;
function startRest(seconds, label) {
  ST.timer = { endTs: Date.now() + seconds * 1000, total: seconds, label };
  save();
  runTimerLoop();
  scheduleBgNotify(seconds, label);
}
/* best-effort notification if the app is backgrounded when rest ends.
   Reliable on Android/desktop; iOS suspends JS timers when locked, so there
   the in-app alert fires on reopen instead (timer itself stays accurate). */
function scheduleBgNotify(seconds, label) {
  clearTimeout(bgNotifyTimeout);
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  bgNotifyTimeout = setTimeout(() => {
    if (!document.hidden) return; // foreground alert handles it
    navigator.serviceWorker.ready.then(r =>
      r.showNotification('RunStrong — rest done', {
        body: (label || 'Next set') + ' — go! 💪',
        tag: 'rest-timer', vibrate: [300, 120, 300], icon: 'icons/icon-192.png',
      })).catch(() => {});
  }, seconds * 1000);
}
function runTimerLoop() {
  clearInterval(timerInterval);
  timerInterval = setInterval(tickTimer, 250);
  tickTimer();
}
function tickTimer() {
  const bar = $('#restbar');
  if (!ST.timer) { if (bar) bar.classList.remove('show'); return; }
  const remain = Math.ceil((ST.timer.endTs - Date.now()) / 1000);
  if (remain <= 0) {
    ST.timer = null; save();
    clearInterval(timerInterval);
    if (bar) bar.classList.remove('show');
    fireRestDone();
    return;
  }
  if (bar) {
    bar.classList.add('show');
    $('#restbar-time').textContent = fmtSecs(remain);
    $('#restbar-label').textContent = ST.timer.label || 'Rest';
    const pct = 100 * (1 - remain / ST.timer.total);
    $('#restbar-fill').style.width = pct + '%';
  }
}
function fireRestDone() {
  vibrate([300, 120, 300, 120, 500]);
  chime();
  announce('Rest done — next set');
  const fl = $('#flash');
  fl.classList.add('on');
  setTimeout(() => fl.classList.remove('on'), 1800);
}
function fmtSecs(s) { return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
function skipRest() { ST.timer = null; save(); clearTimeout(bgNotifyTimeout); tickTimer(); }
/* Extending rest is the common need mid-workout; skipping is the rare one. The
   bar surface does this, and skip is an explicit button — the reverse of before,
   when any tap on a 73px full-bleed bar cancelled rest with no undo. */
window.addRest = function (sec) {
  if (!ST.timer) return;
  ST.timer.endTs += sec * 1000;
  ST.timer.total += sec;
  save();
  scheduleBgNotify(Math.ceil((ST.timer.endTs - Date.now()) / 1000), ST.timer.label);
  vibrate(25);
  toast('+' + sec + 's rest');
  tickTimer();
};

/* ---- hold timer for time-based exercises (planks, carries-by-time) ---- */
let holdEnd = null, holdInterval = null;
window.startHold = function () {
  ensureAudio();
  const s = ST.sessions[ST.activeSessionId]; if (!s) return;
  const e = s.exercises[s.curIdx];
  const cur = e.sets.findIndex(t => !t.done); if (cur === -1) return;
  const secs = e.sets[cur].reps || e.tplReps;
  holdEnd = Date.now() + secs * 1000;
  clearInterval(holdInterval);
  holdInterval = setInterval(tickHold, 200);
  const b = document.getElementById('holdbtn'); if (b) b.style.display = 'none';
  tickHold();
};
function tickHold() {
  const el = document.getElementById('holdval');
  if (!holdEnd) { if (el) el.textContent = ''; return; }
  const remain = Math.ceil((holdEnd - Date.now()) / 1000);
  if (remain <= 0) {
    holdEnd = null; clearInterval(holdInterval);
    if (el) el.textContent = '✓ Time!';
    vibrate([300, 120, 300]); chime();
    const b = document.getElementById('holdbtn'); if (b) { b.style.display = ''; b.textContent = '▶ Again (other side?)'; }
    return;
  }
  if (el) el.textContent = remain + 's';
}

/* ================= readiness guidance (green / amber / red) =================
   Everything is relative to YOUR rolling baselines, never absolute values.
   Advisory tone by design; taper/race weeks cap at amber regardless. */
function computeGuidance(date, sore, fat) {
  let score = 0;
  const signals = [];
  // HRV vs personal 14-reading baseline
  const es = fitnessEntries();
  const latest = es[es.length - 1];
  if (latest && latest.hrv != null) {
    const b = hrvBaseline(latest.date);
    if (b.ready) {
      const thr = Math.max(0.75 * b.sd, 4);
      const devPct = Math.round(100 * (latest.hrv - b.mean) / b.mean);
      if (latest.hrv < b.mean - thr) { score += 2; signals.push(`HRV ${Math.abs(devPct)}% below your baseline`); }
      else if (latest.hrv > b.mean) { score -= 1; }
    }
  }
  // resting HR vs baseline
  if (latest && latest.rhr != null) {
    const rb = rhrBaseline(latest.date);
    if (rb.ready && latest.rhr > rb.mean + 5) { score += 1; signals.push(`resting HR ${Math.round(latest.rhr - rb.mean)} bpm over baseline`); }
  }
  if (recoveryDip()) score += 1;
  // soreness / fatigue vs your usual check-in levels
  const past = Object.values(ST.sessions).filter(s => s.readiness).slice(-10).map(s => s.readiness.sore);
  const usualSore = past.length >= 3 ? past.reduce((a, b) => a + b, 0) / past.length : 2.5;
  if (sore >= 4) { score += 2; signals.push(`soreness ${sore}/5${past.length >= 3 ? ` vs your usual ~${usualSore.toFixed(1)}` : ''}`); }
  else if (sore === 3 && sore > usualSore + 0.8) { score += 1; signals.push(`soreness ${sore}/5, above your usual`); }
  if (fat >= 4) { score += 1; signals.push(`fatigue ${fat}/5`); }
  let level = score >= 4 ? 'red' : score >= 2 ? 'amber' : 'green';
  if (sore >= 4 && level === 'green') level = 'amber';   // good HRV never overrides genuinely sore muscles
  let taperCapped = false;
  if (isTaperPhase(date) && level === 'green') { level = 'amber'; taperCapped = true; }
  const reason = signals.length ? signals.join(', ') : 'all recovery markers at or above your baselines';
  const MSG = {
    green: '🟢 You\'re recovered. Push today: go for the top of your rep ranges and take the progression suggestions when they appear.',
    amber: taperCapped
      ? '🟡 Race prep mode: recovery looks good, but this close to race day we keep it crisp — planned weights, nothing to failure, no PR attempts. That\'s the plan working.'
      : '🟡 Middling recovery. Work at the planned weights, stop sets ~2 reps shy of failure, and skip any PR attempts today.',
    red: '🔴 Recovery markers are down. Today should be light — take the lighter workout below, or rest. Rest is a completely fine choice.',
  };
  return { level, score, reason, message: MSG[level], taperCapped };
}

/* ================= sessions ================= */
/* Which progression policy applies on a given day (see PHASE_POLICY in program.js):
   the week's program phase normally, 'deload' when the day is being run reduced
   (readiness downgrade) or during the post-race recovery week, 'maint' in
   maintenance mode. The load side of periodisation is decided by this key. */
function progressionCtx(date, downgrade) {
  if (downgrade) return { phase: 'deload' };
  if (ST.maintenance.active) return { phase: inRecoveryWeek() ? 'deload' : (ST.maintenance.program === 'hypertrophy' ? 'hypertrophy' : 'maint') };
  const w = weekFor(date);
  return { phase: phaseKeyFromLabel(w && w.phase) };
}

/* downgrade: false | 'light' (−1 set, −10% load) | 'red' (−40% volume, −10% load).
   The −10% load now comes from the 'deload' phase policy inside nextPrescription,
   so it is rounded to the user's increment once instead of being multiplied twice. */
function buildSession(date, tplId, downgrade) {
  // materializeTemplate resolves hypertrophy-phase 'ROTATE:<pool>' sentinels
  // into real exIds for this date; every other template has no sentinel and
  // passes through unchanged, so this is safe for every tplId.
  const tpl = materializeTemplate(tplId, date, ST.maintenance.mesoStart);
  const ctx = progressionCtx(date, downgrade);
  const exercises = tpl.items.map(([exId, sets, reps]) => {
    const n = downgrade === 'red' ? Math.max(1, Math.round(sets * 0.6))
            : downgrade ? Math.max(1, sets - 1) : sets;
    const presc = nextPrescription(exId, exHistory(exId, date), ST.settings.step, reps, ctx);
    return {
      exId, origExId: exId, tplSets: n, tplReps: reps,
      prescWeight: presc.weight, prescPhase: presc.phase, prescWarn: presc.warn,
      prescReason: presc.reason + (downgrade === 'red' ? ' Volume also cut 40% for today.' : downgrade ? ' Volume also trimmed a set.' : ''),
      sets: Array.from({ length: n }, () => ({ weight: null, reps: null, rpe: null, note: '', done: false, failed: false, ts: null })),
    };
  });
  return { id: date, date, tpl: tplId, title: tpl.title, status: 'active', downgraded: downgrade || false, phase: ctx.phase, readiness: null, guidance: null, stretch: null, exercises, curIdx: 0, startedTs: Date.now(), finishedTs: null };
}

/* Swapping exercise mid-session used to reassign e.exId unconditionally: any
   sets already logged against the OLD variant stayed in e.sets and were
   silently reattributed to the NEW variant the moment exId changed — quietly
   corrupting the per-variant history the whole progression engine reads from.
   Refusing to swap once a set is logged is the fix — see the matching guard
   on the swap button itself in vSession(), which is what stops this from
   ever being called in that state through normal use. This check stays as
   the real guarantee; the UI guard is the cheap belt.
   Returns true on success, false if refused. */
function swapExercise(sess, idx, newExId) {
  const e = sess.exercises[idx];
  if (e.sets.some(s => s.done)) return false;
  const presc = nextPrescription(newExId, exHistory(newExId, sess.date), ST.settings.step, e.tplReps, progressionCtx(sess.date, sess.downgraded));
  e.exId = newExId;
  e.prescWeight = presc.weight;
  e.prescReason = presc.reason;
  e.prescPhase = presc.phase;
  e.prescWarn = presc.warn;
  e.sets.forEach(s => { s.weight = null; s.reps = null; s.rpe = null; });
  save();
  return true;
}

/* ================= deload radar =================
   Looks across recent sessions (not just the last one) for accumulating fatigue:
   RPE drifting above target 2+ sessions running, readiness scores slipping,
   or the last few runs feeling rough. */
function deloadRadar() {
  const done = Object.keys(ST.sessions).sort().map(k => ST.sessions[k]).filter(s => s.status === 'done');
  const cutoff = dadd(today(), -14);
  const recent = done.filter(s => s.date >= cutoff);
  const signals = [];
  // 1. RPE drift: mean deviation from target, per session, for RPE-targeted
  // exercises. Target is the phase-adjusted one the athlete was shown, so a
  // taper session isn't judged against build-week targets.
  const devs = recent.map(s => {
    const ds = [];
    for (const e of s.exercises) {
      const band = targetRPEForPhase(e.exId, sessionPhase(s));
      if (!band) continue;
      const tgt = (band[0] + band[1]) / 2;
      for (const t of e.sets.filter(x => x.done && x.rpe != null)) ds.push(t.rpe - tgt);
    }
    return ds.length ? ds.reduce((a, b) => a + b, 0) / ds.length : null;
  }).filter(d => d != null);
  if (devs.length >= 2 && devs.slice(-2).every(d => d > 0.5))
    signals.push('RPEs have run above target ' + devs.slice(-2).length + ' sessions straight');
  // 2. readiness slipping: last two readiness checks both poor
  const readies = recent.map(s => s.readiness ? s.readiness.sore + s.readiness.fat : null).filter(r => r != null);
  if (readies.length >= 2 && readies.slice(-2).every(r => r >= 7))
    signals.push('readiness scores are in the red');
  // 3. runs feeling rough
  const runFeels = Object.keys(ST.runs).sort().filter(d => d >= cutoff).map(d => ST.runs[d].feel);
  if (runFeels.slice(-3).filter(f => f === 'rough').length >= 2)
    signals.push('recent runs have felt rough');
  // 4. sustained HRV/RHR recovery dip (conservative: 3+ consecutive mornings, never single-day)
  const dip = recoveryDip();
  if (dip) signals.push(dip);
  if (!signals.length) return null;
  return 'Fatigue is stacking up: ' + signals.join(', ') + '. Consider the lighter version of your next workout — running comes first.';
}

/* ================= rendering ================= */
const APP = $('#app');
let view = { name: 'home' };
let whyOpen = false;   // in-session "why this helps" expander (transient, resets per exercise)
let howtoOpen = false; // in-session "how to" step list expander (transient, resets per exercise)

/* progression policy key a session was built under (older sessions predate the field) */
function sessionPhase(s) {
  if (s && s.phase) return s.phase;
  return progressionCtx(s ? s.date : today(), s && s.downgraded).phase;
}

/* taper/race phases get a phase-aware insight line instead of a "build" message */
function isTaperPhase(date) {
  const w = weekFor(date);
  return !!w && /taper|race week/i.test(w.phase);
}

function go(name, params) {
  // a nav tap should always win: close any open prompt sheet (it re-offers next app open)
  const m = $('#modal');
  if (m && m.classList.contains('open')) { m.classList.remove('open'); m.innerHTML = ''; }
  view = Object.assign({ name }, params);
  // Views are pure JS state, so without this the Android hardware Back button
  // has nothing to pop and leaves the app — mid-workout if you're unlucky.
  try { history.pushState({ view }, ''); } catch (e) {}
  render();
  // The plan is nine weeks tall (~3300px). Landing on Week 1 means scrolling to
  // find today, and that gets worse every week of the block.
  if (name === 'schedule') {
    const cur = document.querySelector('.wk.cur');
    if (cur) { window.scrollTo(0, Math.max(0, cur.getBoundingClientRect().top + window.scrollY - 12)); return; }
  }
  window.scrollTo(0, 0);
}

let elapsedInterval = null;
function render() {
  // 'history' and 'trends' stay mapped as aliases of the merged Progress tab so any
  // older deep link (or a stale service-worker page) still lands somewhere sensible.
  const views = { home: vHome, schedule: vSchedule, session: vSession, summary: vSummary, exdetail: vExDetail, settings: vSettings, stretch: vStretch, progress: vProgress, history: vProgress, trends: vProgress };
  invalidateMergedRuns(); invalidateExHistory();   // one build per render, never a stale one
  const keepScroll = view.name === 'session' ? window.scrollY : null;   // logging a set must not move the page
  // a crashing view must never leave the app silently frozen — show what broke instead
  try {
    APP.innerHTML = (views[view.name] || vHome)();
  } catch (err) {
    APP.innerHTML = `<header class="top"><div class="phase">Something broke</div></header>
      <main><div class="card deload"><div class="card-kicker">⚠️ This screen hit an error</div>
        <div class="card-sub" style="user-select:text;-webkit-user-select:text">${esc(err.message)}${err.stack ? `<br><span class="dim small">${esc(String(err.stack).split('\n').slice(0, 2).join(' · ').slice(0, 200))}</span>` : ''}</div>
        <div class="card-sub dim">Your data is safe. Screenshot this and send it to Dan's assistant. 🙂</div>
        <button class="btn primary big" onclick="go('home')">Back to Today</button></div>
      </main>${navBar()}`;
  }
  // sheets float above the tab bar on tabbar views so nav stays tappable
  document.body.classList.toggle('has-tabbar', view.name !== 'session' && view.name !== 'stretch');
  bindNav();
  if (keepScroll !== null) window.scrollTo(0, keepScroll);
  // live session clock (⏱ elapsed) — one lightweight interval while a workout is on screen
  clearInterval(elapsedInterval);
  if (view.name === 'session' && ST.activeSessionId) {
    elapsedInterval = setInterval(() => {
      const s = ST.sessions[ST.activeSessionId];
      const el = document.getElementById('sess-elapsed');
      if (!s || s.status !== 'active' || !el) { clearInterval(elapsedInterval); return; }
      el.textContent = fmtElapsed(Date.now() - s.startedTs);
    }, 1000);
  }
}
function fmtElapsed(ms) {
  const s = Math.floor(ms / 1000);
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

function bindNav() {
  const NAV_OF = { exdetail: 'progress', history: 'progress', trends: 'progress' };
  document.querySelectorAll('[data-nav]').forEach(b => {
    const on = b.dataset.nav === (NAV_OF[view.name] || view.name);
    b.classList.toggle('active', on);
    if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
}

function navBar() {
  return `<nav class="tabbar">
    <button data-nav="home" onclick="go('home')"><span>🏠</span>Today</button>
    <button data-nav="schedule" onclick="go('schedule')"><span>📅</span>Plan</button>
    <button data-nav="progress" onclick="go('progress')"><span>📈</span>Progress</button>
    <button data-nav="settings" onclick="go('settings')"><span>⚙️</span>Settings</button>
  </nav>`;
}

function raceCountdowns() {
  if (ST.maintenance.active) return ''; // race clocks retired
  return `<div class="races">` + RACES.map(r => {
    const d = daysUntil(r.date);
    const st = ST.races[r.key];
    const txt = st.result ? `✓ ${st.result}` : d > 0 ? `${d} day${d === 1 ? '' : 's'}` : d === 0 ? 'TODAY 🏁' : 'done ✓';
    return `<div class="race ${r.tag === 'A race' ? 'arace' : ''}"><div class="race-name">${r.name}</div><div class="race-tag">${r.tag}</div><div class="race-count">${txt}</div></div>`;
  }).join('') + `</div>`;
}

/* race-week / post-race cards for the home screen */
function raceExtraCards() {
  if (ST.maintenance.active) return '';
  let out = '';
  const rw = activeRaceWeek();
  if (rw) {
    const r = raceInfo(rw); const st = raceState(rw);
    const done = Object.values(st.checklist).filter(Boolean).length;
    out += `<div class="card racekit" onclick="openChecklist('${rw}')"><div class="card-kicker">🏁 ${esc(r.name)} — race week</div><div class="card-sub">Checklist: ${done} of ${RACE_CHECKLIST.length} ticked. Tap to open.</div></div>`;
  }
  const ur = unloggedPastRace();
  if (ur) {
    const r = raceInfo(ur);
    out += `<div class="card racekit"><div class="card-kicker">🏁 ${esc(r.name)} — how did it go?</div><div class="card-sub">Log your time and it'll sit next to what the app projected.</div><button class="btn primary big" onclick="openRaceResult('${ur}')">Log result</button></div>`;
  }
  for (const r of RACES) {
    const st = raceState(r.key);
    const d = daysUntil(r.date);
    if (st.result && d < 0 && d >= -7) {
      out += `<div class="card"><div class="card-kicker">🏁 ${esc(r.name)} result</div><div class="card-sub">${st.projAtRace ? `Projected ${esc(st.projAtRace)} → ran <b>${esc(st.result)}</b>.` : `Ran <b>${esc(st.result)}</b>.`}${st.feel ? ` Felt ${esc(st.feel)}.` : ''}${r.key === 'melbourne' ? ` <button class="mini" onclick="offerRecoveryMode()">What now?</button>` : ''}</div></div>`;
    }
  }
  return out;
}

/* ---------- streak / consistency ----------
   "Any day with a lift or a run" rather than "every prescribed day hit" —
   the plan already has built-in rest and taper days, so a streak tied to the
   schedule would break by design every single week. This tracks showing up,
   not adherence to a specific plan slot. */
function activityDates() {
  const set = new Set();
  for (const id in ST.sessions) if (ST.sessions[id].status === 'done') set.add(ST.sessions[id].date);
  for (const d in mergedRunsAll()) set.add(d);
  return set;
}
function currentStreak() {
  const dates = activityDates();
  let d = today();
  // Today not logged yet doesn't break the streak — the day isn't over.
  if (!dates.has(d)) d = dadd(d, -1);
  let n = 0;
  while (dates.has(d)) { n++; d = dadd(d, -1); }
  return n;
}
/* Longest run of consecutive activity dates ever, not just the live one —
   currentStreak() answers "am I on one right now", this answers "what's the
   best I've done", which needs the whole history rather than a walk back
   from today. */
function longestStreak() {
  const dates = [...activityDates()].sort();
  if (!dates.length) return 0;
  let best = 1, cur = 1;
  for (let i = 1; i < dates.length; i++) {
    cur = dadd(dates[i - 1], 1) === dates[i] ? cur + 1 : 1;
    best = Math.max(best, cur);
  }
  return best;
}
const STREAK_DAYS = 35;
function streakHeatmap() {
  const dates = activityDates();
  const streak = currentStreak();
  const best = longestStreak();
  let cells = '';
  for (let i = STREAK_DAYS - 1; i >= 0; i--) {
    const d = dadd(today(), -i);
    const on = dates.has(d);
    cells += `<div class="heat-cell ${on ? 'on' : ''} ${d === today() ? 'istoday' : ''}" title="${esc(fmtDate(d))}${on ? ' — trained' : ''}"></div>`;
  }
  const kicker = streak > 0
    ? `${streak}-day streak${best > streak ? ` · best ${best}` : ''}`
    : (best > 0 ? `Start a streak · best ${best}` : 'Start a streak');
  return `<div class="card streak">
    <div class="card-kicker">🔥 ${esc(kicker)}</div>
    <div class="card-sub">${streak > 0 ? 'A lift or a run, any day, keeps it alive.' : 'Log a lift or a run today to start one.'}</div>
    <div class="heatmap">${cells}</div>
  </div>`;
}

/* ---------- Home / Today ---------- */
function vHome() {
  const t = today();
  const day = dayFor(t);
  const phase = ST.maintenance.active ? (inRecoveryWeek() ? 'Recovery week' : (ST.maintenance.program === 'hypertrophy' ? 'Hypertrophy phase' : 'Maintenance')) : phaseLabel(t);
  let card = '';
  const active = ST.activeSessionId && ST.sessions[ST.activeSessionId];
  if (ST.maintenance.active && !(active && active.status === 'active')) {
    const hasData2 = Object.values(ST.sessions).some(s => s.status === 'done') || Object.keys(ST.runs).length > 0;
    const backupDue2 = hasData2 && (!ST.lastBackup || Date.now() - ST.lastBackup > 7 * 86400000);
    const backupCard2 = backupDue2 ? `<div class="card backup"><div class="card-sub">💾 ${ST.lastBackup ? "It's been over a week since your last backup." : 'No backup yet.'} Data lives only on this device.</div><button class="btn" onclick="exportJSON();render()">Export backup now</button></div>` : '';
    return `<header class="top"><h1 class="phase">${esc(phase)}</h1></header>
      <main>${maintenanceCard()}${streakHeatmap()}${backupCard2}${soreSpotBtn()}</main>${navBar()}${installBanner()}`;
  }
  if (active && active.status === 'active') {
    card = `<div class="card action" onclick="go('session')">
      <div class="card-kicker">Workout in progress</div>
      <div class="card-title">${esc(active.title)}</div>
      <div class="card-sub">Tap to continue — your place is saved</div>
      <button class="btn primary big">Resume workout</button></div>`;
  } else if (!day) {
    card = t < ST.program.startDate
      ? `<div class="card"><div class="card-title">Program starts ${fmtDate(ST.program.startDate)}</div><div class="card-sub">Browse the plan meanwhile 👇</div></div>`
      : `<div class="card"><div class="card-title">Program complete 🎉</div><div class="card-sub">Hope Melbourne went fast.</div><button class="btn primary big" onclick="offerRecoveryMode()">What's next?</button></div>`;
  } else if (day.kind === 'lift') {
    const done = ST.sessions[t] && ST.sessions[t].status === 'done';
    card = done
      ? `<div class="card"><div class="card-kicker">Done today ✓</div><div class="card-title">${esc(day.title)}</div><button class="btn" onclick="event.stopPropagation();go('summary',{sid:'${t}'})">View summary</button></div>`
      : `<div class="card action">
          <div class="card-kicker">Today's lift · ~${TEMPLATES[day.tpl].est} min</div>
          <div class="card-title">${esc(day.title)}</div>
          <div class="card-sub">${TEMPLATES[day.tpl].items.map(i => esc(EXERCISES[i[0]].name)).join(' · ')}</div>
          <button class="btn primary big" onclick="openReadiness('${t}','${day.tpl}')">Start workout</button></div>`;
  } else if (day.kind === 'run' || day.kind === 'race') {
    const mr = mergedRunFor(t);
    const skippedManual = ST.runs[t] && ST.runs[t].skipped && !stravaRunOn(t);
    /* Warm-up before the run, cool-down after it — the card only ever shows the
       one that's next, so "Log this run" never gets pushed down the screen.
       The warm-up is mobility only: no jog, no strides. */
    const prepBtn = `<button class="btn" onclick="startRunPrep('${t}')">🔥 ${routineDone(t, 'prep') ? 'Warm up again' : `Warm up — ${runPrepMins(day)} min`}</button>`;
    const coolBtn = `<button class="btn big" onclick="offerRunStretch('${t}')">🧘 ${routineDone(t, 'stretch') ? 'Stretch again' : 'Cool down'}</button>`;
    const logged = mr
      ? `<div class="run-logged">✓ ${mr.src !== 'manual' ? `<span class="svbadge ${mr.src}">${mr.src}</span> ${esc(mr.name || 'Run')} — ` : ''}${mr.km} km · ${mr.min} min · ${paceStr(mr.km, mr.min) || ''}${mr.hr ? ` · ${mr.hr} bpm` : ''}${mr.feel ? ` · felt ${mr.feel}` : ''}${mr.note ? ` · 📝 ${esc(mr.note)}` : ''}</div>
         ${coolBtn}<button class="mini" onclick="openRunLog('${t}')">${mr.feel ? 'edit' : 'add feel'}</button>`
      : skippedManual
        ? `<div class="run-logged dim">✗ skipped</div><button class="mini" onclick="openRunLog('${t}')">log anyway</button>`
        : `${prepBtn}<button class="btn big" onclick="openRunLog('${t}')">🏃 Log this run</button>`;
    const raceHere = day.kind === 'race' ? RACES.find(r => r.date === t) : null;
    const raceBtn = raceHere && !ST.races[raceHere.key].result ? `<button class="btn big" onclick="openRaceResult('${raceHere.key}')" style="margin-top:8px">🏁 Log official result</button>` : '';
    card = `<div class="card run"><div class="card-kicker">${day.kind === 'race' ? 'RACE DAY' : "Today's run"}</div><div class="card-title">${esc(day.title)}</div><div class="card-sub">${esc(day.sub || '')}</div><div class="card-sub dim">No lifting today — running is the priority.</div>${logged}${raceBtn}</div>`;
  } else {
    card = `<div class="card"><div class="card-title">${esc(day.title || 'Rest')}</div><div class="card-sub">${esc(day.sub || 'Recovery is training too.')}</div></div>`;
  }
  const radar = deloadRadar();
  const radarCard = radar ? `<div class="card deload"><div class="card-kicker">⚠️ Deload radar</div><div class="card-sub">${esc(radar)}</div></div>` : '';
  // Runs older than yesterday used to be a queue of modal sheets on every launch.
  // They're a card you can ignore now — the data still matters (pace trend, deload
  // radar), but not enough to stand between you and today's workout.
  const backlog = unloggedRuns().filter(d => d < dadd(t, -1));
  const backlogCard = backlog.length ? `<div class="card">
      <div class="card-kicker">🏃 ${backlog.length} run${backlog.length === 1 ? '' : 's'} not logged</div>
      <div class="card-sub">Oldest is ${fmtDate(backlog[0])}. Logging them keeps your pace trend and the deload radar honest.</div>
      <button class="btn" onclick="openRunLog('${backlog[0]}')">Log ${fmtDate(backlog[0])}</button>
      ${backlog.length > 1 ? `<button class="linkbtn" onclick="go('schedule')">See all ${backlog.length} in Plan</button>` : ''}
    </div>` : '';
  const hasData = Object.values(ST.sessions).some(s => s.status === 'done') || Object.keys(ST.runs).length > 0;
  const backupDue = hasData && (!ST.lastBackup || Date.now() - ST.lastBackup > 7 * 86400000);
  const backupCard = backupDue ? `<div class="card backup"><div class="card-sub">💾 ${ST.lastBackup ? "It's been over a week since your last backup." : 'No backup yet.'} Data lives only on this device.</div><button class="btn" onclick="exportJSON();render()">Export backup now</button></div>` : '';
  const whyBtn = `<button class="linkbtn" onclick="showWhy()">Why this plan?</button>`;
  return `<header class="top"><h1 class="phase">${esc(phase)}</h1>${raceCountdowns()}</header>
    <main>${raceExtraCards()}${radarCard}${card}${streakHeatmap()}${upNext(t)}${backlogCard}${backupCard}${soreSpotBtn()}${whyBtn}</main>${navBar()}${installBanner()}`;
}
/* Reachable from Home no matter the program state or whether a session is
   active — the whole point is "I'm sore right now," not "after my workout." */
function soreSpotBtn() { return `<button class="linkbtn" onclick="openSoreSpot()">🧘 Sore somewhere? Stretch it out</button>`; }

/* ---------- run logging ---------- */
function paceStr(km, min) {
  if (!km || !min) return null;
  const s = Math.round(min * 60 / km);
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0') + ' /km';
}
function fmtSplit(sec) { return Math.floor(sec / 60) + ':' + String(Math.round(sec % 60)).padStart(2, '0'); }
function parseSplit(str) {
  str = str.trim(); if (!str) return null;
  if (str.includes(':')) { const [m, s] = str.split(':').map(Number); return (isNaN(m) || isNaN(s)) ? null : m * 60 + s; }
  const v = parseFloat(str); return isNaN(v) ? null : Math.round(v * 60); // bare number = minutes
}
function isHardRun(date) { const d = dayFor(date); return d && d.title === 'Hard Run'; }

window.openRunLog = function (date) {
  const day = dayFor(date);
  const sr = stravaRunOn(date);
  if (sr) {   // Strava already has the numbers — just capture how it felt (feeds the deload radar)
    const mr = ST.runs[date] || {};
    const m = $('#modal');
    m.innerHTML = `<div class="sheet"><h2>${esc(sr.name || 'Run')} — ${fmtDate(date)} <span class="svbadge ${sr.src || 'strava'}">${sr.src || 'strava'}</span></h2>
      <div class="pace-line">${sr.km} km · ${sr.movingMin} min · <b>${paceStr(sr.km, sr.movingMin) || '—'}</b>${sr.avgHr ? ` · ${sr.avgHr} bpm` : ''}${sr.elevM ? ` · ${sr.elevM} m↑` : ''}</div>
      <div class="stepper"><div class="stepper-lbl">How did it feel?</div><div class="rpes">
        ${['good', 'ok', 'rough'].map(f => `<button class="rpe feel ${mr.feel === f ? 'sel' : ''}" data-f="${f}" onclick="pickFeel('${f}')">${f === 'good' ? '😀 good' : f === 'ok' ? '😐 ok' : '😖 rough'}</button>`).join('')}</div></div>
      <input id="runnote" class="notefield" placeholder="Notes (optional)" value="${esc(mr.note || '')}">
      <button class="btn primary big" onclick="saveStravaFeel('${date}')">Save</button>
      <button class="linkbtn" onclick="closeModal()">Cancel</button></div>`;
    m.classList.add('open');
    m.dataset.feel = mr.feel || '';
    return;
  }
  const r = ST.runs[date] && !ST.runs[date].skipped ? ST.runs[date] : { km: day && day.title === 'Long Run' ? 20 : day && (day.kind === 'race') ? 21.1 : day && day.title === 'Hard Run' ? 10 : 8, min: 60, feel: null, note: '', hr: '', splits: [] };
  const hard = isHardRun(date);
  const m = $('#modal');
  m.innerHTML = `<div class="sheet"><h2>${esc(day ? day.title : 'Run')} — ${fmtDate(date)}</h2>
    <div class="stepper"><div class="stepper-lbl">Distance (km)</div><div class="stepper-row">
      <button class="stepbtn" onclick="runStep('km',-0.5)">−</button><div class="stepval" id="rv-km">${r.km}</div><button class="stepbtn" onclick="runStep('km',0.5)">+</button></div></div>
    <div class="stepper"><div class="stepper-lbl">Time (minutes)</div><div class="stepper-row">
      <button class="stepbtn" onclick="runStep('min',-5)">−</button><div class="stepval" id="rv-min">${r.min}</div><button class="stepbtn" onclick="runStep('min',5)">+</button></div></div>
    <div class="pace-line">Average pace: <b id="rv-pace">${paceStr(r.km, r.min) || '—'}</b></div>
    ${hard ? `<div class="stepper"><div class="stepper-lbl">Interval splits (one per rep, e.g. 4:32)</div>
      <div id="splitlist">${(r.splits || []).map(s => `<input class="notefield splitfield" inputmode="numeric" placeholder="4:32" value="${fmtSplit(s)}">`).join('')}</div>
      <button class="mini" onclick="addSplit()">+ add split</button></div>` : ''}
    <div class="stepper"><div class="stepper-lbl">Average heart rate (bpm, optional)</div>
      <input id="runhr" class="notefield" type="number" inputmode="numeric" placeholder="e.g. 152" value="${r.hr || ''}"></div>
    <div class="stepper"><div class="stepper-lbl">How did it feel?</div><div class="rpes">
      ${['good', 'ok', 'rough'].map(f => `<button class="rpe feel ${r.feel === f ? 'sel' : ''}" data-f="${f}" onclick="pickFeel('${f}')">${f === 'good' ? '😀 good' : f === 'ok' ? '😐 ok' : '😖 rough'}</button>`).join('')}</div></div>
    <input id="runnote" class="notefield" placeholder="Notes (optional)" value="${esc(r.note)}">
    <button class="btn primary big" onclick="saveRun('${date}')">Save run</button>
    <button class="linkbtn" onclick="skipRun('${date}')">I didn't do this run</button>
    <button class="linkbtn" onclick="closeModal()">Cancel</button></div>`;
  m.classList.add('open');
  m.dataset.km = r.km; m.dataset.min = r.min; m.dataset.feel = r.feel || '';
};
window.addSplit = function () {
  $('#splitlist').insertAdjacentHTML('beforeend', `<input class="notefield splitfield" inputmode="numeric" placeholder="4:32">`);
  const f = [...document.querySelectorAll('.splitfield')].pop(); f.focus();
};
window.runStep = function (id, d) {
  const m = $('#modal');
  const v = Math.max(0, Math.round((parseFloat(m.dataset[id]) + d) * 10) / 10);
  m.dataset[id] = v;
  $('#rv-' + id).textContent = v;
  const p = $('#rv-pace'); if (p) p.textContent = paceStr(parseFloat(m.dataset.km), parseFloat(m.dataset.min)) || '—';
};
window.pickFeel = function (f) {
  $('#modal').dataset.feel = f;
  document.querySelectorAll('.rpe.feel').forEach(b => b.classList.toggle('sel', b.dataset.f === f));
};
window.saveRun = function (date) {
  const m = $('#modal');
  if (!m.dataset.feel) { toast('Tap how it felt — it feeds the deload radar.'); return; }
  const splits = [...document.querySelectorAll('.splitfield')].map(f => parseSplit(f.value)).filter(s => s != null);
  const hr = parseInt($('#runhr').value, 10);
  ST.runs[date] = { km: parseFloat(m.dataset.km), min: parseFloat(m.dataset.min), feel: m.dataset.feel, note: $('#runnote').value.trim(), hr: isNaN(hr) ? null : hr, splits };
  save(); closeModal(); render();
  // deliberately does NOT chain to the next unlogged run — the backlog lives on
  // the Today card instead, so logging one run never opens another sheet
};
window.saveStravaFeel = function (date) {
  const m = $('#modal');
  if (!m.dataset.feel) { toast('Tap how it felt — it feeds the deload radar.'); return; }
  const sr = stravaRunOn(date);
  ST.runs[date] = { km: sr.km, min: sr.movingMin, hr: sr.avgHr || null, feel: m.dataset.feel, note: ($('#runnote')?.value || '').trim(), splits: [], fromStrava: true };
  save(); closeModal(); render();
};
window.skipRun = function (date) {
  ST.runs[date] = { skipped: true };
  save(); closeModal(); render();
};

/* ================= Strava integration =================
   Fully client-side: credentials live ONLY in this device's storage; calls go
   browser → Strava directly. Everything degrades gracefully offline — a failed
   sync never touches the strength log. Optional tokenUrl supports a proxy
   (Cloudflare Worker) if the browser ever hits CORS on the token endpoint. */
const STRAVA_TOKEN_URL = 'https://www.strava.com/api/v3/oauth/token';
const STRAVA_API = 'https://www.strava.com/api/v3';

function stravaConnected() { return !!(ST.strava && ST.strava.auth && ST.strava.auth.refresh_token); }
function stravaRedirectUri() { return location.origin + location.pathname; }

window.stravaConnect = function () {
  const c = ST.strava;
  c.clientId = $('#sv-id').value.trim();
  c.clientSecret = $('#sv-secret').value.trim();
  c.tokenUrl = ($('#sv-proxy')?.value || '').trim();
  save();
  if (!c.clientId || !c.clientSecret) { toast('Enter your Strava Client ID and Client Secret first.'); return; }
  const u = new URL('https://www.strava.com/oauth/authorize');
  u.search = new URLSearchParams({
    client_id: c.clientId, redirect_uri: stravaRedirectUri(), response_type: 'code',
    scope: 'activity:read_all', approval_prompt: 'auto', state: 'runstrong',
  });
  location.href = u.toString();
};
window.stravaDisconnect = function () {
  ST.strava.auth = null; ST.strava.activities = {}; ST.strava.lastSync = null;
  invalidateActivityIndex();
  save(); render(); toast('Strava disconnected. Synced runs removed; your strength log is untouched.');
};
async function stravaTokenRequest(params) {
  const c = ST.strava;
  const body = new URLSearchParams({ client_id: c.clientId, client_secret: c.clientSecret, ...params });
  const r = await fetch(c.tokenUrl || STRAVA_TOKEN_URL, { method: 'POST', body });
  if (!r.ok) throw new Error('token ' + r.status);
  return r.json();
}
async function stravaHandleCallback() {
  const q = new URLSearchParams(location.search);
  if (!q.get('code') || q.get('state') !== 'runstrong') return false;
  history.replaceState({}, '', location.pathname);      // clean the URL either way
  try {
    const d = await stravaTokenRequest({ grant_type: 'authorization_code', code: q.get('code') });
    ST.strava.auth = { access_token: d.access_token, refresh_token: d.refresh_token, expires_at: d.expires_at, athlete: d.athlete ? { id: d.athlete.id, name: (d.athlete.firstname || '') + ' ' + (d.athlete.lastname || '') } : null };
    save();
    toast('✓ Strava connected' + (ST.strava.auth.athlete ? ' as ' + ST.strava.auth.athlete.name : '') + ' — syncing runs…');
    await stravaSync(true);
    return true;
  } catch (e) {
    toast('Strava connect failed (' + e.message + '). If this keeps happening it is likely CORS — see Settings for the proxy option.', 6000);
    return false;
  }
}
async function stravaToken() {
  const a = ST.strava.auth;
  if (!a) throw new Error('not connected');
  if (a.expires_at * 1000 > Date.now() + 5 * 60 * 1000) return a.access_token;
  const d = await stravaTokenRequest({ grant_type: 'refresh_token', refresh_token: a.refresh_token });
  ST.strava.auth = { ...a, access_token: d.access_token, refresh_token: d.refresh_token, expires_at: d.expires_at };
  save();
  return d.access_token;
}
/* sync last 6 weeks of activities; cached by id; auto-sync at most every 6h (rate-limit friendly) */
let stravaSyncing = false;
async function stravaSync(force) {
  if (!stravaConnected() || stravaSyncing) return;
  if (!force && ST.strava.lastSync && Date.now() - ST.strava.lastSync < 6 * 3600 * 1000) return;
  stravaSyncing = true;
  try {
    const token = await stravaToken();
    const after = Math.floor((Date.now() - 42 * 86400 * 1000) / 1000);
    const r = await fetch(`${STRAVA_API}/athlete/activities?after=${after}&per_page=100`, { headers: { Authorization: 'Bearer ' + token } });
    if (!r.ok) throw new Error('api ' + r.status);
    const acts = await r.json();
    let added = 0;
    for (const a of acts) {
      const rec = {
        id: a.id, name: a.name, type: a.type,
        date: (a.start_date_local || a.start_date || '').slice(0, 10),
        km: Math.round((a.distance || 0) / 10) / 100,
        movingMin: Math.round((a.moving_time || 0) / 60),
        elevM: Math.round(a.total_elevation_gain || 0),
        avgHr: a.average_heartrate ? Math.round(a.average_heartrate) : null,
        effort: a.suffer_score || null,
      };
      if (!ST.strava.activities[a.id]) added++;
      ST.strava.activities[a.id] = rec;
    }
    // drop cached activities older than 8 weeks (keeps storage lean)
    const cutoff = dadd(today(), -56);
    for (const id of Object.keys(ST.strava.activities)) if (ST.strava.activities[id].date < cutoff) delete ST.strava.activities[id];
    ST.strava.lastSync = Date.now();
    invalidateActivityIndex();
    save();
    if (force) toast(`Strava sync ✓ — ${acts.length} activities (${added} new).`);
    render();
  } catch (e) {
    if (force) toast('Strava sync failed (' + e.message + '). The app works fine without it — try again later.', 5000);
  } finally { stravaSyncing = false; }
}
window.stravaSyncNow = () => stravaSync(true);

/* ---- Garmin Connect CSV import: same activities store, no API, no subscription ----
   Garmin Connect → Activities → All Activities → Export CSV. Re-imports dedupe by date+distance. */
function parseCSV(text) {
  const rows = []; let row = [], field = '', inQ = false;
  text = text.replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(field); field = ''; if (row.some(f => f.trim() !== '')) rows.push(row); row = []; }
      else field += c;
    }
  }
  row.push(field);
  if (row.some(f => f.trim() !== '')) rows.push(row);
  return rows;
}
function gNum(s) {
  s = String(s ?? '').trim(); if (!s || s === '--') return null;
  if (s.includes(',') && !s.includes('.')) s = s.replace(',', '.');   // decimal-comma locales
  const v = parseFloat(s.replace(/,/g, ''));
  return isNaN(v) ? null : v;
}
function gMins(s) {
  s = String(s ?? '').trim(); if (!s || s === '--') return null;
  const parts = s.split(':').map(Number);
  if (parts.some(isNaN)) return null;
  if (parts.length === 3) return Math.round(parts[0] * 60 + parts[1] + parts[2] / 60);
  if (parts.length === 2) return Math.round(parts[0] + parts[1] / 60);
  return Math.round(parts[0]);
}
function importGarminText(text) {
  const rows = parseCSV(text);
  if (rows.length < 2) return { added: 0, dupes: 0, skipped: 0, error: 'No data rows found in that file.' };
  const head = rows[0].map(h => h.toLowerCase().trim());
  const col = (...names) => { for (const n of names) { const i = head.findIndex(h => h === n || h.includes(n)); if (i >= 0) return i; } return -1; };
  const iType = col('activity type'), iDate = col('date'), iTitle = col('title', 'name'),
        iDist = col('distance'), iTimeMv = col('moving time'), iTime = head.findIndex(h => h === 'time'),
        iHr = col('avg hr', 'average heart rate', 'avg heart'), iAsc = col('total ascent', 'elev gain', 'elevation gain');
  if (iDate < 0 || iDist < 0) return { added: 0, dupes: 0, skipped: 0, error: 'That does not look like a Garmin Connect activities CSV (no Date/Distance columns).' };
  let added = 0, dupes = 0, skipped = 0;
  for (const r of rows.slice(1)) {
    const typeRaw = iType >= 0 ? (r[iType] || '').trim() : 'Running';
    const isRun = /running/i.test(typeRaw) && !/virtual/i.test(typeRaw);
    const date = (r[iDate] || '').trim().slice(0, 10);
    const km = gNum(r[iDist]);
    const min = gMins(iTimeMv >= 0 ? r[iTimeMv] : (iTime >= 0 ? r[iTime] : null));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !km || !min) { skipped++; continue; }
    if (!isRun && !ST.strava.includeOther) { skipped++; continue; }
    const id = 'g' + date + '-' + km.toFixed(2);
    if (ST.strava.activities[id]) { dupes++; continue; }
    ST.strava.activities[id] = {
      id, src: 'garmin', name: (iTitle >= 0 && r[iTitle]) ? r[iTitle].trim() : (isRun ? 'Run' : typeRaw),
      type: isRun ? 'Run' : typeRaw, date, km: Math.round(km * 100) / 100, movingMin: min,
      avgHr: iHr >= 0 ? (gNum(r[iHr]) ? Math.round(gNum(r[iHr])) : null) : null,
      elevM: iAsc >= 0 ? Math.round(gNum(r[iAsc]) || 0) : 0, effort: null,
    };
    added++;
  }
  const cutoff = dadd(today(), -56);
  for (const id of Object.keys(ST.strava.activities)) if (ST.strava.activities[id].date < cutoff) delete ST.strava.activities[id];
  ST.strava.lastSync = Date.now();
  invalidateActivityIndex();
  save(); render();
  return { added, dupes, skipped };
}
window.importGarminFile = function (input) {
  const f = input.files[0]; if (!f) return;
  const rd = new FileReader();
  rd.onload = () => {
    const res = importGarminText(rd.result);
    if (res.error) { toast(res.error, 5500); return; }
    toast(`Garmin import ✓ — ${res.added} new run${res.added === 1 ? '' : 's'}, ${res.dupes} already known${res.skipped ? `, ${res.skipped} skipped (non-runs / unreadable)` : ''}. 💾 Export a backup when you get a chance.`, 5500);
  };
  rd.readAsText(f);
  input.value = '';
};

/* ---- merged runs: Strava is the source of truth for distance/time/HR; manual log keeps feel/notes ---- */
/* ---- synced-activity lookup ----
   stravaRunOn() used to do Object.values(activities).find(...) on every call:
   a fresh array allocation plus a linear scan, once per lookup. One Progress
   render calls it ~1,730 times, so with a year of Garmin imports (~400
   activities) that was ~692,000 comparisons and 1,730 array allocations for a
   screen that only lists your runs — measured at 56 ms, the slowest view in the
   app by a factor of three.

   The index below is built once and reused. Staleness is checked by reference
   identity on the activities object plus the one flag that changes what gets
   indexed — both O(1). The obvious version keyed on Object.keys(acts).length
   allocates an array of every activity on every lookup, which profiling caught
   costing 7.7 ms per render by itself. In-place mutations don't change the
   reference, so those sites call invalidateActivityIndex() and save() clears it
   too; the explicit path is the real guarantee and this is the cheap belt.
   First-match-wins matches the old .find() semantics exactly. */

function invalidateActivityIndex() { _actIndex = null; _actIndexKey = null; }
function activityIndex() {
  const sv = ST.strava || {};
  const acts = sv.activities || {};
  const key = acts;
  if (_actIndex && _actIndexKey === key && _actIndexOther === !!sv.includeOther) return _actIndex;
  _actIndexOther = !!sv.includeOther;
  const idx = new Map();
  for (const a of Object.values(acts)) {
    if (!(a.type === 'Run' || sv.includeOther)) continue;
    if (!idx.has(a.date)) idx.set(a.date, a);   // first match wins, as .find() did
  }
  _actIndex = idx; _actIndexKey = key;
  return idx;
}
function stravaRunOn(date) { return activityIndex().get(date) || null; }
function mergedRunFor(date) {
  const sr = stravaRunOn(date);
  const mr = ST.runs[date];
  if (sr) return { km: sr.km, min: sr.movingMin, hr: sr.avgHr ?? (mr && mr.hr) ?? null, feel: mr && !mr.skipped ? mr.feel : null, note: (mr && mr.note) || '', splits: (mr && mr.splits) || [], src: sr.src || 'strava', name: sr.name, effort: sr.effort, elevM: sr.elevM };
  if (mr && !mr.skipped) return { ...mr, src: 'manual' };
  return null;
}
/* Rebuilt from scratch every time it was called, and a single Progress render
   calls it several times over. The cache lives for exactly one render pass —
   render() clears it before building a view — so it can never go stale between
   a mutation and the redraw that follows it. */

function invalidateMergedRuns() { _mergedAllCache = null; }
function mergedRunsAll() {
  if (_mergedAllCache) return _mergedAllCache;
  const dates = new Set(Object.keys(ST.runs).filter(d => !ST.runs[d].skipped));
  for (const a of Object.values(ST.strava?.activities || {})) if (a.type === 'Run' || ST.strava.includeOther) dates.add(a.date);
  const out = {};
  for (const d of [...dates].sort()) { const r = mergedRunFor(d); if (r) out[d] = r; }
  _mergedAllCache = out;
  return out;
}
/* run classification for trends: hard runs excluded from EF like-for-like */
function runKind(date, r) {
  if (/interval|tempo|speed|rep|fartlek|race/i.test(r.name || '')) return 'Hard Run';
  const day = dayFor(date);
  if (day && day.title === 'Hard Run') return 'Hard Run';
  if ((r.km || 0) >= 14) return 'Long Run';
  return day ? day.title : 'Easy Run';
}
/* long-run day pattern from actual Strava history (last 4 weeks) */
function longRunPattern() {
  const acts = Object.values(ST.strava?.activities || {}).filter(a => a.type === 'Run' && a.date >= dadd(today(), -28));
  if (acts.length < 3) return null;
  const byDow = {};
  for (const a of acts) {
    const dow = new Date(a.date + 'T12:00').getDay();
    (byDow[dow] = byDow[dow] || []).push(a.km);
  }
  let best = null;
  for (const [dow, kms] of Object.entries(byDow)) {
    kms.sort((a, b) => a - b);
    const med = kms[Math.floor(kms.length / 2)];
    if (med >= 12 && (!best || med > best.medKm)) best = { dow: +dow, medKm: med, n: kms.length };
  }
  return best;
}
/* weekly combined load: run km + strength tonnes, ramp flag vs 4-week average */
function weeklyLoad() {
  const merged = mergedRunsAll();
  return ST.program.weeks.map(wk => {
    let km = 0, vol = 0;
    for (const d of wk.days) {
      const r = merged[d.date]; if (r) km += r.km || 0;
      const s = ST.sessions[d.date];
      if (s && s.status === 'done') for (const e of s.exercises) {
        const ex = EXERCISES[e.exId]; if (ex.mode !== 'reps') continue;
        for (const t of e.sets.filter(x => x.done)) vol += (t.weight || 0) * (t.reps || 0) * (ex.perSide ? 2 : 1);
      }
    }
    return { wk: wk.num, monday: wk.days[0].date, km: Math.round(km * 10) / 10, tonnes: Math.round(vol / 100) / 10 };
  });
}
function loadRampFlag() {
  const t = today();
  const weeks = weeklyLoad();
  const curIdx = weeks.findIndex(w => t >= w.monday && t <= dadd(w.monday, 6));
  if (curIdx < 1) return null;
  const prior = weeks.slice(Math.max(0, curIdx - 4), curIdx).filter(w => w.km + w.tonnes > 0);
  if (prior.length < 2) return null;
  const avgKm = prior.reduce((a, w) => a + w.km, 0) / prior.length;
  const avgT = prior.reduce((a, w) => a + w.tonnes, 0) / prior.length;
  const cur = weeks[curIdx];
  const dayN = Math.max(1, Math.round((new Date(t + 'T12:00') - new Date(cur.monday + 'T12:00')) / 86400000) + 1);
  const projKm = cur.km * 7 / dayN, projT = cur.tonnes * 7 / dayN;
  const ramp = ((avgKm ? projKm / avgKm : 1) + (avgT ? projT / avgT : 1)) / 2;
  if (ramp > 1.3) return `Combined training load is tracking ~${Math.round((ramp - 1) * 100)}% above your 4-week average (runs + lifting). Big jumps are where niggles start — no need to panic, just notice.`;
  return null;
}

/* ================= fitness: HRV / RHR / VO2 (Garmin morning check-in) ================= */
function fitnessEntries() {
  return Object.keys(ST.fitness.daily).sort().map(d => ({ date: d, ...ST.fitness.daily[d] }));
}
/* rolling baseline: mean + SD of up to the last 14 HRV readings strictly before `date`.
   Needs ≥5 readings to be meaningful — callers must respect .ready */
function hrvBaseline(date) {
  const prior = fitnessEntries().filter(e => e.date < date && e.hrv != null).slice(-14);
  const vals = prior.map(e => e.hrv);
  if (vals.length < 5) return { ready: false, n: vals.length };
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  const sd = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length);
  return { ready: true, n: vals.length, mean, sd };
}
function rhrBaseline(date) {
  const vals = fitnessEntries().filter(e => e.date < date && e.rhr != null).slice(-14).map(e => e.rhr);
  if (vals.length < 5) return { ready: false };
  return { ready: true, mean: vals.reduce((a, b) => a + b, 0) / vals.length };
}
/* conservative recovery-dip detection: the 3 most recent readings ALL below their own
   baselines (HRV low, or RHR elevated). Single-day dips never flag. */
function recoveryDip() {
  const es = fitnessEntries();
  if (es.length < 8) return null;      // baseline (5) + streak (3)
  const last3 = es.slice(-3);
  const hrvLow = last3.every(e => {
    const b = hrvBaseline(e.date);
    return b.ready && e.hrv != null && e.hrv < b.mean - Math.max(0.75 * b.sd, 4);
  });
  const rhrHigh = last3.every(e => {
    const b = rhrBaseline(e.date);
    return b.ready && e.rhr != null && e.rhr > b.mean + 5;
  });
  if (!hrvLow && !rhrHigh) return null;
  const bits = [];
  if (hrvLow) bits.push('HRV has sat below your baseline 3 mornings running');
  if (rhrHigh) bits.push('resting HR has been elevated 3 mornings running');
  return bits.join(' and ');
}
function isTrainingDay(date) {
  const d = dayFor(date);
  return !!d && ['lift', 'run', 'race'].includes(d.kind);
}
function vo2Due() {
  const dates = Object.keys(ST.fitness.vo2).sort();
  if (!dates.length) return true;
  const last = dates[dates.length - 1];
  return Math.round((new Date(today() + 'T12:00') - new Date(last + 'T12:00')) / 86400000) >= 7;
}
function checkInDue() {
  const t = today();
  if (ST.activeSessionId) return false;
  if (ST.fitness.daily[t]) return false;      // already logged
  if (ST.fitness.skipped === t) return false; // skipped today — never ask twice
  return isTrainingDay(t);
}
function openCheckIn() {
  const t = today();
  const es = fitnessEntries();
  const last = es[es.length - 1] || {};
  const b = hrvBaseline(t);
  const m = $('#modal');
  const seed = (v, dflt) => v != null ? v : dflt;
  m.innerHTML = `<div class="sheet"><h2>Morning check-in</h2>
    <div class="dim" style="margin-bottom:10px;font-size:.88rem">From your Garmin: last night's HRV and resting heart rate. ${b.ready ? `Baseline ${b.mean.toFixed(0)} ms.` : `Baseline building — ${b.n || es.length} of 5 mornings logged.`}</div>
    ${stepperCI('hrv', 'Overnight HRV (ms)', seed(last.hrv, 55))}
    ${stepperCI('rhr', 'Resting heart rate (bpm)', seed(last.rhr, 52))}
    ${vo2Due() ? `<div class="stepper"><div class="stepper-lbl">VO₂ max (ml/kg/min) — if Garmin has updated it (optional)</div>
      <input id="ci-vo2" class="notefield" type="number" inputmode="numeric" placeholder="e.g. 48" value="${Object.values(ST.fitness.vo2).slice(-1)[0] || ''}"></div>` : ''}
    <button class="btn primary big" onclick="saveCheckIn()">✓ Save</button>
    <button class="linkbtn" onclick="skipCheckIn()">Skip today</button></div>`;
  m.classList.add('open');
}
function stepperCI(id, label, val) {
  return `<div class="stepper"><div class="stepper-lbl">${label}</div>
    <div class="stepper-row">
      <button class="stepbtn" onclick="ciStep('${id}',-1)">−</button>
      <div class="stepval" id="ci-${id}">${val}</div>
      <button class="stepbtn" onclick="ciStep('${id}',1)">+</button>
    </div></div>`;
}
window.ciStep = function (id, d) {
  const el = $('#ci-' + id);
  el.textContent = Math.max(0, parseInt(el.textContent, 10) + d);
};
window.saveCheckIn = function () {
  const t = today();
  ST.fitness.daily[t] = { hrv: parseInt($('#ci-hrv').textContent, 10), rhr: parseInt($('#ci-rhr').textContent, 10) };
  const v = $('#ci-vo2') ? parseInt($('#ci-vo2').value, 10) : NaN;
  if (!isNaN(v) && v > 20 && v < 90) ST.fitness.vo2[t] = v;
  save(); closeModal(); render();
  autoPromptRun();
};
window.skipCheckIn = function () {
  ST.fitness.skipped = today();
  save(); closeModal();
  autoPromptRun();
};
window.updateVo2 = function () {
  const v = prompt('VO₂ max from Garmin (ml/kg/min):', Object.values(ST.fitness.vo2).slice(-1)[0] || '48');
  const n = parseInt(v, 10);
  if (!isNaN(n) && n > 20 && n < 90) { ST.fitness.vo2[today()] = n; save(); render(); }
};
/* aerobic efficiency: EF = (m/min) / avg HR, easy + long runs only (like vs like).
   Uses merged Strava + manual runs — Strava supplies distance/time/HR automatically. */
function efSeries() {
  const out = [];
  const merged = mergedRunsAll();
  for (const d of Object.keys(merged)) {
    const r = merged[d];
    if (!r.km || !r.min || !r.hr) continue;
    const type = runKind(d, r);
    if (type === 'Hard Run') continue;   // intervals lie in this trend
    out.push({ date: d, ef: (r.km * 1000 / r.min) / r.hr, type });
  }
  return out;
}
/* honest half-marathon projection: range from actual long-run pace, VO2 as secondary adjuster */
function raceProjection() {
  const merged = mergedRunsAll();
  const longs = Object.keys(merged).filter(d => merged[d].km >= 12 && merged[d].min).slice(-4);
  if (!longs.length) return null;
  const paces = longs.map(d => merged[d].min * 60 / merged[d].km); // sec/km
  const longPace = paces.reduce((a, b) => a + b, 0) / paces.length;
  let fast = longPace * 0.93 * 21.1, slow = longPace * 0.99 * 21.1;  // seconds
  // VO2 adjuster (rough Daniels-style anchor points), only nudges the range
  const vo2 = Object.values(ST.fitness.vo2).slice(-1)[0];
  if (vo2) {
    const table = [[35, 135], [40, 122], [45, 109], [50, 98], [55, 89], [60, 81]]; // vo2 → HM minutes
    let est = null;
    for (let i = 0; i < table.length - 1; i++) {
      const [v1, t1] = table[i], [v2, t2] = table[i + 1];
      if (vo2 >= v1 && vo2 <= v2) est = (t1 + (t2 - t1) * (vo2 - v1) / (v2 - v1)) * 60;
    }
    if (vo2 < 35) est = 135 * 60; if (vo2 > 60) est = 81 * 60;
    if (est) { if (est < fast) fast = fast * 0.99; if (est > slow) slow = slow * 1.01; }
  }
  const fmtT = s => Math.floor(s / 3600) + ':' + String(Math.floor(s % 3600 / 60)).padStart(2, '0');
  return { range: fmtT(fast) + '–' + fmtT(slow), nLongs: longs.length };
}

/* every run day ≤ today that still has no log, oldest first */
function unloggedRuns() {
  const t = today();
  const out = [];
  for (const wk of ST.program.weeks) for (const d of wk.days) {
    if ((d.kind === 'run' || d.kind === 'race') && d.date <= t && !ST.runs[d.date]) out.push(d.date);
  }
  return out;
}

/* auto-prompt: at most ONE run sheet per app launch, and only for today or
   yesterday. This used to walk the entire backlog, and because saveRun/skipRun
   each called back into it, dismissing one sheet summoned the next — a week
   away from the app meant five sheets between you and the Today screen, with
   "I didn't do this run" as the fastest way through. Anything older than
   yesterday is a passive card on Today now (see runBacklogCard). */
let runPromptShown = false;
function autoPromptRun() {
  if (ST.activeSessionId) return;                      // never interrupt a workout
  if (runPromptShown) return;                          // one per launch, never chained
  if ($('#modal').classList.contains('open')) return;
  const t = today();
  const recent = unloggedRuns().filter(d => d === t || d === dadd(t, -1));
  if (!recent.length) return;
  const pick = recent[0];
  if (pick === t && new Date().getHours() < 10) return;
  runPromptShown = true;
  openRunLog(pick);
}

function upNext(t) {
  const items = [];
  for (let i = 1; i <= 7 && items.length < 3; i++) {
    const d = dayFor(dadd(t, i));
    if (d && d.kind !== 'rest') items.push(d);
  }
  if (!items.length) return '';
  return `<div class="upnext"><div class="section-label">Up next</div>` + items.map(d =>
    `<div class="upnext-row"><span class="upnext-date">${fmtDate(d.date)}</span><span class="upnext-title ${d.kind}">${d.kind === 'run' ? '🏃 ' : d.kind === 'race' ? '' : d.kind === 'lift' ? '🏋️ ' : ''}${esc(d.title)}</span></div>`).join('') + `</div>`;
}

/* ================= race kit + maintenance mode ================= */
function raceState(key) { return ST.races[key]; }
function raceInfo(key) { return RACES.find(r => r.key === key); }
function activeRaceWeek() {
  for (const r of RACES) { const d = daysUntil(r.date); if (d >= 0 && d <= 6 && !raceState(r.key).result) return r.key; }
  return null;
}
function unloggedPastRace() {
  for (const r of RACES) { if (daysUntil(r.date) < 0 && !raceState(r.key).result) return r.key; }
  return null;
}
window.openChecklist = function (key) {
  const r = raceInfo(key); const st = raceState(key);
  const d = daysUntil(r.date);
  const m = $('#modal');
  // reachable from Plan at any time, not just race week — so the wording adapts
  const sub = d > 6 ? `${d} days out. Get ahead of it now if you like — it saves the panic later.`
    : d >= 0 ? `${d} day${d === 1 ? '' : 's'} out. Tick things off as the week goes.`
    : 'Race done. Here\'s what you had on the list.';
  m.innerHTML = `<div class="sheet"><h2>🏁 ${esc(r.name)}${d >= 0 && d <= 6 ? ' — race week' : ''}</h2>
    <div class="dim small" style="margin-bottom:10px">${sub}</div>
    ${RACE_CHECKLIST.map(item => `<label class="chk-row"><input type="checkbox" ${st.checklist[item.id] ? 'checked' : ''} onchange="ST.races['${key}'].checklist['${item.id}']=this.checked;save()"> <span>${esc(item.text)}</span></label>`).join('')}
    <button class="btn primary big" onclick="closeModal()" style="margin-top:12px">Close</button></div>`;
  m.classList.add('open');
};
window.openRaceResult = function (key) {
  const r = raceInfo(key); const st = raceState(key);
  const m = $('#modal');
  const proj = raceProjection();
  m.innerHTML = `<div class="sheet"><h2>🏁 ${esc(r.name)} — how did it go?</h2>
    <div class="stepper"><div class="stepper-lbl">Finish time (h:mm:ss)</div>
      <input id="race-time" class="notefield" inputmode="numeric" placeholder="1:56:32" value="${esc(st.result || '')}"></div>
    <div class="stepper"><div class="stepper-lbl">How did it feel?</div><div class="rpes">
      ${['strong', 'mixed', 'rough'].map(f => `<button class="rpe feel ${st.feel === f ? 'sel' : ''}" data-f="${f}" onclick="pickFeel('${f}')">${f === 'strong' ? '💪 strong' : f === 'mixed' ? '😐 mixed' : '😖 rough'}</button>`).join('')}</div></div>
    <input id="race-note" class="notefield" placeholder="Anything worth remembering (optional)" value="${esc(st.note || '')}">
    <button class="btn primary big" onclick="saveRaceResult('${key}')">Save result</button>
    <button class="linkbtn" onclick="closeModal()">Later</button></div>`;
  m.classList.add('open');
  m.dataset.feel = st.feel || '';
};
window.saveRaceResult = function (key) {
  const m = $('#modal');
  const t = ($('#race-time').value || '').trim();
  if (!/^\d{1,2}:\d{2}(:\d{2})?$/.test(t)) { toast('Time as h:mm or h:mm:ss — e.g. 1:56:32'); return; }
  const st = raceState(key);
  st.result = t; st.feel = m.dataset.feel || null; st.note = ($('#race-note').value || '').trim();
  st.projAtRace = raceProjection() ? raceProjection().range : null;
  save(); closeModal(); render();
  toast(`${raceInfo(key).name}: ${t} logged. ${st.projAtRace ? 'Projection was ' + st.projAtRace + '.' : ''} 🎉`);
  if (key === 'melbourne') offerRecoveryMode();
};
function offerRecoveryMode() {
  const m = $('#modal');
  m.innerHTML = `<div class="sheet"><h2>The block is done. 🏁</h2>
    <p class="dim" style="line-height:1.6;margin-bottom:10px">Nine weeks, two races. One guided recovery week either way, then pick what's next:</p>
    ${RECOVERY_WEEK.map(l => `<div class="wksum-li">• ${esc(l)}</div>`).join('')}
    <button class="btn primary big" onclick="startMaintenance('balanced')" style="margin-top:12px">Start recovery week → maintenance</button>
    <div class="dim small" style="margin:2px 0 0">3 flexible workouts a week, no race clock.</div>
    <button class="btn big" onclick="startMaintenance('hypertrophy')" style="margin-top:10px">Start recovery week → hypertrophy phase</button>
    <div class="dim small" style="margin:2px 0 0">5 sessions a week, chest & arms priority, legs and back stay real too.</div>
    <button class="linkbtn" onclick="closeModal()">Not yet</button></div>`;
  m.classList.add('open');
}
window.startMaintenance = function (program) {
  ST.maintenance = { active: true, startedOn: today(), program: program || 'balanced', mesoStart: today() };
  save(); closeModal(); go('home');
  toast(ST.maintenance.program === 'hypertrophy'
    ? 'Hypertrophy phase on: recovery first, then 5 sessions a week — chest & arms lead, legs and back stay real.'
    : 'Maintenance mode on: recovery first, then 3 workouts a week, your pace.');
};
function inRecoveryWeek() {
  if (!ST.maintenance.active || !ST.maintenance.startedOn) return false;
  return daysUntil(dadd(ST.maintenance.startedOn, 7)) > 0 && today() >= ST.maintenance.startedOn;
}
function maintenanceCard() {
  const t = today();
  if (inRecoveryWeek()) {
    const dayN = Math.max(1, Math.round((new Date(t + 'T12:00') - new Date(ST.maintenance.startedOn + 'T12:00')) / 86400000) + 1);
    return `<div class="card run"><div class="card-kicker">Recovery week — day ${dayN} of 7</div>
      <div class="card-sub">${esc(RECOVERY_WEEK[Math.min(dayN <= 2 ? 0 : dayN === 3 ? 1 : dayN === 4 ? 2 : dayN <= 6 ? 3 : 4, 4)])}</div>
      ${dayN >= 3 && !(ST.sessions[t] && ST.sessions[t].status === 'done') ? `<button class="btn big" onclick="openReadiness('${t}','recoverySession')">Optional: Recovery workout (~25 min)</button>` : ''}</div>`;
  }
  if (ST.maintenance.program === 'hypertrophy') return maintenanceCardHyper(t);
  // regular maintenance: 3 sessions per calendar week (Mon-Sun), any order, any day
  const dow = new Date(t + 'T12:00').getDay();
  const monday = dadd(t, -( (dow + 6) % 7 ));
  const doneThisWeek = Object.values(ST.sessions).filter(s => s.status === 'done' && s.date >= monday && s.date <= dadd(monday, 6));
  const usedTpls = new Set(doneThisWeek.map(s => s.tpl));
  const options = ['maintLower', 'maintUpper', 'maintFull'].filter(tp => !usedTpls.has(tp));
  const doneToday = ST.sessions[t] && ST.sessions[t].status === 'done';
  // light run-awareness: a 12km+ run today or yesterday → suggest not-legs
  const bigRun = [t, dadd(t, -1)].some(d => { const r = mergedRunFor(d); return r && r.km >= 12; });
  const rec = options.find(tp => !(bigRun && tp === 'maintLower')) || options[0];
  return `<div class="card action"><div class="card-kicker">Maintenance · ${doneThisWeek.length}/3 this week</div>
    ${doneToday ? `<div class="card-sub">Done today ✓ — rest or go again tomorrow.</div>` : options.length ? `
      ${bigRun && options.includes('maintLower') ? `<div class="card-sub dim">🏃 Long run in the legs — Upper or Full Body is the smarter pick today.</div>` : ''}
      ${options.map(tp => `<button class="btn big ${tp === rec ? 'primary' : ''}" onclick="openReadiness('${t}','${tp}')" style="margin-top:8px">${esc(TEMPLATES[tp].title)} · ~${TEMPLATES[tp].est} min</button>`).join('')}` :
    `<div class="card-sub">All 3 workouts done this week. 🎉 Anything more is bonus.</div>`}
  </div>`;
}
/* Hypertrophy-phase variant: a fixed 5-day weekly order (HYPER_ORDER) rather
   than the balanced mode's 3-of-N round robin, since every one of the 5 is
   meant to happen every week, not compete for a shrinking pool of slots.
   Running gets a light, unenforced suggestion here — no scheduled days, no
   periodization, just a visible weekly target (see HYPERTROPHY_PROMPT.md's
   "running-maintenance" decision). */
const HYPER_RUN_TARGET = 2;
function maintenanceCardHyper(t) {
  const dow = new Date(t + 'T12:00').getDay();
  const monday = dadd(t, -((dow + 6) % 7));
  const weekEnd = dadd(monday, 6);
  const doneThisWeek = Object.values(ST.sessions).filter(s => s.status === 'done' && s.date >= monday && s.date <= weekEnd);
  const doneTpls = doneThisWeek.map(s => s.tpl);
  const allDone = HYPER_ORDER.every(tp => doneTpls.includes(tp));
  const next = HYPER_ORDER.find(tp => !doneTpls.includes(tp));
  const doneToday = ST.sessions[t] && ST.sessions[t].status === 'done';
  const runsThisWeek = Object.keys(mergedRunsAll()).filter(d => d >= monday && d <= weekEnd).length;
  return `<div class="card action"><div class="card-kicker">Hypertrophy phase · ${doneThisWeek.length}/5 this week</div>
    ${doneToday ? `<div class="card-sub">Done today ✓ — rest, or go again tomorrow.</div>`
      : allDone ? `<div class="card-sub">All 5 done this week. 🎉 Anything more is bonus.</div>`
      : `<button class="btn big primary" onclick="openReadiness('${t}','${next}')" style="margin-top:4px">${esc(TEMPLATES[next].title)} · ~${TEMPLATES[next].est} min</button>`}
    <div class="card-sub dim" style="margin-top:10px">🏃 ${runsThisWeek} of ${HYPER_RUN_TARGET} easy runs logged this week — no schedule, just a target to hold your aerobic base.</div>
  </div>`;
}

/* ---------- readiness check ---------- */
window.openReadiness = function (date, tpl) {
  ensureAudio();
  const m = $('#modal');
  const radar = deloadRadar();
  // run-aware guidance: today's completed run (context) + tomorrow's likely long run (suggestion)
  const todayRun = stravaRunOn(date);
  const isLower = tpl.startsWith('lower');
  const pat = longRunPattern();
  const tomorrowDow = new Date(dadd(date, 1) + 'T12:00').getDay();
  const runAware = isLower && pat && pat.dow === tomorrowDow
    ? `Your Strava history says tomorrow is long-run day (median ${pat.medKm.toFixed(0)} km over ${pat.n} runs). A lighter leg workout today protects it.` : null;
  m.innerHTML = `<div class="sheet">
    <h2>Quick readiness check</h2>
    ${todayRun ? `<div class="pace-line">🏃 Already run today: <b>${esc(todayRun.name || 'Run')}</b> — ${todayRun.km} km · ${paceStr(todayRun.km, todayRun.movingMin) || ''}${todayRun.avgHr ? ` · ${todayRun.avgHr} bpm` : ''}. Expect legs to feel heavier than the numbers suggest.</div>` : ''}
    ${runAware ? `<div class="notice">🏃 ${esc(runAware)}</div><button class="btn warn big" onclick="beginSession('${date}','${tpl}',{sore:3,fat:3},'light')">Start lighter version (run-aware)</button>` : ''}
    ${radar ? `<div class="notice">⚠️ ${esc(radar)}</div>` : ''}
    <div class="ready-q"><div>Muscle soreness</div><div class="scale" id="r-sore">${[1,2,3,4,5].map(n=>`<button data-v="${n}">${n}</button>`).join('')}</div><div class="scale-lbl"><span>fresh</span><span>wrecked</span></div></div>
    <div class="ready-q"><div>Overall fatigue</div><div class="scale" id="r-fat">${[1,2,3,4,5].map(n=>`<button data-v="${n}">${n}</button>`).join('')}</div><div class="scale-lbl"><span>energised</span><span>flat</span></div></div>
    <div class="ready-q" id="r-wu" hidden><div>Warm-up length</div>
      <div class="scale" id="r-wumins">${PREP_MINS_CHOICES.map(n => `<button data-v="${n}"${n === PREP_MINS_LIFT ? ' class="sel"' : ''}>${n} min</button>`).join('')}</div></div>
    <button class="btn primary big" id="r-go" disabled>Start</button>
    <button class="linkbtn" id="r-skipwu" hidden>Skip warm-up — straight to the workout</button>
    <button class="linkbtn" onclick="closeModal()">Cancel</button></div>`;
  m.classList.add('open');
  let sore = null, fat = null, guidance = null, wuMins = PREP_MINS_LIFT;
  /* Single-select, unlike the 1-5 readiness scales above which fill cumulatively. */
  $('#r-wumins').onclick = e => {
    if (!e.target.dataset.v) return;
    wuMins = +e.target.dataset.v;
    [...$('#r-wumins').children].forEach(b => b.classList.toggle('sel', +b.dataset.v === wuMins));
    const g = $('#r-go');
    if (!g.disabled) g.textContent = g.textContent.replace(/\d+ min/, `${wuMins} min`);
  };
  const update = () => {
    const go = $('#r-go');
    go.disabled = !(sore && fat);
    if (!(sore && fat)) return;
    guidance = computeGuidance(date, sore, fat);
    const old = $('#r-guidance'); if (old) old.remove();
    const disclaimer = !ST.settings.disclaimerSeen ? `<div class="dim" style="font-size:.72rem;margin-top:8px">Guidance based on your own trends — it's training advice, not medical advice. (Shown once.)</div>` : '';
    /* Notification.requestPermission() fires the instant Start is tapped
       (see beginSession()), with no other context — this is the one place
       that context can land first, since it's the last screen before that
       happens. Only shown when a prompt is actually about to fire. */
    const notifNote = ('Notification' in window && Notification.permission === 'default' && !ST.settings.notifPrimed)
      ? `<div class="dim" style="font-size:.72rem;margin-top:4px">Starting will ask permission to notify you when your rest timer ends in the background. (Shown once.)</div>` : '';
    go.insertAdjacentHTML('beforebegin', `<div id="r-guidance">
      <div class="guide ${guidance.level}">${esc(guidance.message)}
        <div class="guide-why">${esc(guidance.reason)}</div>${disclaimer}${notifNote}</div>
      ${guidance.level === 'red' ? `<button class="btn warn big" id="r-red" style="margin-top:10px">Use lighter workout (−40% volume)</button>` : ''}
    </div>`);
    if ($('#r-red')) $('#r-red').onclick = () => beginSession(date, tpl, { sore, fat }, 'red', { ...guidance, followed: 'lighter' });
    /* The warm-up leads into the workout rather than sitting beside it — one tap
       to do the right thing, one link to opt out. The two "lighter day" escapes
       above keep starting immediately; someone taking those wants to get going. */
    go.textContent = guidance.level === 'red' ? `🔥 Warm up ${wuMins} min → full workout` : `🔥 Warm up ${wuMins} min → workout`;
    $('#r-wu').hidden = false;
    const skip = $('#r-skipwu');
    skip.hidden = false;
    skip.onclick = () => beginSession(date, tpl, { sore, fat }, false, guidance ? { ...guidance, followed: guidance.level === 'red' ? 'full-anyway' : 'full' } : null);
    if (!ST.settings.disclaimerSeen) { ST.settings.disclaimerSeen = true; save(); }
    if (!ST.settings.notifPrimed) { ST.settings.notifPrimed = true; save(); }
  };
  $('#r-sore').onclick = e => { if (e.target.dataset.v) { sore = +e.target.dataset.v; [...$('#r-sore').children].forEach(b => b.classList.toggle('sel', +b.dataset.v <= sore)); update(); } };
  $('#r-fat').onclick = e => { if (e.target.dataset.v) { fat = +e.target.dataset.v; [...$('#r-fat').children].forEach(b => b.classList.toggle('sel', +b.dataset.v <= fat)); update(); } };
  $('#r-go').onclick = () => startLiftPrep(date, tpl, { sore, fat }, false, guidance ? { ...guidance, followed: guidance.level === 'red' ? 'full-anyway' : 'full' } : null, wuMins);
};
window.closeModal = function () { $('#modal').classList.remove('open'); $('#modal').innerHTML = ''; };

/* ---- sheet a11y ----
   Almost every decision in this app happens in a sheet, but #modal was a bare
   div: focus stayed on whatever was behind it and Escape did nothing. Rather
   than touch the dozen call sites that each do `m.classList.add('open')`, watch
   the class and wire up dialog behaviour when it flips. */
(function () {
  const m = document.getElementById('modal');
  if (!m) return;
  let lastFocus = null;
  const focusables = () => [...m.querySelectorAll('button,input,select,textarea,[tabindex]:not([tabindex="-1"])')]
    .filter(el => el.offsetParent !== null);
  function onKey(ev) {
    if (ev.key === 'Escape') { ev.preventDefault(); closeModal(); return; }
    if (ev.key !== 'Tab') return;
    const f = focusables(); if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); last.focus(); }
    else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first.focus(); }
  }
  // Observer callbacks are async and coalesce, so a close-then-open inside one
  // task (autoPromptRun chaining sheets, doSwap re-rendering) arrives as a
  // single notification. Keying off the .sheet element rather than the class
  // edge means each new sheet still gets its own label and focus.
  let lastSheet = null;
  new MutationObserver(() => {
    const open = m.classList.contains('open');
    const sheet = m.querySelector('.sheet');
    if (open) {
      if (!m.dataset.trapped) {
        m.dataset.trapped = '1';
        lastFocus = document.activeElement;
        document.addEventListener('keydown', onKey, true);
      }
      if (sheet && sheet !== lastSheet) {
        lastSheet = sheet;
        const h = m.querySelector('h2');
        m.setAttribute('aria-label', h ? h.textContent.trim() : 'Dialog');
        // focus the sheet itself, never the first field — a keyboard springing up
        // mid-workout is worse than no focus at all
        sheet.setAttribute('tabindex', '-1');
        sheet.focus({ preventScroll: true });
      }
    } else if (m.dataset.trapped) {
      delete m.dataset.trapped;
      lastSheet = null;
      document.removeEventListener('keydown', onKey, true);
      if (lastFocus && document.contains(lastFocus)) { try { lastFocus.focus({ preventScroll: true }); } catch (e) {} }
      lastFocus = null;
    }
  }).observe(m, { attributes: true, attributeFilter: ['class'], childList: true, subtree: true });
})();

function beginSession(date, tpl, readiness, downgrade, guidance) {
  closeModal();
  if ('Notification' in window && Notification.permission === 'default') {
    try { Notification.requestPermission(); } catch (e) {}
  }
  const s = buildSession(date, tpl, downgrade);
  s.readiness = readiness;
  s.guidance = guidance || null;   // what was advised + what you chose, kept with the session
  ST.sessions[date] = s;
  ST.activeSessionId = date;
  save();
  acquireWakeLock();
  go('session');
}

/* ---------- session (in-workout) ---------- */
function vSession() {
  const s = ST.sessions[ST.activeSessionId];
  if (!s || s.status !== 'active') return vHome();
  const e = s.exercises[s.curIdx];
  const ex = EXERCISES[e.exId];
  const doneSets = s.exercises.reduce((a, x) => a + x.sets.filter(t => t.done).length, 0);
  const totalSets = s.exercises.reduce((a, x) => a + x.sets.length, 0);
  const remainMin = estRemaining(s);
  const hist = exHistory(e.exId, s.date);
  const last = hist[hist.length - 1];
  const lastStr = lastSummary(ex, last);
  const unit = ex.mode === 'time' ? 's' : ex.mode === 'carry' ? 'm' : '';
  const repsLabel = ex.mode === 'time' ? 'seconds' : ex.mode === 'carry' ? 'metres' : 'reps';

  const nextUndone = e.sets.findIndex(t => !t.done);
  const cur = nextUndone === -1 ? null : nextUndone;
  // seed inputs for current set
  if (cur !== null) {
    const t = e.sets[cur];
    if (t.weight == null) t.weight = (cur > 0 && e.sets[cur - 1].done) ? e.sets[cur - 1].weight : (e.prescWeight != null ? e.prescWeight : 0);
    if (t.reps == null) t.reps = (cur > 0 && e.sets[cur - 1].done) ? e.sets[cur - 1].reps : e.tplReps;
  }

  const setRows = e.sets.map((t, i) => {
    if (t.done) return `<div class="setrow done"><span class="setnum">✓</span><span>${setStr(ex, t)}</span>${t.note ? `<span class="setnote">📝</span>` : ''}<button class="mini" onclick="undoSet(${i})">undo</button></div>`;
    if (i !== cur) return `<div class="setrow pending"><span class="setnum">${i + 1}</span><span class="dim">${e.tplReps}${unit} ${ex.perSide ? '/side' : ''}</span></div>`;
    return ''; // current set rendered as big panel below
  }).join('');

  const t = cur !== null ? e.sets[cur] : null;
  const curPanel = cur === null ? `
    <div class="allset">All sets done ✓</div>` : `
    <div class="curset">
      <div class="curset-head">Set ${cur + 1} of ${e.sets.length}</div>
      ${ex.mode !== 'bw' ? stepper('weight', 'Weight (kg)', t.weight, ST.settings.step) : ''}
      ${stepper('reps', cap(repsLabel) + (ex.perSide ? ' / side' : ''), t.reps, 1)}
      ${ex.mode === 'time' ? `<button class="btn big holdbtn" id="holdbtn" onclick="startHold()">▶ Start ${t.reps}s hold timer${ex.perSide ? ' (run it once per side)' : ''}</button><div class="holdval" id="holdval"></div>` : ''}
      ${ex.rpe !== null ? rpePicker(t.rpe) : ''}
      <button class="btn primary big" onclick="logSet()">✓ Log set — rest ${fmtSecs(ex.rest)}</button>
      <input id="setnote" class="notefield" placeholder="Notes — niggles, form cues (optional)" value="${esc(t.note)}">
      <button class="linkbtn" onclick="failSet()">mark set failed</button>
    </div>`;

  return `<header class="top slim">
      <button class="backbtn" aria-label="Back to Today" onclick="go('home')">‹</button>
      <div class="prog-wrap"><div class="prog"><div class="prog-fill" style="width:${(100 * doneSets / totalSets).toFixed(0)}%"></div></div>
      <div class="prog-txt">${doneSets}/${totalSets} sets · ~${remainMin} min left · ⏱ <span id="sess-elapsed">${fmtElapsed(Date.now() - s.startedTs)}</span></div></div>
    </header>
    <main class="session">
      ${(() => { const tr = stravaRunOn(s.date); return tr ? `<div class="pace-line">🏃 <span class="svbadge ${tr.src || 'strava'}">${tr.src || 'strava'}</span> Already run today: <b>${esc(tr.name || 'Run')}</b> — ${tr.km} km · ${paceStr(tr.km, tr.movingMin) || ''}${tr.avgHr ? ` · ${tr.avgHr} bpm` : ''}</div>` : ''; })()}
      <div class="ex-head">
        <div class="ex-count">Exercise ${s.curIdx + 1} / ${s.exercises.length}</div>
        <h1>${esc(ex.name)}${ex.perSide ? ' <span class="perside">each side</span>' : ''}</h1>
        <div class="ex-rx">${e.tplSets} set${e.tplSets === 1 ? '' : 's'} · rest ${fmtSecs(ex.rest)}</div>
        ${heroBlock(e, ex, last)}
        <div class="ex-reason dim">${esc(e.prescReason || '')}</div>
        ${e.prescWarn ? `<div class="ex-warn">⚠️ ${esc(e.prescWarn)}</div>` : ''}
        ${rampBlock(e, ex)}
      </div>
      ${curPanel}
      <!-- Everything below is reference you read once per exercise: what you did
           last time, the form cue, why it's in the plan, the swap, and the sets
           still to come. It used to sit ABOVE the panel, which pushed the Log
           button ~312px below the fold on every single set. -->
      <div class="ex-ref">
        <div class="ex-last">${lastStr}</div>
        <div class="ex-cue">${esc(ex.cue || '')}</div>
        ${ex.steps ? `<button class="ex-why ${howtoOpen ? 'open' : ''}" aria-expanded="${howtoOpen}" onclick="howtoOpen=!howtoOpen;render()">
          <span class="ex-why-t">📋 How to ${howtoOpen ? '▾' : '▸'}</span>
          ${howtoOpen ? `<div class="ex-why-body"><ol class="ex-steps">${ex.steps.map(s => `<li>${esc(s)}</li>`).join('')}</ol></div>` : ''}
        </button>` : ''}
        ${ex.why ? `<button class="ex-why ${whyOpen ? 'open' : ''}" aria-expanded="${whyOpen}" onclick="whyOpen=!whyOpen;render()">
          <span class="ex-why-t">🎯 Why this helps your half ${whyOpen ? '▾' : '▸'}</span>
          ${whyOpen ? `<div class="ex-why-body">${isTaperPhase(s.date) ? esc(ex.taperWhy || TAPER_WHY) + '<br><span class="dim">' + esc(ex.why) + '</span>' : esc(ex.why)}</div>` : ''}
        </button>` : ''}
        ${ex.swaps.length && !e.sets.some(t => t.done) ? `<button class="mini swap" onclick="openSwap()">⇄ swap exercise</button>` : ''}
      </div>
      <div class="sets">${setRows}</div>
      <div class="ex-nav">
        <button class="btn" ${s.curIdx === 0 ? 'disabled' : ''} onclick="moveEx(-1)">‹ Prev</button>
        ${s.curIdx < s.exercises.length - 1
          ? `<button class="btn" onclick="moveEx(1)">Next ›</button>`
          : `<button class="btn primary" onclick="finishSession()">Finish 🏁</button>`}
      </div>
      ${s.curIdx < s.exercises.length - 1 ? `<button class="linkbtn" onclick="finishSession()">finish workout early</button>` : ''}
    </main>
    <div id="restbar" class="restbar"><div id="restbar-fill" class="restbar-fill"></div><div class="restbar-txt"><button class="restbar-tap" onclick="addRest(30)" aria-label="Rest timer. Tap to add 30 seconds"><span id="restbar-label"></span><b id="restbar-time"></b><span class="dim">tap +30s</span></button><button class="mini restskip" onclick="skipRest()">Skip</button></div></div>`;
}

/* ---- in-workout exercise header ----
   Three lines used to answer "what do I lift right now?" in the same shape:
   "Recommended: 60 kg × 5", "🔥 Warm-up: bar × 10 · 30 kg × 5 · …" and
   "Last: 55kg × 5 @7, 55kg × 5 @7, …". All three were dense `N kg × R` runs in
   near-identical type, so at arm's length none of them read as the answer.
   Now: ONE hero number for the working set, the ramp as tappable pills below it,
   and history compressed to a single dim line plus a delta chip. Different
   shapes, not different separators. */
function heroBlock(e, ex, last) {
  const timeLike = ex.mode === 'time';
  const bw = ex.mode === 'bw';
  // hero = the number you act on: load for weighted work, reps/seconds otherwise
  const num = (bw || timeLike) ? e.tplReps : e.prescWeight;
  const perSide = ex.perSide ? '/side' : '';
  const rpeTxt = (() => { const t = targetRPEForPhase(e.exId, sessionPhase(ST.sessions[ST.activeSessionId])); return t ? ` @ RPE ${rpeBandTxt(t)}` : ''; })();
  const suffix = bw ? `reps${perSide}${rpeTxt}`
    : timeLike ? `seconds${perSide}`
    : ex.mode === 'carry' ? `kg × ${e.tplReps} m${perSide}`
    : `kg × ${e.tplReps}${perSide}${rpeTxt}`;
  if (num == null) {
    return `<div class="ex-hero"><div class="hero-num none">—</div><div class="hero-suffix">${suffix} · pick a starting weight below</div></div>`;
  }
  // delta chip: the useful half of "last time", as an answer rather than raw sets
  let chip = '';
  if (!bw && !timeLike && last && e.prescWeight != null) {
    const top = Math.max(...last.sets.map(t => t.weight || 0));
    if (top > 0) {
      const d = Math.round((e.prescWeight - top) * 100) / 100;
      chip = d > 0 ? `<span class="hero-chip up">↑ ${d} kg</span>`
        : d < 0 ? `<span class="hero-chip down">↓ ${Math.abs(d)} kg</span>`
        : `<span class="hero-chip same">same as last</span>`;
    }
  }
  return `<div class="ex-hero">
      <div class="hero-num">${num}</div>
      <div class="hero-suffix">${suffix}</div>
      ${chip}
      ${isBarbell(ex) && !bw && !timeLike ? platesLine(num) : ''}
    </div>`;
}
/* True for anything actually loaded with a bar and plates. Deliberately keyed
   on the equip tag, not ex.wu === 'bar' — wu marks lifts that get a formal
   warm-up ramp (heavy compounds), which is a different question from "is
   this bar-loaded" now that barbell isolation lifts (bbcurl, skullcrusher)
   exist without one. A wu:'bar' lift not equip-tagged 'barbell' would be a
   data-entry mistake elsewhere in EXERCISES, not a case to design around. */
function isBarbell(ex) { return !!(ex.equip && ex.equip.includes('barbell')); }
/* Plate breakdown for a barbell working weight — the friction this removes is
   doing bar-minus-weight-over-two math mid-set, under fatigue. */
function platesLine(weight) {
  if (weight == null) return '';
  const bar = ST.settings.barWeight || 20;
  if (weight <= bar) return `<div class="plates dim">Just the ${bar}kg bar</div>`;
  const r = platesPerSide(weight, bar, PLATE_SET);
  if (!r.plates.length) return '';
  const grouped = [];
  let i = 0;
  while (i < r.plates.length) { let j = i; while (j < r.plates.length && r.plates[j] === r.plates[i]) j++; grouped.push(`${j - i}×${r.plates[i]}`); i = j; }
  return `<div class="plates">🏋️ ${bar}kg bar + ${grouped.join(' + ')} kg /side${!r.exact ? ` <span class="dim">(+${r.remainder}kg not exact with standard plates)</span>` : ''}</div>`;
}
/* Ramp pills. Tapping one strikes it through — optional, never required before a
   working set. State is transient: the ramp only shows before the first logged set. */
let rampDone = new Set();
window.tickRamp = function (i) {
  if (rampDone.has(i)) rampDone.delete(i); else rampDone.add(i);
  vibrate(25); render();
};
function rampBlock(e, ex) {
  if (e.sets.some(x => x.done)) return '';   // ramp is done once real sets start
  const wp = warmupPlan(e.exId, e.prescWeight != null ? e.prescWeight : (e.sets[0] && e.sets[0].weight), ST.settings.step);
  if (!wp) return '';
  const pills = wp.steps.map((txt, i) =>
    `<button class="ramp-pill ${rampDone.has(i) ? 'done' : ''}" onclick="tickRamp(${i})">${esc(txt)}</button>`).join('');
  return `<div class="ex-ramp">
      <div class="ramp-kicker">🔥 Ramp up first${wp.steps.length ? ' — tap as you go' : ''}</div>
      ${pills ? `<div class="ramp-pills">${pills}</div>` : ''}
      ${wp.note ? `<div class="ramp-note">${esc(wp.note)}</div>` : ''}
    </div>`;
}
/* One dim line of history. Identical sets collapse to sets × reps @ weight, which
   reads differently from the hero on purpose. */
function lastSummary(ex, last) {
  if (!last) return '<span class="dim">First time — no history yet.</span>';
  const sets = last.sets;
  const u = ex.mode === 'time' ? 's' : ex.mode === 'carry' ? 'm' : '';
  const f = sets[0];
  const uniform = sets.every(t => t.weight === f.weight && t.reps === f.reps && t.rpe === f.rpe);
  const when = fmtDate(last.date).replace(/,.*$/, '');
  let body;
  if (uniform) {
    const w = (ex.mode === 'bw' || !f.weight) ? '' : ` @ ${f.weight} kg`;
    body = `${sets.length} × ${f.reps}${u}${w}${f.rpe != null ? ` · RPE ${f.rpe}` : ''}`;
  } else {
    body = sets.map(t => setStr(ex, t)).join(', ');
  }
  return `<span class="dim">Last ${esc(when)}:</span> ${body}`;
}

function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
function setStr(ex, t) {
  const u = ex.mode === 'time' ? 's' : ex.mode === 'carry' ? 'm' : '';
  const w = ex.mode === 'bw' || !t.weight ? '' : t.weight + 'kg × ';
  return `${w}${t.reps}${u}${t.rpe != null ? ' @' + t.rpe : ''}${t.failed ? ' ✗' : ''}`;
}

function stepper(id, label, val, step) {
  // A first-ever lift has no prescription, so weight seeds at 0. Stepping from
  // 0 to a real working weight is ~40 taps, so when it's unset the field says
  // so and sends you to the keyboard instead of the + button.
  const unset = id === 'weight' && !val;
  return `<div class="stepper">
    <div class="stepper-lbl">${label} <span class="dim" style="font-weight:400">· tap number to type</span></div>
    <div class="stepper-row">
      <button class="stepbtn" aria-label="Decrease ${esc(label)}" onclick="step_('${id}',-${step})">−</button>
      <div class="stepval ${unset ? 'unset' : ''}" id="v-${id}" role="button" tabindex="0" aria-label="${esc(label)}: ${unset ? 'not set' : val}. Tap to type a value" onclick="typeSetVal('${id}')">${unset ? 'tap to set' : val}</div>
      <button class="stepbtn" aria-label="Increase ${esc(label)}" onclick="step_('${id}',${step})">+</button>
    </div></div>`;
}
/* tap-to-type: swap the value for a numeric input, commit on blur/enter */
window.typeSetVal = function (id) {
  const el = document.getElementById('v-' + id);
  if (!el || el.tagName === 'INPUT') return;
  const cur = parseFloat(el.textContent);   // "tap to set" → empty field, ready to type
  el.outerHTML = `<input class="stepval typeval" id="v-${id}" type="number" inputmode="decimal" step="any" value="${isNaN(cur) ? '' : cur}">`;
  const inp = document.getElementById('v-' + id);
  inp.focus(); inp.select();
  const commit = () => {
    const s = ST.sessions[ST.activeSessionId]; if (!s) return;
    const e = s.exercises[s.curIdx];
    const cur2 = e.sets.findIndex(t => !t.done); if (cur2 === -1) return;
    const v = parseFloat(inp.value);
    if (!isNaN(v) && v >= 0) {
      if (id === 'weight') e.sets[cur2].weight = Math.round(v * 100) / 100;
      else e.sets[cur2].reps = Math.round(v);
      save();
    }
    render();
  };
  inp.addEventListener('blur', commit);
  inp.addEventListener('keydown', ev => { if (ev.key === 'Enter') inp.blur(); });
};
window.step_ = function (id, d) {
  ensureAudio();
  const s = ST.sessions[ST.activeSessionId]; const e = s.exercises[s.curIdx];
  const cur = e.sets.findIndex(t => !t.done); if (cur === -1) return;
  const t = e.sets[cur];
  if (id === 'weight') t.weight = Math.max(0, Math.round((t.weight + d) * 100) / 100);
  else t.reps = Math.max(0, t.reps + d);
  const el = $('#v-' + id);
  el.textContent = id === 'weight' ? t.weight : t.reps;
  el.classList.remove('unset');   // it has a real value now, drop the placeholder look
  save();
};

function rpePicker(sel) {
  const vals = [6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10];
  return `<div class="stepper"><div class="stepper-lbl">RPE — how hard was it?</div>
    <div class="rpes">${vals.map(v => `<button class="rpe ${sel === v ? 'sel' : ''}" onclick="pickRPE(${v})">${v}</button>`).join('')}</div></div>`;
}
window.pickRPE = function (v) {
  const s = ST.sessions[ST.activeSessionId]; const e = s.exercises[s.curIdx];
  const cur = e.sets.findIndex(t => !t.done); if (cur === -1) return;
  e.sets[cur].rpe = v; save();
  document.querySelectorAll('.rpe').forEach(b => b.classList.toggle('sel', +b.textContent === v));
};

window.logSet = function (failed) {
  ensureAudio();
  const s = ST.sessions[ST.activeSessionId]; const e = s.exercises[s.curIdx];
  const ex = EXERCISES[e.exId];
  const cur = e.sets.findIndex(t => !t.done); if (cur === -1) return;
  const t = e.sets[cur];
  // A blocking alert() mid-set costs an extra tap to dismiss before you can log.
  // Toast + flash the RPE row instead: the hand goes straight to the fix.
  if (ex.rpe && t.rpe == null && !failed) {
    toast('Tap an RPE first — it drives your next weights.');
    const row = document.querySelector('.rpes');
    if (row) { row.classList.add('nudge'); setTimeout(() => row.classList.remove('nudge'), 1200); row.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
    vibrate([80, 60, 80]);
    return;
  }
  t.note = $('#setnote') ? $('#setnote').value.trim() : '';
  t.failed = !!failed;
  t.done = true; t.ts = Date.now();
  vibrate(40);
  const wasLast = !e.sets.some(x => !x.done);
  save();
  if (!(wasLast && s.curIdx === s.exercises.length - 1)) startRest(ex.rest, esc(ex.name));
  if (wasLast && s.curIdx < s.exercises.length - 1) {
    s.curIdx++;
    whyOpen = false; howtoOpen = false; rampDone = new Set();
    save(); render();
    showNextExercise(ex, s);          // unmissable hand-off between exercises
    return;
  }
  save();
  render();
};
function showNextExercise(doneEx, s) {
  const e = s.exercises[s.curIdx];
  const ex = EXERCISES[e.exId];
  const unit = ex.mode === 'time' ? 's' : ex.mode === 'carry' ? 'm' : '';
  const tgt = targetRPEForPhase(e.exId, sessionPhase(s));
  const m = $('#modal');
  m.innerHTML = `<div class="sheet nextex">
    <div class="nextex-done">✓ ${esc(doneEx.name)} — done</div>
    <div class="nextex-kicker">NEXT · Exercise ${s.curIdx + 1} of ${s.exercises.length}</div>
    <h2 class="nextex-name">${esc(ex.name)}</h2>
    <div class="nextex-rx">${e.tplSets} × ${e.tplReps}${unit}${ex.perSide ? '/side' : ''}${e.prescWeight != null && ex.mode !== 'bw' ? ` @ <b>${e.prescWeight} kg</b>` : ''}${tgt ? ` · RPE ${rpeBandTxt(tgt)}` : ''}</div>
    <div class="dim small" style="margin-top:6px">${esc(ex.cue || '')}</div>
    <button class="btn primary big" onclick="closeModal()" style="margin-top:16px">Rest, then go →</button>
  </div>`;
  m.classList.add('open');
}
window.failSet = function () { logSet(true); };
window.undoSet = function (i) {
  const s = ST.sessions[ST.activeSessionId]; const e = s.exercises[s.curIdx];
  e.sets[i].done = false; save(); render();
};
window.moveEx = function (d) {
  const s = ST.sessions[ST.activeSessionId];
  s.curIdx = Math.max(0, Math.min(s.exercises.length - 1, s.curIdx + d));
  whyOpen = false; howtoOpen = false; rampDone = new Set();
  save(); render();
};

/* Equipment a variant needs but Settings has marked unavailable. Empty equip
   (or every tag still ON) = fully compatible, always ranked first. This never
   hides an option — a "not available" tag can be wrong, and the user knows
   their gym better than a fixed list does — it only sorts and labels. */
function missingEquip(id) {
  const eq = ST.settings.equip || {};
  return (EXERCISES[id].equip || []).filter(tag => eq[tag] === false);
}
window.openSwap = function () {
  const s = ST.sessions[ST.activeSessionId]; const e = s.exercises[s.curIdx];
  const base = EXERCISES[e.origExId];
  const opts = [e.origExId, ...base.swaps].filter(id => id !== e.exId);
  const ranked = opts.map(id => ({ id, missing: missingEquip(id) }))
    .sort((a, b) => (a.missing.length > 0) - (b.missing.length > 0));
  const m = $('#modal');
  m.innerHTML = `<div class="sheet"><h2>Swap exercise</h2><div class="dim" style="margin-bottom:12px">Equipment taken? Each variant keeps its own weight history. Sorted by what you've marked available in Settings.</div>` +
    ranked.map(({ id, missing }) => `<button class="btn big swapopt ${missing.length ? 'unavail' : ''}" onclick="doSwap('${id}')">${esc(EXERCISES[id].name)}${missing.length ? `<span class="swap-note">needs ${missing.map(t => EQUIP_LABEL[t] || t).join(', ')} — marked unavailable</span>` : ''}</button>`).join('') +
    `<button class="linkbtn" onclick="closeModal()">Cancel</button></div>`;
  m.classList.add('open');
};
window.doSwap = function (id) {
  const s = ST.sessions[ST.activeSessionId];
  if (!swapExercise(s, s.curIdx, id)) { toast('Already logged a set here — finish this exercise or move on instead.'); closeModal(); return; }
  rampDone = new Set();   // different lift, different ramp
  closeModal(); render();
};

function estRemaining(s) {
  let secs = 0;
  for (let i = s.curIdx; i < s.exercises.length; i++) {
    const e = s.exercises[i]; const ex = EXERCISES[e.exId];
    const undone = e.sets.filter(t => !t.done).length;
    secs += undone * (40 + ex.rest);
    if (ex.wu && !e.sets.some(t => t.done)) secs += 150; // warm-up ramp not started yet
  }
  return Math.max(1, Math.round(secs / 60));
}

/* ---- finish flow: offer the stretch first, then close out ---- */
window.finishSession = function () { offerStretch(); };
function finishSessionFinal() {
  const s = ST.sessions[ST.activeSessionId];
  if (!s) return;
  clearInterval(SR && SR.int); SR = null;
  s.status = 'done'; s.finishedTs = Date.now();
  ST.activeSessionId = null; ST.timer = null;
  save();
  if (wakeLock) { try { wakeLock.release(); } catch (e) {} wakeLock = null; }
  go('summary', { sid: s.id });
}

/* ================= post-session stretch routine ================= */
/* Thin wrapper: turn the finished session into a { muscle: sets } load map, add
   what the recent running did to the posterior chain, then hand off to
   stretchRoutine() in program.js (pure, and unit-tested in tools/test-stretch.js). */
function buildStretchRoutine(sess, mins) {
  const loads = {};
  for (const e of sess.exercises) {
    const done = e.sets.filter(x => x.done).length;
    if (!done) continue;
    for (const m of (MUSCLE_MAP[e.exId] || [])) loads[m] = (loads[m] || 0) + done;
  }
  /* Running is training too. A long run today or yesterday leaves the calves,
     hamstrings and hip flexors genuinely loaded even when the gym session was all
     upper body — so they enter as trained muscles rather than as a special case.
     Deliberately modest: on an Upper A day (back 13 sets) these sit below the
     muscles actually lifted, so they get attention without taking over. */
  const longRun = [sess.date, dadd(sess.date, -1)]
    .map(d => mergedRunFor(d)).filter(r => r && r.km >= 12).sort((a, b) => b.km - a.km)[0];
  if (longRun) {
    const bias = longRun.km >= 18 ? 4 : 3;
    for (const m of ['calves', 'hams', 'hipflex']) loads[m] = (loads[m] || 0) + bias;
    loads.glutes = (loads.glutes || 0) + Math.max(1, bias - 1);
  }
  return stretchRoutine(loads, mins, { soreBias: !!(sess.readiness && sess.readiness.sore >= 4) });
}
function offerStretch() {
  const s = ST.sessions[ST.activeSessionId];
  if (!s) return;
  const est = m => Math.round(buildStretchRoutine(s, m).total / 60);
  const m = $('#modal');
  m.innerHTML = `<div class="sheet"><h2>Stretch it out?</h2>
    <div class="dim" style="margin-bottom:12px;font-size:.9rem">Built from what you just trained${s.readiness && s.readiness.sore >= 4 ? ', biased toward today\'s soreness' : ''} — calves, hips, glutes and hamstrings always get a look in.</div>
    <button class="btn primary big" onclick="startStretch(7)">🧘 Standard — ~${est(7)} min</button>
    <button class="btn big" onclick="startStretch(5)">Short — ~${est(5)} min</button>
    <button class="btn big" onclick="startStretch(10)">Long — ~${est(10)} min</button>
    <button class="linkbtn" onclick="closeModal();finishSessionFinal()">Skip — straight to summary</button></div>`;
  m.classList.add('open');
}
let SR = null;   // running routine state (transient) — a stretch or a prep
/* One starter for every timed routine. The engine is shared; the caller says
   what it's called, what the escape hatch says, and what happens at the end. */
function startRoutine(cfg) {
  if (!cfg.list || !cfg.list.length) { if (cfg.onDone) cfg.onDone(); return; }
  SR = {
    list: cfg.list, idx: 0, side: 1, paused: false, int: null, phase: 'ready',
    kind: cfg.kind || 'stretch',
    title: cfg.title || '🧘 Stretch',
    endLabel: cfg.endLabel || 'end stretching — go to summary',
    markComplete: cfg.markComplete || null,
    onDone: cfg.onDone || null,
  };
  beginPhase('ready');
  view = { name: 'stretch' }; render();
}
window.startStretch = function (mins) {
  closeModal();
  const s = ST.sessions[ST.activeSessionId];
  const r = buildStretchRoutine(s, mins);
  if (!r.list.length) { finishSessionFinal(); return; }
  s.stretch = { mins, stretches: r.list.length, completed: false };
  save();
  startRoutine({
    list: r.list, kind: 'stretch', title: '🧘 Stretch',
    endLabel: 'end stretching — go to summary',
    markComplete: () => { const x = ST.sessions[ST.activeSessionId]; if (x && x.stretch) x.stretch.completed = true; },
    onDone: finishSessionFinal,
  });
};

/* ================= on-demand, area-targeted stretching ================= */
/* Not tied to a workout at all — reachable from Home regardless of program
   mode or an active session. Deliberately NOT stretchRoutine()/offerStretch():
   this is "I'm sore right now," not "here's what I just trained" — see
   areaStretchRoutine() in program.js for why that's a different builder.

   The framing note below is shown every time, not gated behind a one-time
   "seen it" flag the way ST.settings.disclaimerSeen is — that flag means
   "shown once, ever," which fits a general training-advice caveat but not a
   tool someone opens specifically because something hurts, possibly weeks
   or months after the last time. */
let soreAreas = new Set();   // transient — which STRETCH_AREAS ids are checked
/* Sets logged against exercises tagged with any of `muscles`, in [fromISO,
   toISO]. Plain volume, not intensity/soreness — the same "sets" unit
   plannedLoads()/tonnageIn() already use elsewhere in this file. */
function recentSetsFor(muscles, fromISO, toISO) {
  let n = 0;
  for (const s of Object.values(ST.sessions)) {
    if (s.status !== 'done' || s.date < fromISO || s.date > toISO) continue;
    for (const e of s.exercises) {
      if (!(MUSCLE_MAP[e.exId] || []).some(m => muscles.includes(m))) continue;
      n += e.sets.filter(t => t.done).length;
    }
  }
  return n;
}
/* Noticing a repeat pick is not a diagnosis either — just a nudge that a
   pattern like this is worth an actual assessment. Threshold/window are a
   practical judgment call, not a clinical claim. The recent-training-volume
   context (via volumeShiftNote()) is the same: correlational, never framed
   as a cause — it's "also worth mentioning," not "this is why." */
function sorePatternNote() {
  const hits = sorePattern(ST.soreLog, today(), 30, 3);
  if (!hits.length) return '';
  const labels = hits.map(h => (STRETCH_AREAS.find(a => a.id === h.areaId) || {}).label).filter(Boolean).map(l => l.toLowerCase());
  if (!labels.length) return '';
  const what = labels.length === 1 ? `${labels[0]} ${hits[0].count} times` : `${labels.join(' and ')}, repeatedly`;
  let text = `You've picked ${what} in the last 30 days. A pattern like that is worth mentioning to a physio, not just stretching through it.`;
  const top = STRETCH_AREAS.find(a => a.id === hits[0].areaId);
  if (top) {
    const recent = recentSetsFor(top.muscles, dadd(today(), -14), today());
    const prior = recentSetsFor(top.muscles, dadd(today(), -28), dadd(today(), -15));
    const shift = volumeShiftNote(recent, prior);
    if (shift) text += ` Also worth noting: training volume for that area went ${shift} over the same two weeks — not necessarily the cause, but worth mentioning too.`;
  }
  return `<div class="notice" style="margin-bottom:12px">${esc(text)}</div>`;
}
window.openSoreSpot = function () {
  soreAreas = new Set();
  const m = $('#modal');
  m.innerHTML = `<div class="sheet"><h2>🧘 Stretch a sore spot</h2>
    <div class="dim small" style="margin-bottom:12px;line-height:1.5">This is general tightness and range-of-motion work — not a diagnosis or treatment for pain. If it's new, getting worse, spreads down a limb, or comes with numbness or weakness, that's a reason to see a physio or doctor, not to stretch through it.</div>
    ${sorePatternNote()}
    ${STRETCH_AREAS.map(a => `<label class="chk-row"><input type="checkbox" onchange="toggleSoreArea('${a.id}',this.checked)"> <span>${esc(a.label)}</span></label>`).join('')}
    <div class="stepper-lbl" style="margin-top:14px">Session length</div>
    <button class="btn primary big" onclick="startSoreStretch(8)">🧘 Standard — ~8 min</button>
    <button class="btn big" onclick="startSoreStretch(5)">Short — ~5 min</button>
    <button class="btn big" onclick="startSoreStretch(12)">Long — ~12 min</button>
    <button class="linkbtn" onclick="closeModal()">Cancel</button></div>`;
  m.classList.add('open');
};
window.toggleSoreArea = function (id, checked) {
  if (checked) soreAreas.add(id); else soreAreas.delete(id);
};
window.startSoreStretch = function (mins) {
  if (!soreAreas.size) { toast('Pick at least one area first.'); return; }
  const areaIds = [...soreAreas];
  const tags = [...new Set(STRETCH_AREAS.filter(a => soreAreas.has(a.id)).flatMap(a => a.muscles))];
  const r = areaStretchRoutine(tags, mins);
  closeModal();
  if (!r.list.length) { toast("Couldn't find a stretch for that pick — try a different area."); return; }
  ST.soreLog.push({ date: today(), areas: areaIds });
  save();
  startRoutine({
    list: r.list, kind: 'stretch', title: '🧘 Stretch',
    endLabel: 'end — back to Today',
    onDone: () => go('home'),
  });
};

/* ================= movement prep + run cool-down ================= */
/* ST.routines is keyed by date rather than hung off the run record, because
   saveRun() REPLACES ST.runs[date] wholesale — a flag stored there would
   silently vanish the moment the run was logged. */
const PREP_MINS_LIFT = 6;               // default; the readiness sheet offers the rest
const PREP_MINS_CHOICES = [4, 6, 8];
function markRoutine(date, kind, mins, count) {
  if (!ST.routines) ST.routines = {};
  const r = ST.routines[date] || (ST.routines[date] = {});
  r[kind] = { mins, items: count, completed: true, ts: Date.now() };
  save();
}
function routineDone(date, kind) {
  const r = ST.routines && ST.routines[date];
  return !!(r && r[kind] && r[kind].completed);
}
/* Lift day: warm up, then fall straight into the session. */
function startLiftPrep(date, tpl, readiness, downgrade, guidance, mins) {
  closeModal();
  const m = mins || PREP_MINS_LIFT;
  const r = prepRoutine(plannedLoads(tpl, date, ST.maintenance.mesoStart), m, { soreBias: !!(readiness && readiness.sore >= 4) });
  startRoutine({
    list: r.list, kind: 'prep', title: '🔥 Warm-up',
    endLabel: 'skip the rest — start the workout',
    markComplete: () => markRoutine(date, 'prep', m, r.list.length),
    onDone: () => beginSession(date, tpl, readiness, downgrade, guidance),
  });
}
/* Run day: no jog, no strides — mobilise and switch on, then go out the door.
   The first easy kilometre of the run is the temperature raise. */
window.startRunPrep = function (date) {
  const day = dayFor(date);
  const mins = runPrepMins(day);
  const r = prepRoutine(runLoads(day), mins, {});
  startRoutine({
    list: r.list, kind: 'prep', title: '🔥 Warm-up',
    endLabel: 'end warm-up — back to today',
    markComplete: () => markRoutine(date, 'prep', mins, r.list.length),
    onDone: () => go('home'),
  });
};
window.offerRunStretch = function (date) {
  const day = dayFor(date);
  const est = m => Math.round(stretchRoutine(runLoads(day), m, {}).total / 60);
  const m = $('#modal');
  m.innerHTML = `<div class="sheet"><h2>Cool down?</h2>
    <div class="dim" style="margin-bottom:12px;font-size:.9rem">Built around what a ${esc((runType(day) === 'race' ? 'race' : runType(day)) + ' run')} loads — calves, hamstrings, hips and glutes. This is for range of motion and winding down; the lifting is what protects you from injury.</div>
    <button class="btn primary big" onclick="startRunStretch('${date}',7)">🧘 Standard — ~${est(7)} min</button>
    <button class="btn big" onclick="startRunStretch('${date}',5)">Short — ~${est(5)} min</button>
    <button class="btn big" onclick="startRunStretch('${date}',10)">Long — ~${est(10)} min</button>
    <button class="linkbtn" onclick="closeModal()">Not now</button></div>`;
  m.classList.add('open');
};
window.startRunStretch = function (date, mins) {
  closeModal();
  const day = dayFor(date);
  const r = stretchRoutine(runLoads(day), mins, {});
  startRoutine({
    list: r.list, kind: 'stretch', title: '🧘 Cool down',
    endLabel: 'end stretching — back to today',
    markComplete: () => markRoutine(date, 'stretch', mins, r.list.length),
    onDone: () => go('home'),
  });
};
/* Two phases per hold: 'ready' = the STRETCH_SETUP_SECS get-into-position gap
   (next stretch already on screen), 'hold' = the stretch itself. Nothing starts
   holding until the setup gap has run out or you tap "start now". */
function setupSecs(st) { return st && st.setup != null ? st.setup : STRETCH_SETUP_SECS; }
function beginPhase(phase) {
  const st = SR.list[SR.idx];
  SR.phase = phase;
  SR.paused = false;
  SR.lastBlip = null;
  SR.endTs = Date.now() + (phase === 'ready' ? setupSecs(st) : st.hold) * 1000;
  clearInterval(SR.int);
  SR.int = setInterval(tickStretch, 250);
}
/* Every routine — post-session stretch, pre-session prep, post-run stretch —
   runs on this one engine; the only difference is what happens at the end. A
   lift stretch closes the session out to the summary, a run routine goes back
   to Today. SR.onDone carries that difference so the timer never has to know. */
function routineEnd(completed) {
  if (!SR) return;
  clearInterval(SR.int);
  if (completed && typeof SR.markComplete === 'function') SR.markComplete();
  const done = SR.onDone;
  SR = null;
  if (typeof done === 'function') done();
}
function stretchTotalRemain() {
  const cur = SR.list[SR.idx];
  let t = SR.paused ? Math.ceil(SR.pausedRemain / 1000) : Math.max(0, Math.ceil((SR.endTs - Date.now()) / 1000));
  if (SR.phase === 'ready') t += cur.hold;                          // the hold this setup leads into
  if (cur.perSide && SR.side === 1) t += setupSecs(cur) + cur.hold;  // the other side, setup included
  for (let i = SR.idx + 1; i < SR.list.length; i++) t += stretchDur(SR.list[i]);
  return t;
}
/* advance past the hold that just finished (or was skipped) */
function stretchAdvance() {
  const st = SR.list[SR.idx];
  if (st.perSide && SR.side === 1) { SR.side = 2; beginPhase('ready'); render(); return; }
  SR.idx++; SR.side = 1;
  if (SR.idx >= SR.list.length) { routineEnd(true); return; }
  beginPhase('ready'); render();
}
function tickStretch() {
  if (!SR || SR.paused) return;
  const remain = Math.ceil((SR.endTs - Date.now()) / 1000);
  const c = document.getElementById('st-count');
  const tt = document.getElementById('st-total');
  if (c) c.textContent = Math.max(0, remain) + 's';
  if (tt) tt.textContent = fmtSecs(stretchTotalRemain()) + ' left';
  // audible last-three countdown through the setup gap — the phone is on the floor
  if (SR.phase === 'ready' && remain > 0 && remain <= 3 && SR.lastBlip !== remain) { SR.lastBlip = remain; blip(); }
  if (remain > 0) return;
  if (SR.phase === 'ready') { chime(); vibrate(60); beginPhase('hold'); render(); return; }
  chime(); vibrate([200, 80, 200]);
  stretchAdvance();
}
/* short single tone — the setup countdown, distinct from the two-note chime */
function blip() {
  if (!ST.settings.sound || !audioCtx) return;
  try {
    const t = audioCtx.currentTime;
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.frequency.value = 660; o.type = 'sine';
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.22, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    o.connect(g); g.connect(audioCtx.destination);
    o.start(t); o.stop(t + 0.14);
  } catch (e) {}
}
window.stretchPause = function () {
  if (!SR) return;
  if (SR.paused) { SR.endTs = Date.now() + SR.pausedRemain; SR.paused = false; }
  else { SR.pausedRemain = Math.max(0, SR.endTs - Date.now()); SR.paused = true; }
  render();
};
/* Skip = drop this item entirely (both sides) and set up the next one. */
window.stretchSkip = function () {
  if (!SR) return;
  SR.idx++; SR.side = 1;
  if (SR.idx >= SR.list.length) { routineEnd(true); return; }
  beginPhase('ready'); render();
};
/* Sits below the controls deliberately: expanding it mid-routine must never
   shift the Pause and Skip buttons out from under your thumb. */
window.toggleRoutineWhy = function () { if (!SR) return; SR.showWhy = !SR.showWhy; render(); };
/* in position early — don't make them wait out the setup gap */
window.stretchStartNow = function () {
  if (!SR || SR.phase !== 'ready') return;
  ensureAudio();
  beginPhase('hold'); render();
};
window.stretchEnd = function () { routineEnd(false); };
function vStretch() {
  if (!SR) return vHome();
  const st = SR.list[SR.idx];
  const ready = SR.phase === 'ready';
  const remain = SR.paused ? Math.ceil(SR.pausedRemain / 1000) : Math.max(0, Math.ceil((SR.endTs - Date.now()) / 1000));
  const sideTxt = st.perSide ? (SR.side === 1 ? 'First side' : 'Other side') : '';
  /* A prep item is a movement, not a hold, so the working phase says GO and the
     early-start button doesn't talk about getting into position. */
  const isPrep = SR.kind === 'prep';
  const working = isPrep ? 'GO' : 'HOLD IT';
  const startTxt = isPrep ? '▶ Ready — start' : "▶ I'm in position — start";
  return `<header class="top slim"><div class="phase">${esc(SR.title)} · ${SR.idx + 1} of ${SR.list.length}</div>
      <div class="prog-txt" style="margin-left:auto" id="st-total">${fmtSecs(stretchTotalRemain())} left</div></header>
    <main style="text-align:center">
      <div class="st-kicker ${ready ? 'ready' : ''}">${ready ? (SR.side === 2 ? 'SWAP SIDES — GET READY' : 'GET READY') : working}</div>
      <h1 style="font-size:1.5rem;margin-top:6px">${esc(st.name)}</h1>
      ${sideTxt ? `<div class="badge mid" style="margin-top:6px">${sideTxt}</div>` : ''}
      <div class="stretch-count ${ready ? 'ready' : ''}" id="st-count">${remain}s</div>
      <p class="stretch-instr">${esc(st.instr)}</p>
      ${ready ? `<button class="btn primary big" style="margin-top:18px" onclick="stretchStartNow()">${startTxt}</button>` : ''}
      <div style="display:flex;gap:10px;margin-top:${ready ? 10 : 22}px">
        <button class="btn big" style="flex:1" onclick="stretchPause()">${SR.paused ? '▶ Resume' : '⏸ Pause'}</button>
        <button class="btn big" style="flex:1" onclick="stretchSkip()">Skip →</button>
      </div>
      ${st.why ? `<div class="rt-why">
        <button class="linkbtn" onclick="toggleRoutineWhy()">${SR.showWhy ? '▲ hide' : '▼ why this helps your half'}</button>
        ${SR.showWhy ? `<p class="rt-why-txt">${esc(st.why)}</p>` : ''}
      </div>` : ''}
      <button class="linkbtn" onclick="stretchEnd()">${esc(SR.endLabel)}</button>
    </main>`;
}

/* ================= PR taxonomy + adherence ================= */
/* PR types per exercise: weight (heaviest ever), reps (most reps at ≥ a given weight), e1RM. */
function bestsBefore(exId, date) {
  const hist = exHistory(exId, date);
  let maxW = 0, maxE = 0;
  const repsAt = {};   // weight → best reps at ≥ that weight
  for (const h of hist) for (const t of h.sets) {
    if (t.weight == null || !t.reps) continue;
    maxW = Math.max(maxW, t.weight);
    maxE = Math.max(maxE, e1rm(t.weight, t.reps, t.rpe));
    repsAt[t.weight] = Math.max(repsAt[t.weight] || 0, t.reps);
  }
  return { maxW, maxE, repsAt, any: hist.length > 0 };
}
function sessionPRs(s) {
  const out = [];
  for (const e of s.exercises) {
    const ex = EXERCISES[e.exId];
    if (!ex || ex.mode === 'bw' || ex.mode === 'time' || ex.mode === 'carry') continue;
    const done = e.sets.filter(t => t.done && t.weight != null && t.reps > 0);
    if (!done.length) continue;
    const b = bestsBefore(e.exId, s.date);
    if (!b.any) continue;   // first exposure isn't a PR, it's a baseline
    const topW = Math.max(...done.map(t => t.weight));
    if (topW > b.maxW) out.push({ ex: ex.name, kind: 'weight', text: `${ex.name} — weight PR: ${topW} kg` });
    for (const t of done) {
      const prevBest = Math.max(0, ...Object.entries(b.repsAt).filter(([w]) => +w >= t.weight).map(([, r]) => r));
      if (prevBest > 0 && t.reps > prevBest && t.weight <= b.maxW) { out.push({ ex: ex.name, kind: 'reps', text: `${ex.name} — rep PR: ${t.reps} reps @ ${t.weight} kg` }); break; }
    }
    const bestE = Math.max(...done.map(t => e1rm(t.weight, t.reps, t.rpe)));
    if (bestE > b.maxE && b.maxE > 0) out.push({ ex: ex.name, kind: 'e1rm', text: `${ex.name} — e1RM PR: ${bestE.toFixed(1)} kg` });
  }
  return out;
}
/* adherence: planned lift days to date (program or maintenance) vs completed, + current streak */
function adherence() {
  const t = today();
  if (ST.maintenance.active) {
    // maintenance: 3/week (balanced) or 5/week (hypertrophy) since start
    const perWeek = ST.maintenance.program === 'hypertrophy' ? HYPER_ORDER.length : 3;
    const weeks = Math.max(1, Math.ceil((new Date(t) - new Date(ST.maintenance.startedOn || t)) / (7 * 86400000)));
    const done = Object.values(ST.sessions).filter(s => s.status === 'done' && s.date >= (ST.maintenance.startedOn || t)).length;
    return { done, planned: weeks * perWeek, streak: null };
  }
  const days = [];
  for (const wk of ST.program.weeks) for (const d of wk.days) if (d.kind === 'lift' && d.date <= t) days.push(d.date);
  const done = days.filter(d => ST.sessions[d] && ST.sessions[d].status === 'done').length;
  let streak = 0;
  for (let i = days.length - 1; i >= 0; i--) {
    if (ST.sessions[days[i]] && ST.sessions[days[i]].status === 'done') streak++;
    else if (days[i] !== t) break;   // today's not-yet-done session doesn't break the streak
  }
  return { done, planned: days.length, streak };
}

/* ---------- summary ---------- */
function vSummary() {
  const s = ST.sessions[view.sid];
  if (!s) return vHome();
  let vol = 0, rpeNow = [], rpePrev = [];
  for (const e of s.exercises) {
    const ex = EXERCISES[e.exId];
    const done = e.sets.filter(t => t.done);
    for (const t of done) {
      if (ex.mode === 'reps') vol += (t.weight || 0) * (t.reps || 0) * (ex.perSide ? 2 : 1);
      if (t.rpe != null) rpeNow.push(t.rpe);
    }
    const prev = exHistory(e.exId, s.date).slice(-1)[0];
    if (prev) prev.sets.forEach(t => { if (t.rpe != null) rpePrev.push(t.rpe); });
  }
  const prs = sessionPRs(s).map(p => p.text);   // weight + rep + e1RM PRs
  const avg = a => a.length ? (a.reduce((x, y) => x + y, 0) / a.length) : null;
  const rN = avg(rpeNow), rP = avg(rpePrev);
  const mins = s.finishedTs && s.startedTs ? Math.round((s.finishedTs - s.startedTs) / 60000) : null;
  return `<header class="top"><h1 class="phase">${esc(phaseLabel(s.date))}</h1></header>
  <main>
    <div class="card"><div class="card-kicker">Session complete ✓</div><div class="card-title">${esc(s.title)}</div>
    <div class="card-sub">${fmtDate(s.date)}${mins ? ` · ${mins} min` : ''}${s.downgraded ? ' · downgraded' : ''}</div></div>
    <div class="statgrid">
      <div class="stat"><div class="stat-v">${(vol / 1000).toFixed(1)}t</div><div class="stat-l">total volume</div></div>
      <div class="stat"><div class="stat-v">${rN ? rN.toFixed(1) : '—'}</div><div class="stat-l">avg RPE${rP ? ` (last: ${rP.toFixed(1)})` : ''}</div></div>
      <div class="stat"><div class="stat-v">${prs.length}</div><div class="stat-l">PRs</div></div>
    </div>
    ${prs.length ? `<div class="card gold"><div class="card-kicker">🏆 New PRs</div>${prs.map(p => `<div class="pr">${esc(p)}</div>`).join('')}</div>` : ''}
    ${s.exercises.map((e, ei) => {
      const ex = EXERCISES[e.exId];
      const done = e.sets.filter(t => t.done);
      return `<div class="sumrow"><b>${esc(ex.name)} <button class="mini editbtn" onclick="openEditSets('${s.id}',${ei})">✎ edit</button></b><span>${done.map(t => setStr(ex, t)).join(' · ') || 'skipped'}</span>
        ${done.filter(t => t.note).map(t => `<div class="notesum">📝 ${esc(t.note)}</div>`).join('')}</div>`;
    }).join('')}
    <button class="btn primary big" onclick="go('home');maybeWeeklySummary()">Done</button>
  </main>${navBar()}`;
}

/* ---------- edit past sets ---------- */
window.openEditSets = function (sid, ei) {
  const s = ST.sessions[sid]; const e = s.exercises[ei]; const ex = EXERCISES[e.exId];
  const unit = ex.mode === 'time' ? 'secs' : ex.mode === 'carry' ? 'metres' : 'reps';
  const m = $('#modal');
  m.innerHTML = `<div class="sheet"><h2>Edit — ${esc(ex.name)}</h2>
    <div class="editgrid-head"><span>#</span><span>kg</span><span>${unit}</span><span>RPE</span><span>done</span></div>
    ${e.sets.map((t, i) => `<div class="editrow">
      <span>${i + 1}</span>
      <input type="number" step="any" inputmode="decimal" id="ew-${i}" value="${t.weight ?? ''}">
      <input type="number" step="1" inputmode="numeric" id="er-${i}" value="${t.reps ?? ''}">
      <input type="number" step="0.5" min="6" max="10" inputmode="decimal" id="ep-${i}" value="${t.rpe ?? ''}">
      <input type="checkbox" id="ed-${i}" ${t.done ? 'checked' : ''}>
    </div>`).join('')}
    <button class="btn primary big" onclick="saveEditSets('${sid}',${ei})">Save changes</button>
    <button class="linkbtn" onclick="closeModal()">Cancel</button></div>`;
  m.classList.add('open');
};
window.saveEditSets = function (sid, ei) {
  const s = ST.sessions[sid]; const e = s.exercises[ei];
  e.sets.forEach((t, i) => {
    const num = id => { const v = $('#' + id + '-' + i).value; return v === '' ? null : parseFloat(v); };
    t.weight = num('ew'); t.reps = num('er'); t.rpe = num('ep');
    t.done = $('#ed-' + i).checked;
  });
  save(); closeModal(); render();
};

/* ---------- schedule ---------- */
function vSchedule() {
  const t = today();
  const w = weekFor(t);
  const ad = adherence();
  return `<header class="top"><h1 class="phase">${esc(phaseLabel(t))}</h1>${raceCountdowns()}
    <div class="dim small" style="margin-top:6px">💪 ${ad.done} of ${ad.planned} workouts${ad.streak != null && ad.streak >= 2 ? ` · 🔥 ${ad.streak}-workout streak` : ''}</div></header>
  <main>
  ${ST.program.weeks.map(wk => `
    <div class="wk ${w && wk.num === w.num ? 'cur' : ''}">
      <div class="wk-head"><b>Week ${wk.num}</b><span>${esc(wk.phase)}</span></div>
      ${wk.days.map(d => {
        const s = ST.sessions[d.date];
        const done = s && s.status === 'done';
        const isRun = d.kind === 'run' || d.kind === 'race';
        const merged = mergedRunFor(d.date);
        const runRec = isRun && (merged || ST.runs[d.date]);
        const runLogged = isRun && !!merged;
        const runSkipped = isRun && !merged && ST.runs[d.date] && ST.runs[d.date].skipped;
        const extraRun = !isRun && merged && merged.src !== 'manual';   // synced run on a non-plan day (Runna ≠ plan)
        const icon = d.kind === 'run' ? '🏃' : d.kind === 'race' ? '🏁' : d.kind === 'lift' ? '🏋️' : d.kind === 'mobility' ? '🧘' : '·';
        let action = '';
        if (done) action = `<button class="mini" onclick="go('summary',{sid:'${d.date}'})">view</button>`;
        else if (isRun && d.date <= t) action = `<button class="mini" onclick="openRunLog('${d.date}')">${runRec ? 'edit' : 'log'}</button>`;
        return `<div class="wk-day ${d.date === t ? 'today' : ''} ${d.kind}">
          <span class="wk-date">${fmtDate(d.date)}</span>
          <span class="wk-icon">${extraRun ? '🏃' : icon}</span>
          <span class="wk-title">${extraRun ? esc(merged.name || 'Run') + ' <span class="svbadge '+merged.src+'">'+merged.src+'</span>' : esc(d.title || 'Rest')}${done || runLogged ? ' <b class="done-tick">✓</b>' : ''}${runSkipped ? ' <span class="dim">✗</span>' : ''}${(runLogged || extraRun) && merged ? ` <span class="dim">${merged.km}km · ${paceStr(merged.km, merged.min) || ''}${merged.src === 'strava' && runLogged ? ' ⚡' : ''}</span>` : ''}</span>
          ${action}
        </div>`;
      }).join('')}
    </div>`).join('')}
  ${ST.maintenance.active ? '' : `<div class="section-label">Race kits</div>
    ${RACES.map(r => {
      const st = ST.races[r.key];
      const done = Object.values(st.checklist).filter(Boolean).length;
      const d = daysUntil(r.date);
      const status = st.result ? `ran ${esc(st.result)}` : d >= 0 ? `${done} of ${RACE_CHECKLIST.length} ticked · ${d} day${d === 1 ? '' : 's'} out` : `${done} of ${RACE_CHECKLIST.length} ticked`;
      return `<button class="exlist-row" onclick="openChecklist('${r.key}')"><span>🏁 ${esc(r.name)}</span><span class="dim">${status}</span><span>›</span></button>`;
    }).join('')}`}
  <button class="linkbtn" onclick="showWhy()">Why this plan?</button>
  </main>${navBar()}`;
}

window.showWhy = function () {
  const m = $('#modal');
  m.innerHTML = `<div class="sheet"><div class="why">${WHY_SCHEDULE.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\n/g, '<br>')}</div>
  <button class="btn primary big" onclick="closeModal()">Got it</button></div>`;
  m.classList.add('open');
};

/* ================= Progress tab =================
   One tab for looking back, two segments: Log (the record — runs, volume, per-lift
   history, weekly summaries, recovery markers) and Insights (the analysis — PR book,
   strength trajectory, aerobic verdict, cause-and-effect). They were separate
   "History" and "Trends" tabs, which split the same question ("how is my squat
   going?") across two places that both deep-linked to the same detail screen. */
let progressTab = 'log';   // remembered across navigations within a session
window.setProgressTab = function (t) { progressTab = t; view = { name: 'progress', tab: t }; render(); window.scrollTo(0, 0); };
function vProgress() {
  const tab = view.tab || progressTab;
  progressTab = tab;
  const seg = `<div class="seg" role="tablist">
    <button class="seg-btn ${tab === 'log' ? 'sel' : ''}" role="tab" aria-selected="${tab === 'log'}" onclick="setProgressTab('log')">📈 Log</button>
    <button class="seg-btn ${tab === 'insights' ? 'sel' : ''}" role="tab" aria-selected="${tab === 'insights'}" onclick="setProgressTab('insights')">📊 Insights</button>
  </div>`;
  return `<header class="top"><h1 class="phase">Progress</h1>${seg}</header>
  <main>${tab === 'log' ? logBody() : insightsBody()}</main>${navBar()}`;
}

/* ---------- Progress · Log (was the History tab) ---------- */
function logBody() {
  // weekly volume
  const weekVols = ST.program.weeks.map(wk => {
    let vol = 0, sessions = 0;
    for (const d of wk.days) {
      const s = ST.sessions[d.date];
      if (!s || s.status !== 'done') continue;
      sessions++;
      for (const e of s.exercises) {
        const ex = EXERCISES[e.exId];
        if (ex.mode !== 'reps') continue;
        for (const t of e.sets.filter(x => x.done)) vol += (t.weight || 0) * (t.reps || 0) * (ex.perSide ? 2 : 1);
      }
    }
    return { wk: wk.num, vol, sessions };
  });
  const maxV = Math.max(1, ...weekVols.map(v => v.vol));
  // exercises with history
  const withHist = Object.keys(EXERCISES).filter(id => exHistory(id).length > 0);
  // running progress (merged: Strava is source of truth, manual entries fill gaps + carry feel)
  const mergedAll = mergedRunsAll();
  const runPts = Object.keys(mergedAll).map(d => {
    const r = mergedAll[d]; const day = dayFor(d);
    const type = day && day.kind === 'race' ? 'race' : runKind(d, r);
    return { date: d, km: r.km, min: r.min, hr: r.hr, feel: r.feel, splits: r.splits || [], type, src: r.src, name: r.name, pace: r.km && r.min ? r.min * 60 / r.km : null };
  }).filter(p => p.pace);
  const weekKms = ST.program.weeks.map(wk => {
    let km = 0;
    for (const d of wk.days) { const r = mergedAll[d.date]; if (r) km += r.km || 0; }
    return { wk: wk.num, km };
  });
  const maxKm = Math.max(1, ...weekKms.map(v => v.km));
  const typeIcon = t => t === 'Hard Run' ? '⚡' : t === 'Long Run' ? '🛣️' : t === 'race' ? '🏁' : '🏃';
  return `
    <div class="dim small" style="margin:-4px 0 10px">${esc(phaseLabel(today()))}</div>
    ${vFitness()}
    <div class="section-label">🏃 Running — weekly km</div>
    <div class="volchart">${weekKms.map(v => `<div class="volcol"><div class="volbar runbar" style="height:${Math.max(2, 100 * v.km / maxKm)}%"></div><div class="voln">${v.km ? v.km.toFixed(0) : ''}</div><div class="voll">W${v.wk}</div></div>`).join('')}</div>
    <div class="section-label">Pace trend (min/km — up = faster)</div>
    ${runPaceChart(runPts)}
    ${runPts.length ? `<div class="section-label">Run log</div>` + runPts.slice().reverse().map(p =>
      `<div class="sumrow"><b>${typeIcon(p.type)} ${fmtDate(p.date)} — ${esc(p.type === 'race' ? 'RACE' : p.type)}${p.src !== 'manual' ? ' <span class="svbadge ' + p.src + '">' + p.src + '</span>' : ''}</b>
       <span>${p.km} km · ${p.min} min · ${paceStr(p.km, p.min)}${p.hr ? ` · ${p.hr} bpm` : ''}${p.feel ? ` · felt ${p.feel}` : ''}</span>
       ${p.splits.length ? `<div class="notesum">splits: ${p.splits.map(fmtSplit).join(' · ')}</div>` : ''}</div>`).join('') : ''}
    ${ST.weeklySummaries.length ? `<div class="section-label">📒 Weekly summaries</div>` + ST.weeklySummaries.slice().reverse().map((s, i) =>
      `<button class="exlist-row" onclick='showWeeklySummary(ST.weeklySummaries[${ST.weeklySummaries.length - 1 - i}], true)'><span>${esc(s.phase)}</span><span class="dim">week of ${fmtDate(s.weekOf)}</span><span>›</span></button>`).join('') : ''}
    <div class="section-label">🏋️ Lifting — weekly volume (tonnes)</div>
    <div class="volchart">${weekVols.map(v => `<div class="volcol"><div class="volbar" style="height:${Math.max(2, 100 * v.vol / maxV)}%"></div><div class="voln">${(v.vol / 1000).toFixed(1)}</div><div class="voll">W${v.wk}</div></div>`).join('')}</div>
    <div class="section-label">Every lift you've logged</div>
    ${withHist.length ? withHist.map(id => {
      const h = exHistory(id);
      const last = h[h.length - 1];
      const top = Math.max(...last.sets.map(t => t.weight || 0));
      return `<button class="exlist-row" onclick="go('exdetail',{ex:'${id}',back:'log'})"><span>${esc(EXERCISES[id].name)}</span><span class="dim">${h.length} session${h.length > 1 ? 's' : ''} · last ${top} kg</span><span>›</span></button>`;
    }).join('') : `<div class="card"><div class="card-sub">No workouts logged yet. Charts appear here after your first session.</div></div>`}`;
}

function vExDetail() {
  const id = view.ex; const ex = EXERCISES[id];
  const h = exHistory(id);
  const pts = h.map(s => ({
    date: s.date,
    top: Math.max(...s.sets.map(t => t.weight || 0)),
    e1: Math.max(...s.sets.map(t => e1rm(t.weight, t.reps, t.rpe))),
  }));
  const backTab = view.back === 'insights' || view.back === 'trends' ? 'insights' : 'log';
  return `<header class="top slim"><button class="backbtn" aria-label="Back to Progress" onclick="setProgressTab('${backTab}')">‹</button><h1 class="phase">${esc(ex.name)}</h1></header>
  <main>
    ${ex.steps ? `<div class="card"><div class="card-kicker">📋 How to</div>
      <ol class="ex-steps" style="color:var(--fg)">${ex.steps.map(s => `<li>${esc(s)}</li>`).join('')}</ol></div>` : ''}
    ${ex.why ? `<div class="card"><div class="card-kicker">🎯 Why this helps your half</div>
      <div class="card-sub" style="color:var(--fg)">${esc(ex.why)}</div>
      ${ex.deep ? `<div class="card-sub" style="margin-top:8px">${esc(ex.deep)}</div>` : ''}</div>` : ''}
    ${svgChart(pts)}
    ${h.slice().reverse().map(s => `<div class="sumrow"><b>${fmtDate(s.date)}</b><span>${s.sets.map(t => setStr(ex, t)).join(' · ')}</span>
      ${s.sets.filter(t => t.note).map(t => `<div class="notesum">📝 ${esc(t.note)}</div>`).join('')}</div>`).join('')}
  </main>${navBar()}`;
}

/* ================= Sunday weekly summary ================= */
function buildWeeklySummary(monday) {
  const sunday = dadd(monday, 6);
  const wk = ST.program.weeks.find(w => w.days[0].date === monday) || weekFor(monday);
  const inWeek = d => d >= monday && d <= sunday;
  const doneSessions = Object.values(ST.sessions).filter(s => s.status === 'done' && inWeek(s.date));
  const planned = ST.maintenance.active ? (ST.maintenance.program === 'hypertrophy' ? HYPER_ORDER.length : 3) : wk ? wk.days.filter(d => d.kind === 'lift').length : 4;
  // strength movement vs LAST week
  const prevMon = dadd(monday, -7), prevSun = dadd(monday, -1);
  const topIn = (exId, from, to) => {
    let w = 0, repsAtW = 0;
    for (const s of Object.values(ST.sessions)) {
      if (s.status !== 'done' || s.date < from || s.date > to) continue;
      for (const e of s.exercises) if (e.exId === exId)
        for (const t of e.sets.filter(x => x.done && x.weight != null)) {
          if (t.weight > w) { w = t.weight; repsAtW = t.reps; }
          else if (t.weight === w && t.reps > repsAtW) repsAtW = t.reps;
        }
    }
    return { w, repsAtW };
  };
  const trained = [...new Set(doneSessions.flatMap(s => s.exercises.filter(e => e.sets.some(x => x.done)).map(e => e.exId)))];
  const improvements = [], prs = [];
  for (const exId of trained) {
    const ex = EXERCISES[exId]; if (!ex || ex.mode === 'bw') continue;
    const now = topIn(exId, monday, sunday), prev = topIn(exId, prevMon, prevSun);
    if (prev.w > 0 && now.w > prev.w) improvements.push(`${ex.name}: ${prev.w}→${now.w} kg`);
    else if (prev.w > 0 && now.w === prev.w && now.repsAtW > prev.repsAtW) improvements.push(`${ex.name}: +${now.repsAtW - prev.repsAtW} rep${now.repsAtW - prev.repsAtW > 1 ? 's' : ''} at ${now.w} kg`);
    // e1RM PR: best this week vs all-time before this week
    const histBefore = exHistory(exId, monday);
    const bestBefore = Math.max(0, ...histBefore.flatMap(h => h.sets.map(t => e1rm(t.weight, t.reps, t.rpe))));
    let bestNow = 0;
    for (const s of doneSessions) for (const e of s.exercises) if (e.exId === exId)
      for (const t of e.sets.filter(x => x.done)) bestNow = Math.max(bestNow, e1rm(t.weight, t.reps, t.rpe));
    if (histBefore.length && bestNow > bestBefore) prs.push(ex.name);
  }
  // recovery picture
  const hrvPts = fitnessEntries().filter(e => inWeek(e.date) && e.hrv != null).map(e => e.hrv);
  const base = hrvBaseline(monday);
  const hrvAvg = hrvPts.length ? hrvPts.reduce((a, b) => a + b, 0) / hrvPts.length : null;
  const sore = doneSessions.filter(s => s.readiness).map(s => s.readiness.sore);
  const fat = doneSessions.filter(s => s.readiness).map(s => s.readiness.fat);
  const avg = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
  // weekly tonnage for the "biggest week" read
  const tonnes = ws => { let v = 0; for (const s of Object.values(ST.sessions)) { if (s.status !== 'done' || s.date < ws || s.date > dadd(ws, 6)) continue; for (const e of s.exercises) { const ex = EXERCISES[e.exId]; if (ex.mode !== 'reps') continue; for (const t of e.sets.filter(x => x.done)) v += (t.weight || 0) * (t.reps || 0) * (ex.perSide ? 2 : 1); } } return v; };
  const thisT = tonnes(monday);
  let biggest = true;
  for (let i = 1; i <= 8; i++) if (tonnes(dadd(monday, -7 * i)) > thisT) { biggest = false; break; }
  let readLine;
  if (hrvAvg == null) readLine = 'No HRV logged this week — the morning check-in feeds this picture.';
  else if (base.ready && hrvAvg >= base.mean * 0.97) readLine = biggest && thisT > 0 ? 'Recovery held steady despite your biggest week yet.' : 'Recovery held steady — training and rest are in balance.';
  else if (base.ready && hrvAvg < base.mean * 0.93) readLine = 'Recovery dipped this week — the plan\'s lighter days exist for exactly this.';
  else readLine = 'Recovery roughly on baseline — nothing to action.';
  // runs
  const merged = mergedRunsAll();
  const runKm = Object.keys(merged).filter(inWeek).reduce((a, d) => a + (merged[d].km || 0), 0);
  // phase context
  const nextWk = wk ? ST.program.weeks.find(w => w.num === wk.num + 1) : null;
  const raceDays = daysUntil(RACES[1].date);
  const PHASE_FOCUS = {
    'Intro': 'settling into the pattern', 'Build': 'the heaviest work of the block lives here',
    'Build — peak load': 'the peak — after this it only gets lighter', 'Geelong mini-taper': 'volume drops for the tune-up race — that\'s the plan working, not slacking',
    'Recover → rebuild': 'recover from Geelong, one last leg stimulus late in the week', 'Taper': 'volume keeps dropping while intensity stays crisp — race legs loading',
    'Melbourne race week': 'almost nothing in the gym: the work is done',
  };
  const phaseKey = p => Object.keys(PHASE_FOCUS).find(k => (p || '').startsWith(k.split(' —')[0]));
  const nextFocus = nextWk ? (PHASE_FOCUS[phaseKey(nextWk.phase)] || nextWk.phase) : 'race day — go get it';
  // a note of yours from the week
  let note = null;
  for (const s of doneSessions) for (const e of s.exercises) for (const t of e.sets) if (t.note && (!note || t.note.length > note.length)) note = t.note;
  for (const d of Object.keys(ST.runs)) if (inWeek(d) && ST.runs[d].note && (!note || ST.runs[d].note.length > note.length)) note = ST.runs[d].note;
  return { weekOf: monday, phase: ST.maintenance.active ? (ST.maintenance.program === 'hypertrophy' ? 'Hypertrophy phase' : 'Maintenance') : wk ? `Week ${wk.num} — ${wk.phase}` : 'off-plan week',
    nextPhase: ST.maintenance.active ? null : nextWk ? `Week ${nextWk.num} — ${nextWk.phase}` : null,
    nextFocus: ST.maintenance.active ? (ST.maintenance.program === 'hypertrophy' ? 'hypertrophy phase — chest & arms priority, 5 sessions a week' : 'maintenance — 3 workouts a week, your pace') : nextFocus,
    raceWeeks: Math.max(0, Math.ceil(raceDays / 7)),
    sessionsDone: doneSessions.length, planned, improvements, prs,
    hrvPts, hrvAvg: hrvAvg != null ? Math.round(hrvAvg) : null, hrvBase: base.ready ? Math.round(base.mean) : null,
    soreAvg: avg(sore), fatAvg: avg(fat), readLine, runKm: Math.round(runKm * 10) / 10, tonnes: Math.round(thisT / 100) / 10, note,
    insight: (() => { try { return topInsight(); } catch (e) { return null; } })() };
}
function spark(vals, w, h) {
  if (!vals || vals.length < 2) return '';
  const min = Math.min(...vals), max = Math.max(...vals);
  const x = i => (i / (vals.length - 1)) * (w - 4) + 2;
  const y = v => h - 3 - (max === min ? h / 2 : (v - min) / (max - min) * (h - 6));
  return `<svg width="${w}" height="${h}" style="vertical-align:middle"><polyline fill="none" stroke="var(--acc)" stroke-width="1.5" points="${vals.map((v, i) => x(i).toFixed(1) + ',' + y(v).toFixed(1)).join(' ')}"/></svg>`;
}
function weeklySummaryDue() {
  if (!ST.sessions || !Object.keys(ST.sessions).length) return null;
  const t = today();
  const wk = weekFor(t);
  let monday = null;
  const dow = new Date(t + 'T12:00').getDay();
  if (dow === 0 && new Date().getHours() >= 17) monday = dadd(t, -6);                    // Sunday evening: this week
  else if (dow !== 0) { const prevSunOffset = dow; monday = dadd(t, -(prevSunOffset + 6)); } // Mon+: last week
  if (!monday) return null;
  if (ST.weeklySummaries.some(s => s.weekOf === monday)) return null;
  const sum = buildWeeklySummary(monday);
  if (!sum.sessionsDone && !sum.runKm) return null;   // nothing happened — nothing to summarise
  return sum;
}
function showWeeklySummary(sum, archived) {
  const m = $('#modal');
  const soreTxt = sum.soreAvg != null ? `soreness ${sum.soreAvg.toFixed(1)}/5 · fatigue ${sum.fatAvg.toFixed(1)}/5 avg` : 'no check-ins logged';
  m.innerHTML = `<div class="sheet">
    <div class="card-kicker">📒 Week in review</div>
    <h2 style="margin-bottom:2px">${esc(sum.phase)}</h2>
    <div class="dim small" style="margin-bottom:10px">week of ${fmtDate(sum.weekOf)}</div>
    <div class="wksum-row"><b>${sum.sessionsDone}/${sum.planned}</b> strength sessions · <b>${sum.runKm} km</b> run · <b>${sum.tonnes}t</b> lifted</div>
    ${sum.improvements.length ? `<div class="wksum-block"><div class="wksum-h">Moving up</div>${sum.improvements.map(i => `<div class="wksum-li">▲ ${esc(i)}</div>`).join('')}</div>` : `<div class="wksum-block dim small">No load increases this week — during a taper that's exactly right.</div>`}
    ${sum.prs.length ? `<div class="wksum-block"><div class="wksum-h">🏆 e1RM PRs</div><div class="wksum-li">${sum.prs.map(esc).join(' · ')}</div></div>` : ''}
    <div class="wksum-block"><div class="wksum-h">Recovery</div>
      <div class="wksum-li">${sum.hrvAvg != null ? `HRV avg <b>${sum.hrvAvg}ms</b>${sum.hrvBase ? ` vs ${sum.hrvBase}ms baseline` : ''} ${spark(sum.hrvPts, 90, 22)}` : 'No HRV data this week'}</div>
      <div class="wksum-li dim">${esc(soreTxt)}</div>
      <div class="wksum-li">${esc(sum.readLine)}</div></div>
    <div class="wksum-block"><div class="wksum-h">The plan</div>
      <div class="wksum-li">${sum.phase === 'Maintenance' ? '' : `${sum.raceWeeks} week${sum.raceWeeks === 1 ? '' : 's'} to Melbourne. `}${sum.nextPhase ? `Next: ${esc(sum.nextPhase)} — ${esc(sum.nextFocus)}.` : esc(sum.nextFocus)}</div></div>
    ${sum.insight ? `<div class="wksum-block insight"><div class="wksum-h">💡 Insight of the week</div><div class="wksum-li">${esc(sum.insight)}</div><button class="mini" onclick="closeWeeklySummary(${archived ? 'true' : 'false'});setProgressTab('insights')">More in Insights →</button></div>` : ''}
    ${sum.note ? `<div class="wksum-block"><div class="wksum-h">In your words</div><div class="wksum-li">📝 “${esc(sum.note)}”</div></div>` : ''}
    <button class="btn primary big" onclick="closeWeeklySummary(${archived ? 'true' : 'false'})" style="margin-top:12px">${archived ? 'Close' : 'Nice — archive it'}</button>
  </div>`;
  m.classList.add('open');
  if (!archived) { window._pendingWeekly = sum; }
}
window.closeWeeklySummary = function (wasArchived) {
  if (!wasArchived && window._pendingWeekly) {
    ST.weeklySummaries.push(window._pendingWeekly);
    ST.weeklySummaries = ST.weeklySummaries.slice(-20);
    window._pendingWeekly = null;
    save();
  }
  closeModal();
};
function maybeWeeklySummary() {
  const due = weeklySummaryDue();
  if (due) { showWeeklySummary(due, false); return true; }
  return false;
}

/* ---------- Fitness section (HRV / RHR / VO2 / efficiency / projection) ---------- */
function vFitness() {
  const es = fitnessEntries();
  const t = today();
  const b = hrvBaseline(dadd(t, 1));   // baseline including today's entry history
  const latest = es[es.length - 1];
  const vo2Dates = Object.keys(ST.fitness.vo2).sort();
  const vo2 = vo2Dates.length ? ST.fitness.vo2[vo2Dates[vo2Dates.length - 1]] : null;
  const efs = efSeries();
  const proj = raceProjection();
  // insights lines
  const lines = [];
  if (!b.ready) lines.push(`Baseline building — ${Math.min(b.n ?? es.length, 5)} of 5 mornings logged so far. Conclusions come after ~2 weeks of check-ins.`);
  else if (latest) {
    const dev = latest.hrv - b.mean;
    lines.push(`Latest HRV ${latest.hrv} ms vs ${b.mean.toFixed(0)} ms baseline (${dev >= 0 ? '+' : ''}${dev.toFixed(0)}) — ${Math.abs(dev) <= Math.max(0.75 * b.sd, 4) ? 'in your normal range' : dev > 0 ? 'above baseline' : 'below baseline'}.`);
  }
  const dip = recoveryDip();
  if (dip) lines.push(`⚠ ${dip} — worth an easier day; your call.`);
  if (efs.length >= 6) {
    const half = Math.floor(efs.length / 2);
    const m1 = efs.slice(0, half).reduce((a, e) => a + e.ef, 0) / half;
    const m2 = efs.slice(half).reduce((a, e) => a + e.ef, 0) / (efs.length - half);
    const pct = 100 * (m2 - m1) / m1;
    lines.push(`Aerobic efficiency ${pct >= 1 ? 'up ' + pct.toFixed(1) + '% across the block — faster at the same heart rate. The engine is growing.' : pct <= -1 ? 'down ' + Math.abs(pct).toFixed(1) + '% — watch fatigue, fuelling, sleep.' : 'holding steady across the block.'}`);
  } else if (efs.length) lines.push(`Aerobic efficiency: ${efs.length} run${efs.length === 1 ? '' : 's'} with HR logged — trend appears after ~6.`);
  if (proj) {
    for (const r of RACES) { const d = daysUntil(r.date); if (d >= 0) lines.push(`${r.name} (${d}d): projected <b>${proj.range}</b> from your last ${proj.nLongs} long run${proj.nLongs === 1 ? '' : 's'}${vo2 ? ' + VO₂ ' + vo2 : ''}. A range, honestly — race day picks the number.`); }
  } else lines.push('Race projection unlocks after your first logged long run (12 km+ with time).');
  // weekly combined load (runs + lifting)
  const loads = weeklyLoad().filter(w => w.km + w.tonnes > 0);
  if (loads.length >= 2) {
    const recent = loads.slice(-3).map(w => `W${w.wk}: ${w.km}km + ${w.tonnes}t`).join(' · ');
    lines.push(`Weekly load — ${recent}${stravaConnected() ? '' : ' (connect Strava in Settings for automatic run data)'}`);
  }
  const ramp = loadRampFlag();
  if (ramp) lines.push(`⚠ ${ramp}`);
  return `<div class="section-label">💓 Fitness — HRV · VO₂ max <button class="mini" style="margin-left:8px" onclick="updateVo2()">VO₂: ${vo2 ?? '—'} ✎</button></div>
    ${hrvChart(es, t)}
    ${efs.length >= 2 ? efChart(efs) : ''}
    ${lines.map(l => `<div class="sumrow"><span style="color:var(--fg)">${l}</span></div>`).join('')}`;
}
/* HRV chart: daily dots + rolling baseline band (mean ± max(0.75·SD, 4ms)) */
function hrvChart(es, t) {
  const pts = es.filter(e => e.hrv != null).slice(-42);
  if (pts.length < 2) return `<div class="card"><div class="card-sub">Log ${Math.max(0, 2 - pts.length)} more morning check-in${pts.length === 1 ? '' : 's'} to see the HRV chart. Prompts appear on training days.</div></div>`;
  const W = 340, H = 150, P = 26;
  const all = pts.map(p => p.hrv);
  const min = Math.min(...all) * 0.9, max = Math.max(...all) * 1.08;
  const x = i => P + (W - 2 * P) * (pts.length === 1 ? .5 : i / (pts.length - 1));
  const y = v => H - P - (H - 2 * P) * (v - min) / (max - min || 1);
  const bandPts = pts.map((p, i) => ({ i, b: hrvBaseline(dadd(p.date, 1)) })).filter(z => z.b.ready);
  let band = '', baseline = '';
  if (bandPts.length >= 2) {
    const up = bandPts.map(z => `${x(z.i).toFixed(1)},${y(z.b.mean + Math.max(.75 * z.b.sd, 4)).toFixed(1)}`);
    const dn = bandPts.slice().reverse().map(z => `${x(z.i).toFixed(1)},${y(z.b.mean - Math.max(.75 * z.b.sd, 4)).toFixed(1)}`);
    band = `<polygon points="${up.join(' ')} ${dn.join(' ')}" fill="rgba(74,222,128,.10)"/>`;
    baseline = `<polyline class="ln2" points="${bandPts.map(z => `${x(z.i).toFixed(1)},${y(z.b.mean).toFixed(1)}`).join(' ')}"/>`;
  }
  const dots = pts.map((p, i) => {
    const b = hrvBaseline(p.date);
    const low = b.ready && p.hrv < b.mean - Math.max(.75 * b.sd, 4);
    return `<circle cx="${x(i).toFixed(1)}" cy="${y(p.hrv).toFixed(1)}" r="3.2" fill="${low ? 'var(--red)' : 'var(--acc)'}"/>`;
  }).join('');
  return `<div class="chartwrap"><svg viewBox="0 0 ${W} ${H}">
    <text x="${P}" y="13" class="ch-lbl">HRV ms — dots daily · band = your normal range</text>
    <text x="${W - P + 2}" y="${y(max) + 4}" class="ch-ax">${max.toFixed(0)}</text>
    <text x="${W - P + 2}" y="${y(min) + 4}" class="ch-ax">${min.toFixed(0)}</text>
    ${band}${baseline}${dots}
  </svg></div>`;
}
/* aerobic efficiency: EF dots (easy=blue, long=green) + linear trend */
function efChart(pts) {
  const W = 340, H = 140, P = 26;
  const all = pts.map(p => p.ef);
  const min = Math.min(...all) * .96, max = Math.max(...all) * 1.04;
  const x = i => P + (W - 2 * P) * (pts.length === 1 ? .5 : i / (pts.length - 1));
  const y = v => H - P - (H - 2 * P) * (v - min) / (max - min || 1);
  // least-squares trend
  const n = pts.length, xs = pts.map((_, i) => i);
  const mx = xs.reduce((a, b) => a + b, 0) / n, my = all.reduce((a, b) => a + b, 0) / n;
  const slope = xs.reduce((a, xi, i) => a + (xi - mx) * (all[i] - my), 0) / (xs.reduce((a, xi) => a + (xi - mx) ** 2, 0) || 1);
  const trend = `<line class="ln2" x1="${x(0)}" y1="${y(my - mx * slope)}" x2="${x(n - 1)}" y2="${y(my + (n - 1 - mx) * slope)}"/>`;
  const dots = pts.map((p, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(p.ef).toFixed(1)}" r="3.4" fill="${p.type === 'Long Run' ? 'var(--acc)' : 'var(--run)'}"/>`).join('');
  return `<div class="chartwrap"><svg viewBox="0 0 ${W} ${H}">
    <text x="${P}" y="13" class="ch-lbl">Aerobic efficiency (speed ÷ HR) — 🏃 easy · 🛣️ long — up = fitter</text>
    ${trend}${dots}
  </svg></div>`;
}

/* pace trend: inverted y so faster (lower pace) plots higher. Dots coloured by run type. */
function runPaceChart(pts) {
  if (pts.length < 2) return `<div class="card"><div class="card-sub">Log ${2 - pts.length} more run${pts.length === 1 ? '' : 's'} to see your pace trend.</div></div>`;
  const W = 340, H = 170, P = 30;
  const paces = pts.map(p => p.pace);
  const min = Math.min(...paces) * 0.97, max = Math.max(...paces) * 1.03;
  const x = i => P + (W - 2 * P) * (pts.length === 1 ? 0.5 : i / (pts.length - 1));
  const y = v => P + (H - 2 * P) * (v - min) / (max - min || 1); // inverted: fast (small) at top
  const color = t => t === 'Hard Run' ? 'var(--gold)' : t === 'Long Run' ? 'var(--acc)' : t === 'race' ? 'var(--red)' : 'var(--run)';
  const lbl = s => Math.floor(s / 60) + ':' + String(Math.round(s % 60)).padStart(2, '0');
  return `<div class="chartwrap"><svg viewBox="0 0 ${W} ${H}">
    <text x="${P}" y="13" class="ch-lbl">⚡ hard&#160;&#160;🏃 easy&#160;&#160;🛣️ long&#160;&#160;🏁 race</text>
    <text x="${W - P + 2}" y="${y(min) + 4}" class="ch-ax">${lbl(min)}</text>
    <text x="${W - P + 2}" y="${y(max) + 4}" class="ch-ax">${lbl(max)}</text>
    <polyline class="ln-pace" points="${pts.map((p, i) => `${x(i).toFixed(1)},${y(p.pace).toFixed(1)}`).join(' ')}"/>
    ${pts.map((p, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(p.pace).toFixed(1)}" r="4" fill="${color(p.type)}"/>`).join('')}
  </svg></div>`;
}

function svgChart(pts) {
  if (pts.length < 2) return `<div class="card"><div class="card-sub">Log this exercise ${2 - pts.length} more time${pts.length === 1 ? '' : 's'} to see the trend chart.</div></div>`;
  const W = 340, H = 160, P = 28;
  const all = pts.flatMap(p => [p.top, p.e1]).filter(v => v > 0);
  const min = Math.min(...all) * 0.95, max = Math.max(...all) * 1.05 || 1;
  const x = i => P + (W - 2 * P) * i / (pts.length - 1);
  const y = v => H - P - (H - 2 * P) * (v - min) / (max - min || 1);
  const line = (key, cls) => `<polyline class="${cls}" points="${pts.map((p, i) => `${x(i).toFixed(1)},${y(p[key]).toFixed(1)}`).join(' ')}"/>`;
  const dots = (key, cls) => pts.map((p, i) => `<circle class="${cls}" cx="${x(i).toFixed(1)}" cy="${y(p[key]).toFixed(1)}" r="3.5"/>`).join('');
  return `<div class="chartwrap"><svg viewBox="0 0 ${W} ${H}">
    <text x="${P}" y="14" class="ch-lbl">— top set kg&#160;&#160;&#160;— e1RM</text>
    <text x="${W - P}" y="${y(max) + 4}" class="ch-ax" text-anchor="end">${max.toFixed(0)}</text>
    <text x="${W - P}" y="${y(min) + 4}" class="ch-ax" text-anchor="end">${min.toFixed(0)}</text>
    ${line('top', 'ln1')}${dots('top', 'dt1')}
    ${line('e1', 'ln2')}${dots('e1', 'dt2')}
  </svg></div>`;
}

/* ========== analysis behind Progress · Insights ========== */
function mondayOf(d) { const dow = new Date(d + 'T12:00').getDay(); return dadd(d, -((dow + 6) % 7)); }
function tonnageIn(from, to) {
  let v = 0;
  for (const s of Object.values(ST.sessions)) {
    if (s.status !== 'done' || s.date < from || s.date > to) continue;
    for (const e of s.exercises) {
      const ex = EXERCISES[e.exId]; if (!ex || ex.mode !== 'reps') continue;
      for (const t of e.sets.filter(x => x.done)) v += (t.weight || 0) * (t.reps || 0) * (ex.perSide ? 2 : 1);
    }
  }
  return v;
}
/* per-lift e1RM movement: early average vs recent average, ranked */
function liftTrajectories() {
  const out = [];
  for (const exId of Object.keys(EXERCISES)) {
    const ex = EXERCISES[exId]; if (ex.mode !== 'reps') continue;
    const hist = exHistory(exId);
    const vals = hist.map(h => Math.max(0, ...h.sets.map(t => e1rm(t.weight, t.reps, t.rpe)))).filter(v => v > 0);
    if (vals.length < 3) continue;
    const k = Math.max(1, Math.min(3, Math.floor(vals.length / 2)));
    const first = vals.slice(0, k).reduce((a, b) => a + b, 0) / k;
    const last = vals.slice(-k).reduce((a, b) => a + b, 0) / k;
    if (!first) continue;
    out.push({ exId, name: ex.name, pct: Math.round((last - first) / first * 1000) / 10, first, last, n: vals.length });
  }
  return out.sort((a, b) => b.pct - a.pct);
}
/* Same first-k/last-k e1RM comparison as liftTrajectories(), but scoped to
   the hypertrophy phase's own history and restricted to its anchor lifts —
   the ones that never rotate, so they're the only ones with a continuous
   trend worth reading (see HYPER_POOLS in program.js). A lighter bar than
   liftTrajectories()'s 3+ sessions: a phase can legitimately be young. */
const HYPER_ANCHORS = ['bench', 'pullup', 'ohp', 'bbcurl', 'pushdown'];
function hyperTrajectories() {
  const since = ST.maintenance.startedOn || today();
  const out = [];
  for (const exId of HYPER_ANCHORS) {
    const hist = exHistory(exId).filter(h => h.date >= since);
    const vals = hist.map(h => Math.max(0, ...h.sets.map(t => e1rm(t.weight, t.reps, t.rpe)))).filter(v => v > 0);
    if (vals.length < 2) continue;
    const k = Math.max(1, Math.min(3, Math.floor(vals.length / 2)));
    const first = vals.slice(0, k).reduce((a, b) => a + b, 0) / k;
    const last = vals.slice(-k).reduce((a, b) => a + b, 0) / k;
    if (!first) continue;
    out.push({ exId, name: EXERCISES[exId].name, pct: Math.round((last - first) / first * 1000) / 10, n: vals.length });
  }
  return out.sort((a, b) => b.pct - a.pct);
}
function liftPRBook() {
  const out = [];
  for (const exId of Object.keys(EXERCISES)) {
    const ex = EXERCISES[exId]; if (ex.mode !== 'reps') continue;
    let maxW = 0, wReps = 0, wDate = null, maxE = 0, eDate = null;
    for (const h of exHistory(exId)) for (const t of h.sets) {
      if (t.weight == null || !t.reps) continue;
      if (t.weight > maxW || (t.weight === maxW && t.reps > wReps)) { maxW = t.weight; wReps = t.reps; wDate = h.date; }
      const e1 = e1rm(t.weight, t.reps, t.rpe);
      if (e1 > maxE) { maxE = e1; eDate = h.date; }
    }
    if (maxW > 0) out.push({ exId, name: ex.name, maxW, wReps, wDate, maxE, eDate });
  }
  return out.sort((a, b) => b.maxE - a.maxE);
}
function runBests() {
  const merged = mergedRunsAll();
  const runs = Object.keys(merged).map(d => ({ date: d, ...merged[d] })).filter(r => r.km >= 3 && r.min > 0);
  if (!runs.length) return null;
  const paceSec = r => r.min * 60 / r.km;
  const bucket = (lo, hi, label) => {
    const c = runs.filter(r => r.km >= lo && r.km < hi);
    if (!c.length) return null;
    const best = c.reduce((a, b) => paceSec(a) <= paceSec(b) ? a : b);
    return { label, km: best.km, date: best.date, pace: paceStr(best.km, best.min) };
  };
  const longest = runs.reduce((a, b) => a.km >= b.km ? a : b);
  const wkKm = {};
  for (const r of runs) { const m = mondayOf(r.date); wkKm[m] = (wkKm[m] || 0) + r.km; }
  const bigM = Object.keys(wkKm).sort((a, b) => wkKm[b] - wkKm[a])[0];
  return {
    buckets: [bucket(3, 8, 'Short (3–8 km)'), bucket(8, 14, 'Medium (8–14 km)'), bucket(14, 99, 'Long (14 km+)')].filter(Boolean),
    longest, bigWeek: { monday: bigM, km: Math.round(wkKm[bigM] * 10) / 10 },
  };
}
/* EF trend verdict from the same series the chart draws */
function efVerdict() {
  const pts = efSeries();
  if (pts.length < 6) return { ready: false, n: pts.length, pts };
  const vals = pts.map(p => p.ef);
  const n = vals.length, xs = vals.map((_, i) => i);
  const mx = (n - 1) / 2, my = vals.reduce((a, b) => a + b, 0) / n;
  const slope = xs.reduce((a, xi, i) => a + (xi - mx) * (vals[i] - my), 0) / xs.reduce((a, xi) => a + (xi - mx) ** 2, 0);
  const pct = Math.round(slope * (n - 1) / my * 1000) / 10;
  const line = pct >= 2 ? `Your engine is getting more efficient: same heart rate now buys ~${pct}% more speed than when you started.`
    : pct <= -2 ? `Aerobic efficiency has slipped ~${Math.abs(pct)}% across the block — heat, fatigue, or a heavy patch can all do this. Worth watching, not panicking.`
    : `Aerobic efficiency is holding steady — the engine is idling where it was.`;
  return { ready: true, pct, line, pts };
}
/* red-day efficacy: what happened the day after red guidance, by what you chose */
function redDayStory() {
  const reds = Object.values(ST.sessions).filter(s => s.status === 'done' && s.guidance && s.guidance.level === 'red');
  if (reds.length < 2) return { ready: false, line: reds.length === 0 ? 'No red-flag days yet — good. When one comes, this will track whether backing off actually pays.' : 'One red day so far — need a couple more before comparing choices.' };
  const groups = { lighter: [], full: [] };
  for (const s of reds) {
    const nd = fitnessEntries().find(e => e.date === dadd(s.date, 1) && e.hrv != null);
    if (!nd) continue;
    const base = hrvBaseline(nd.date);
    if (!base.ready) continue;
    groups[s.guidance.followed === 'lighter' ? 'lighter' : 'full'].push(nd.hrv - base.mean);
  }
  const avg = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
  const L = avg(groups.lighter), F = avg(groups.full);
  if (L == null && F == null) return { ready: false, line: `${reds.length} red days logged, but no next-morning HRV to judge them by — the morning check-in feeds this.` };
  if (L != null && F != null) {
    const diff = Math.round((L - F) * 10) / 10;
    return { ready: true, line: diff > 1.5 ? `Backing off works for you: next-morning HRV averaged ${diff} ms better after taking the lighter option than after pushing through.`
      : diff < -1.5 ? `Interesting: pushing through red days hasn't cost you next-morning HRV so far (${Math.abs(diff)} ms better than backing off). Small sample — don't make it a habit.`
      : `Lighter vs pushing through: next-morning HRV looks about the same either way so far (${groups.lighter.length + groups.full.length} red days).` };
  }
  const only = L != null ? 'lighter' : 'full';
  return { ready: true, line: `On red days you've always ${only === 'lighter' ? 'taken the lighter option' : 'pushed through'} — next-morning HRV ran ${Math.abs(Math.round((L ?? F) * 10) / 10)} ms ${(L ?? F) >= 0 ? 'above' : 'below'} baseline after. No comparison yet.` };
}
/* load → next-week HRV: Pearson r on weekly combined load vs following week's HRV */
function loadHrvLag() {
  const firstDate = Object.keys(ST.sessions).sort()[0];
  if (!firstDate) return { ready: false, line: 'Needs a few training weeks first.' };
  const merged = mergedRunsAll();
  const weeks = [];
  for (let m = mondayOf(firstDate); m <= dadd(today(), -7); m = dadd(m, 7)) {
    const sun = dadd(m, 6);
    const ton = tonnageIn(m, sun);
    const km = Object.keys(merged).filter(d => d >= m && d <= sun).reduce((a, d) => a + (merged[d].km || 0), 0);
    const nxt = fitnessEntries().filter(e => e.date >= dadd(m, 7) && e.date <= dadd(m, 13) && e.hrv != null).map(e => e.hrv);
    if ((ton > 0 || km > 0) && nxt.length >= 2) weeks.push({ ton, km, hrv: nxt.reduce((a, b) => a + b, 0) / nxt.length });
  }
  if (weeks.length < 4) return { ready: false, line: `Needs 4 weeks of load + HRV pairs to say anything honest (have ${weeks.length}).` };
  const z = arr => { const mn = arr.reduce((a, b) => a + b, 0) / arr.length; const sd = Math.sqrt(arr.reduce((a, b) => a + (b - mn) ** 2, 0) / arr.length) || 1; return arr.map(v => (v - mn) / sd); };
  const zt = z(weeks.map(w => w.ton)), zk = z(weeks.map(w => w.km));
  const load = weeks.map((_, i) => zt[i] + zk[i]);
  const hrv = weeks.map(w => w.hrv);
  const zl = z(load), zh = z(hrv);
  const r = zl.reduce((a, v, i) => a + v * zh[i], 0) / weeks.length;
  const line = r <= -0.4 ? `Clear lag effect: your bigger training weeks tend to pull HRV down the week after (r=${r.toFixed(2)} over ${weeks.length} weeks). This is exactly why the taper gets lighter.`
    : r >= 0.4 ? `You absorb load well: HRV has actually run higher after bigger weeks (r=${r.toFixed(2)}). Fitness is outpacing fatigue.`
    : `No strong lag between weekly load and next-week HRV yet (r=${r.toFixed(2)} over ${weeks.length} weeks) — your recovery is keeping up.`;
  return { ready: true, r, n: weeks.length, line };
}
/* run interference: set RPE on lift days that follow a long run vs other lift days */
function runInterference() {
  const dayAfterLong = [], other = [];
  for (const s of Object.values(ST.sessions)) {
    if (s.status !== 'done') continue;
    const rpes = s.exercises.flatMap(e => e.sets.filter(t => t.done && t.rpe != null).map(t => t.rpe));
    if (!rpes.length) continue;
    const prev = mergedRunFor(dadd(s.date, -1));
    (prev && prev.km >= 10 ? dayAfterLong : other).push(rpes.reduce((a, b) => a + b, 0) / rpes.length);
  }
  if (dayAfterLong.length < 3 || other.length < 3) return { ready: false, line: `Needs at least 3 lift sessions in each bucket — after a 10 km+ run: ${dayAfterLong.length}, other days: ${other.length}.` };
  const avg = a => a.reduce((x, y) => x + y, 0) / a.length;
  const d = Math.round((avg(dayAfterLong) - avg(other)) * 10) / 10;
  const line = d >= 0.5 ? `Long runs leak into the gym: sessions the day after a 10 km+ run feel ~${d} RPE harder at the same work. The schedule already keeps heavy legs off those days — that's why.`
    : d <= -0.3 ? `Unusually, you lift slightly easier the day after long runs (${Math.abs(d)} RPE). Either you're a robot or the easy-day pacing is spot on.`
    : `Long runs barely dent your lifting (${d >= 0 ? '+' : ''}${d} RPE the day after) — your legs recover fast.`;
  return { ready: true, d, line };
}
/* RPE drift: same top weight in consecutive sessions — does it feel easier over time? */
function rpeDrift() {
  const deltas = [];
  for (const exId of Object.keys(EXERCISES)) {
    if (EXERCISES[exId].mode !== 'reps') continue;
    const hist = exHistory(exId);
    for (let i = 1; i < hist.length; i++) {
      const topW = h => Math.max(0, ...h.sets.filter(t => t.weight != null).map(t => t.weight));
      const w1 = topW(hist[i - 1]), w2 = topW(hist[i]);
      if (!w1 || w1 !== w2) continue;
      const rpeAt = (h, w) => { const r = h.sets.filter(t => t.weight === w && t.rpe != null).map(t => t.rpe); return r.length ? r.reduce((a, b) => a + b, 0) / r.length : null; };
      const r1 = rpeAt(hist[i - 1], w1), r2 = rpeAt(hist[i], w2);
      if (r1 != null && r2 != null) deltas.push(r2 - r1);
    }
  }
  if (deltas.length < 5) return { ready: false, line: `Needs ~5 repeat-weight pairs to read (have ${deltas.length}). Keeps building as you train.` };
  const d = Math.round(deltas.reduce((a, b) => a + b, 0) / deltas.length * 100) / 100;
  const line = d <= -0.3 ? `The same weights are feeling easier: on repeat exposures, RPE drops ~${Math.abs(d)} on average. That's fitness you can't see on the bar yet.`
    : d >= 0.3 ? `Repeat weights are feeling ~${d} RPE harder — accumulated fatigue talks like this. The deload radar and lighter days are your friends.`
    : `Repeat weights feel about the same (${d >= 0 ? '+' : ''}${d} RPE) — steady state.`;
  return { ready: true, d, n: deltas.length, line };
}
/* the single strongest thing the data says right now */
function topInsight() {
  const t = today();
  const weekPRs = Object.values(ST.sessions)
    .filter(s => s.status === 'done' && s.date >= mondayOf(t) && s.date <= t)
    .flatMap(s => sessionPRs(s));
  if (weekPRs.length) return `🏆 ${weekPRs.length} PR${weekPRs.length > 1 ? 's' : ''} this week — ${weekPRs[0].text}.`;
  const traj = liftTrajectories();
  if (traj.length && traj[0].pct >= 5) return `📈 Biggest mover: ${traj[0].name}, up ${traj[0].pct}% in estimated strength since your first sessions.`;
  const ef = efVerdict();
  if (ef.ready && Math.abs(ef.pct) >= 2) return `🫀 ${ef.line}`;
  const lag = loadHrvLag();
  if (lag.ready && Math.abs(lag.r) >= 0.4) return `🔁 ${lag.line}`;
  const drift = rpeDrift();
  if (drift.ready && Math.abs(drift.d) >= 0.3) return `⚖️ ${drift.line}`;
  const inter = runInterference();
  if (inter.ready && Math.abs(inter.d) >= 0.5) return `🏃 ${inter.line}`;
  const ad = adherence();
  if (ad.streak && ad.streak >= 4) return `🔥 ${ad.streak} planned sessions in a row without a miss. Consistency is the whole game.`;
  if (traj.length) return `📈 ${traj[0].name} is your biggest mover so far (${traj[0].pct >= 0 ? '+' : ''}${traj[0].pct}%). More data sharpens this every week.`;
  return `Keep logging — every workout and morning check-in makes these insights sharper.`;
}
function trajBars(traj) {
  const maxAbs = Math.max(5, ...traj.map(x => Math.abs(x.pct)));
  return traj.map(x => `<div class="tj-row" onclick="go('exdetail',{ex:'${x.exId}',back:'trends'})">
    <div class="tj-name">${esc(x.name)}</div>
    <div class="tj-track"><div class="tj-bar ${x.pct >= 0 ? 'up' : 'down'}" style="width:${Math.min(100, Math.abs(x.pct) / maxAbs * 100)}%"></div></div>
    <div class="tj-pct ${x.pct >= 0 ? 'up' : 'down'}">${x.pct >= 0 ? '+' : ''}${x.pct}%</div>
  </div>`).join('');
}
/* ---------- Progress · Insights (was the Trends tab) ---------- */
function insightsBody() {
  // every section computes independently — one bad analysis must not kill the tab
  const safe = (fn, fallback) => { try { return fn(); } catch (e) { return typeof fallback === 'function' ? fallback(e) : fallback; } };
  const traj = safe(liftTrajectories, []);
  const prsL = safe(liftPRBook, []);
  const rb = safe(runBests, null);
  const ef = safe(efVerdict, { ready: false, n: 0, pts: [] });
  const explErr = e => ({ ready: false, line: `This one hit an error (${e.message}) — the rest of the tab still works.` });
  const explorers = [
    { icon: '🔻', title: 'Do red days pay off?', s: safe(redDayStory, explErr) },
    { icon: '🔁', title: 'Big weeks → next-week recovery', s: safe(loadHrvLag, explErr) },
    { icon: '🏃', title: 'Do long runs hurt your lifting?', s: safe(runInterference, explErr) },
    { icon: '⚖️', title: 'Same weight, less effort?', s: safe(rpeDrift, explErr) },
  ];
  const trajLine = !traj.length ? 'Log each lift 3+ times and its trajectory appears here.'
    : traj[0].pct >= 5 ? `${traj[0].name} leads the pack, up ${traj[0].pct}% in estimated strength.${traj[traj.length - 1].pct < 0 ? ` ${traj[traj.length - 1].name} is the laggard (${traj[traj.length - 1].pct}%) — worth a look.` : ''}`
    : 'Strength is roughly holding across the board — during a running block, holding IS winning.';
  const retroReady = daysUntil(RACES[1].date) < 0 || ST.maintenance.active;
  // On a fresh install (or right after a reset) every one of these sections
  // independently rendered its own "not enough data" card — a wall of four
  // empty placeholders before anything real ever appears. If literally
  // nothing is ready yet, say so once and skip the wall; the moment any one
  // section has real data, everything reverts to its normal per-section form.
  const allEmpty = !traj.length && !prsL.length && !rb && !ef.ready && explorers.every(x => !x.s.ready);
  return `
    <div class="card insight"><div class="card-kicker">💡 Insight of the week</div><div class="card-sub">${safe(topInsight, 'Insights are having a moment — the rest of the tab still works.')}</div></div>

    ${allEmpty ? `<div class="card"><div class="card-kicker">📊 Building up</div><div class="card-sub">Strength trajectories, a PR book, your aerobic engine trend and the cause-and-effect explorers all need a few real sessions before they have anything to say. Keep logging — this tab fills itself in.</div></div>` : `
    <div class="section-label">Strength trajectory</div>
    <div class="card"><div class="card-sub" style="margin-bottom:10px">${esc(trajLine)}</div>
      ${traj.length ? `<div class="tj-wrap">${trajBars(traj)}</div><div class="dim small" style="margin-top:6px">Estimated 1-rep max, early sessions vs recent. Tap a lift for its full chart.</div>` : ''}</div>

    <div class="section-label">PR book</div>
    <div class="card">${prsL.length ? `<div class="prb-h">🏋️ Lifts</div>` + prsL.map(p => `<div class="prb-row" onclick="go('exdetail',{ex:'${p.exId}',back:'insights'})">
        <span class="prb-name">${esc(p.name)}</span>
        <span class="prb-val">${p.maxW} kg × ${p.wReps}</span>
        <span class="prb-sub">${p.maxE > 0 ? `e1RM ${p.maxE.toFixed(1)} · ${fmtDate(p.eDate)}` : fmtDate(p.wDate)}</span></div>`).join('')
      : `<div class="card-sub">Your first logged lift starts the book.</div>`}
    ${rb ? `<div class="prb-h" style="margin-top:12px">🏃 Runs</div>
      ${rb.buckets.map(b => `<div class="prb-row"><span class="prb-name">${esc(b.label)}</span><span class="prb-val">${b.pace}</span><span class="prb-sub">${b.km} km · ${fmtDate(b.date)}</span></div>`).join('')}
      <div class="prb-row"><span class="prb-name">Longest run</span><span class="prb-val">${rb.longest.km} km</span><span class="prb-sub">${fmtDate(rb.longest.date)}</span></div>
      <div class="prb-row"><span class="prb-name">Biggest week</span><span class="prb-val">${rb.bigWeek.km} km</span><span class="prb-sub">wk of ${fmtDate(rb.bigWeek.monday)}</span></div>` : ''}</div>

    <div class="section-label">Aerobic engine</div>
    ${ef.ready ? `${efChart(ef.pts)}<div class="card"><div class="card-sub">${esc(ef.line)}</div></div>`
      : `<div class="card"><div class="card-sub">Needs ${6 - ef.n} more runs with heart rate to read the engine trend (have ${ef.n}).</div></div>`}

    <div class="section-label">Cause & effect</div>
    ${explorers.map(x => `<div class="card explorer ${x.s.ready ? '' : 'dim-card'}"><div class="card-kicker">${x.icon} ${esc(x.title)}</div><div class="card-sub">${esc(x.s.line)}</div></div>`).join('')}
    `}

    ${retroReady ? `<div class="section-label">The block</div>
      <div class="card"><div class="card-sub">Nine weeks, two races — what actually changed.</div><button class="btn primary big" onclick="showRetro()">📜 Block retrospective</button></div>` : ''}

    ${ST.maintenance.active && ST.maintenance.program === 'hypertrophy' ? `<div class="section-label">The hypertrophy phase</div>
      <div class="card"><div class="card-sub">Chest and arms lead, legs and back held steady — how it's actually going.</div><button class="btn primary big" onclick="showHyperRetro()">🏋️ Phase, in numbers</button></div>` : ''}`;
}
/* one-shot post-block report */
window.showRetro = function () {
  const traj = liftTrajectories();
  const ef = efVerdict();
  const doneSessions = Object.values(ST.sessions).filter(s => s.status === 'done');
  const merged = mergedRunsAll();
  const totKm = Math.round(Object.values(merged).reduce((a, r) => a + (r.km || 0), 0) * 10) / 10;
  const firstD = Object.keys(ST.sessions).sort()[0] || today();
  const totTon = Math.round(tonnageIn(firstD, today()) / 100) / 10;
  const raceLines = RACES.map(r => {
    const st = ST.races[r.key];
    if (!st.result) return `${r.name}: not logged.`;
    return `${r.name}: ${st.result}${st.projAtRace ? ` (projected ${st.projAtRace})` : ''}${st.feel ? ` — felt ${st.feel}` : ''}.`;
  });
  const lifters = traj.slice(0, 5).map(x => `${x.name}: ${x.pct >= 0 ? '+' : ''}${x.pct}% e1RM`);
  const m = $('#modal');
  m.innerHTML = `<div class="sheet"><h2>📜 The block, in numbers</h2>
    <div class="wksum-sec"><div class="wksum-h">🏁 Races</div>${raceLines.map(l => `<div class="wksum-li">${esc(l)}</div>`).join('')}</div>
    <div class="wksum-sec"><div class="wksum-h">🏋️ Strength (est. 1RM change)</div>
      ${lifters.length ? lifters.map(l => `<div class="wksum-li">${esc(l)}</div>`).join('') : '<div class="wksum-li dim">Not enough repeat lifts to compare.</div>'}</div>
    <div class="wksum-sec"><div class="wksum-h">🫀 Engine</div><div class="wksum-li">${esc(ef.ready ? ef.line : 'Not enough HR runs to score the engine.')}</div></div>
    <div class="wksum-sec"><div class="wksum-h">📦 Totals</div>
      <div class="wksum-li">${doneSessions.length} gym sessions · ${totTon} t lifted · ${totKm} km run</div></div>
    <button class="btn primary big" onclick="closeModal()">Close</button></div>`;
  m.classList.add('open');
};
/* on-demand report for the CURRENT hypertrophy phase — showRetro() above is
   a one-shot look back at the finished 9-week race block, this is an
   ongoing "how's it going" for a phase that has no end date */
const HYPER_POOL_LABEL = { chestAcc: 'Chest accessory', backAcc: 'Back accessory', bicepsAcc: 'Biceps accessory', tricepsAcc: 'Triceps accessory' };
window.showHyperRetro = function () {
  const since = ST.maintenance.startedOn || today();
  const mesoStart = ST.maintenance.mesoStart || since;
  const weeksIn = weeksSince(mesoStart, today()) + 1;
  const blockNum = Math.floor(weeksSince(mesoStart, today()) / HYPER_MESO_WEEKS) + 1;
  const doneSessions = Object.values(ST.sessions).filter(s => s.status === 'done' && s.date >= since);
  const byTpl = {};
  for (const s of doneSessions) byTpl[s.tpl] = (byTpl[s.tpl] || 0) + 1;
  const dayLines = HYPER_ORDER.map(tp => `${TEMPLATES[tp].title}: ${byTpl[tp] || 0}`);
  const traj = hyperTrajectories();
  const lifters = traj.map(x => `${x.name}: ${x.pct >= 0 ? '+' : ''}${x.pct}% e1RM`);
  const totTon = Math.round(tonnageIn(since, today()) / 100) / 10;
  const runsInPhase = Object.keys(mergedRunsAll()).filter(d => d >= since).length;
  const rotation = Object.keys(HYPER_POOLS).map(pool => `${HYPER_POOL_LABEL[pool]}: ${EXERCISES[hyperExId(HYPER_POOLS[pool], mesoStart, today())].name}`);
  const m = $('#modal');
  m.innerHTML = `<div class="sheet"><h2>🏋️ Hypertrophy phase, in numbers</h2>
    <div class="dim small" style="margin-bottom:10px">Week ${weeksIn} of this phase · rotation block ${blockNum} (accessories rotate every ${HYPER_MESO_WEEKS} weeks)</div>
    <div class="wksum-sec"><div class="wksum-h">📅 Sessions this phase</div>${dayLines.map(l => `<div class="wksum-li">${esc(l)}</div>`).join('')}</div>
    <div class="wksum-sec"><div class="wksum-h">🏋️ Anchor lifts (est. 1RM change)</div>
      ${lifters.length ? lifters.map(l => `<div class="wksum-li">${esc(l)}</div>`).join('') : '<div class="wksum-li dim">Not enough repeat sessions yet to compare.</div>'}</div>
    <div class="wksum-sec"><div class="wksum-h">🔄 Currently rotating in</div>${rotation.map(l => `<div class="wksum-li">${esc(l)}</div>`).join('')}</div>
    <div class="wksum-sec"><div class="wksum-h">🏃 Running maintenance</div><div class="wksum-li">${runsInPhase} run${runsInPhase === 1 ? '' : 's'} logged this phase — no schedule, just showing up</div></div>
    <div class="wksum-sec"><div class="wksum-h">📦 Totals</div><div class="wksum-li">${doneSessions.length} gym sessions · ${totTon} t lifted</div></div>
    <button class="btn primary big" onclick="closeModal()">Close</button></div>`;
  m.classList.add('open');
};

/* ---------- settings ---------- */
/* Every on/off control in Settings shares this markup so they all carry
   real switch semantics — a screen reader previously heard only "ON"/"OFF"
   button text with no indication it was a toggle. */
function toggleBtn(checked, onclick) {
  return `<button class="toggle ${checked ? 'on' : ''}" role="switch" aria-checked="${checked}" onclick="${onclick}">${checked ? 'ON' : 'OFF'}</button>`;
}
function vSettings() {
  return `<header class="top"><h1 class="phase">Settings</h1></header>
  <main>
    <div class="set-row"><span>Weight stepper increment</span>
      <select onchange="ST.settings.step=+this.value;save()">
        ${WEIGHT_STEP_CHOICES.map(v => `<option value="${v}" ${ST.settings.step === v ? 'selected' : ''}>${v} kg</option>`).join('')}
      </select></div>
    <div class="set-row"><span>Barbell weight</span>
      <select onchange="ST.settings.barWeight=+this.value;save();render()">
        ${[20, 15, 10].map(v => `<option value="${v}" ${ST.settings.barWeight === v ? 'selected' : ''}>${v} kg</option>`).join('')}
      </select></div>
    <div class="dim small" style="margin-bottom:8px">Used by the plate calculator on barbell lifts — standard plates (25/20/15/10/5/2.5/1.25 kg) assumed per side.</div>
    <div class="set-row"><span>Rest chime</span>${toggleBtn(ST.settings.sound, "ST.settings.sound=!ST.settings.sound;save();render()")}</div>
    <div class="set-row"><span>Vibration</span>${toggleBtn(ST.settings.vibrate, "ST.settings.vibrate=!ST.settings.vibrate;save();render()")}</div>
    <div class="section-label">Equipment on hand</div>
    <div class="dim small" style="margin-bottom:8px">Turn off anything you don't have — the ⇄ swap-exercise list in a workout ranks compatible variants first.</div>
    ${EQUIP_KEYS.map(k => `<div class="set-row"><span>${esc(EQUIP_LABEL[k])}</span>${toggleBtn(ST.settings.equip[k], `ST.settings.equip['${k}']=!ST.settings.equip['${k}'];save();render()`)}</div>`).join('')}
    <div class="section-label">Mode</div>
    ${ST.maintenance.active
      ? `<div class="dim small" style="margin-bottom:8px">${ST.maintenance.program === 'hypertrophy' ? 'Hypertrophy phase' : 'Maintenance mode'} is on${ST.maintenance.startedOn ? ' (since ' + fmtDate(ST.maintenance.startedOn) + ')' : ''}: ${ST.maintenance.program === 'hypertrophy' ? '5 sessions a week — chest & arms priority, legs and back stay real' : '3 flexible gym workouts a week'}, no race clock.</div>
         <div class="set-row"><span>Focus</span><select onchange="ST.maintenance.program=this.value; if(this.value==='hypertrophy' && !ST.maintenance.mesoStart) ST.maintenance.mesoStart=today(); save();render()">
           <option value="balanced" ${ST.maintenance.program !== 'hypertrophy' ? 'selected' : ''}>Balanced</option>
           <option value="hypertrophy" ${ST.maintenance.program === 'hypertrophy' ? 'selected' : ''}>Hypertrophy — chest & arms</option>
         </select></div>
         <button class="btn big" onclick="if(confirm('Switch back to the race program view?')){ST.maintenance={active:false,startedOn:null,program:'balanced',mesoStart:null};save();render();}">Back to program mode</button>`
      : `<div class="dim small" style="margin-bottom:8px">After Melbourne the app offers this choice automatically — or start it any time here.</div>
         <button class="btn big" onclick="if(confirm('Start maintenance mode? The race program view is replaced by 3 flexible workouts a week. You can switch back here any time.'))startMaintenance('balanced')">Start maintenance mode</button>
         <button class="btn big" onclick="if(confirm('Start the hypertrophy phase? The race program view is replaced by 5 sessions a week — chest & arms priority. You can switch back here any time.'))startMaintenance('hypertrophy')">Start hypertrophy phase</button>`}
    <div class="section-label">Run sync</div>
    <div class="dim small" style="margin-bottom:8px">Import your runs from <b>Garmin Connect</b> (free): on connect.garmin.com go to Activities → All Activities → Export CSV, then load the file here. Re-imports skip runs it already knows.</div>
    <button class="btn primary big" onclick="document.getElementById('garminpick').click()">📥 Import Garmin CSV</button>
    <input type="file" id="garminpick" accept=".csv,text/csv" style="display:none" onchange="importGarminFile(this)">
    <div class="set-row"><span>Synced activities</span><span class="dim small">${Object.keys(ST.strava.activities).length} cached${ST.strava.lastSync ? ' · updated ' + new Date(ST.strava.lastSync).toLocaleDateString() : ''}</span></div>
    <div class="set-row"><span>Include non-run activities</span>${toggleBtn(ST.strava.includeOther, "ST.strava.includeOther=!ST.strava.includeOther;invalidateActivityIndex();save();render()")}</div>
    ${Object.keys(ST.strava.activities).length ? `<button class="btn small" onclick="if(confirm('Remove all synced activities? Manual run logs are kept.')){ST.strava.activities={};save();render();}">Clear synced activities</button>` : ''}
    <div class="section-label">Strava (optional — needs a paid Strava subscription for API access)</div>
    ${stravaConnected() ? `
      <div class="set-row"><span>Connected${ST.strava.auth.athlete ? ' as <b>' + esc(ST.strava.auth.athlete.name) + '</b>' : ''}</span><span class="svbadge">✓ strava</span></div>
      <div class="set-row"><span>Last sync</span><span class="dim small">${ST.strava.lastSync ? new Date(ST.strava.lastSync).toLocaleString() : 'never'} · ${Object.keys(ST.strava.activities).length} activities cached</span></div>
      <button class="btn big" onclick="stravaSyncNow()">🔄 Sync now</button>
      <button class="btn danger" onclick="if(confirm('Disconnect Strava and remove synced activities? (Your strength log and manual run logs are untouched.)'))stravaDisconnect()">Disconnect Strava</button>
    ` : `
      <div class="dim small" style="margin-bottom:8px">Auto-sync from Strava works but requires a Strava subscription (their June 2026 API change). If you subscribe: create an API app at <b>strava.com/settings/api</b>, then connect here. Credentials stay on this device only.</div>
      <div class="set-row"><span>Client ID</span><input id="sv-id" inputmode="numeric" style="width:130px" value="${esc(ST.strava.clientId)}"></div>
      <div class="set-row"><span>Client Secret</span><input id="sv-secret" type="password" style="width:180px" value="${esc(ST.strava.clientSecret)}"></div>
      <div class="set-row"><span class="small">Token proxy URL <span class="dim">(only if connect fails with CORS)</span></span><input id="sv-proxy" style="width:180px" placeholder="optional" value="${esc(ST.strava.tokenUrl || '')}"></div>
      <button class="btn primary big" onclick="stravaConnect()">🔗 Connect Strava</button>
    `}
    <div class="section-label">Backup</div>
    ${localStorage.getItem('runstrong.backup.v4') ? `<div class="dim small" style="margin-bottom:6px">A pre-Strava backup of your data was saved automatically (schema v4). <button class="mini" onclick="restoreV4Backup()">Restore it</button> <button class="mini" onclick="downloadV4Backup()">Download it</button></div>` : ''}
    <button class="btn big" onclick="exportJSON()">⬇ Export all data (JSON)</button>
    <button class="btn big" onclick="exportCSV()">⬇ Export workout log (CSV)</button>
    <button class="btn big" onclick="document.getElementById('importfile').click()">⬆ Import data (JSON)</button>
    <input type="file" id="importfile" accept=".json,application/json" style="display:none" onchange="importJSON(this)">
    <div class="section-label">Install</div>
    <button class="btn big" onclick="showInstall(true)">📲 Add to Home Screen — how</button>
    <button class="btn big" onclick="checkForUpdates()">🔄 Check for app updates</button>
    <div class="section-label">Danger zone</div>
    <button class="btn danger big" onclick="resetAll()">Reset everything</button>
    <div class="dim" style="text-align:center;margin-top:16px">RunStrong <b>${APP_VERSION}</b> · schema v${SCHEMA_VERSION} · all data stays on this device</div>
  </main>${navBar()}`;
}

window.restoreV4Backup = function () {
  if (!confirm('Restore the automatic pre-Strava backup? This replaces current data with the state from just before the Strava update.')) return;
  try {
    const raw = localStorage.getItem('runstrong.backup.v4');
    ST = migrate(JSON.parse(raw)); save(); render();
    toast('Backup restored (and re-migrated to the current version).');
  } catch (e) { toast('Restore failed: ' + e.message, 5000); }
};
window.downloadV4Backup = function () {
  const raw = localStorage.getItem('runstrong.backup.v4'); if (!raw) return;
  download('runstrong-backup-v4.json', raw, 'application/json');
};
window.exportJSON = function () {
  ST.lastBackup = Date.now(); save();
  download(`runstrong-backup-${today()}.json`, JSON.stringify(ST, null, 1), 'application/json');
};
window.exportCSV = function () {
  const rows = [['date', 'session', 'exercise', 'set', 'weight_kg', 'reps', 'rpe', 'failed', 'note']];
  for (const id of Object.keys(ST.sessions).sort()) {
    const s = ST.sessions[id];
    if (s.status !== 'done') continue;
    for (const e of s.exercises) e.sets.forEach((t, i) => {
      if (t.done) rows.push([s.date, s.title, EXERCISES[e.exId].name, i + 1, t.weight ?? '', t.reps ?? '', t.rpe ?? '', t.failed ? 1 : '', (t.note || '').replace(/"/g, '""')]);
    });
  }
  // runs: exercise carries time/pace/HR, reps column = km, note = feel + splits + note
  for (const d of Object.keys(ST.runs).sort()) {
    const r = ST.runs[d];
    if (r.skipped) { rows.push([d, 'Run', 'Run (skipped)', 1, '', '', '', '', '']); continue; }
    const bits = [`felt ${r.feel}`];
    if (r.splits && r.splits.length) bits.push('splits ' + r.splits.map(fmtSplit).join(' '));
    if (r.note) bits.push(r.note);
    rows.push([d, 'Run', `Run (${r.min} min, ${paceStr(r.km, r.min) || '?'}${r.hr ? ', ' + r.hr + ' bpm' : ''})`, 1, '', r.km, '', '', bits.join(' — ').replace(/"/g, '""')]);
  }
  download(`runstrong-log-${today()}.csv`, rows.map(r => r.map(c => `"${c}"`).join(',')).join('\n'), 'text/csv');
};
function download(name, content, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type }));
  a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
/* The old check (`!s.schemaVersion || !s.sessions`) only asked "are these
   keys truthy" — a file with sessions:"oops" or sessions:[] would pass this
   gate and then fail unpredictably somewhere inside migrate() or a later
   render(), with no clue why. This checks the actual shape every migration
   and view assumes: sessions/runs/settings must be real, non-array objects,
   and schemaVersion a real positive number. Still no schema library — just
   the handful of assumptions this file's own code already depends on. */
function looksLikeBackup(s) {
  const isObj = v => typeof v === 'object' && v !== null && !Array.isArray(v);
  return isObj(s) && typeof s.schemaVersion === 'number' && s.schemaVersion > 0
    && isObj(s.sessions) && isObj(s.runs) && isObj(s.settings);
}
window.importJSON = function (input) {
  const f = input.files[0]; if (!f) return;
  const r = new FileReader();
  r.onload = () => {
    try {
      const s = JSON.parse(r.result);
      if (!looksLikeBackup(s)) throw new Error('not a RunStrong backup');
      ST = migrate(s); save(); render();
      toast('Import complete ✓');
    } catch (e) { toast('Import failed: ' + e.message, 5000); }
  };
  r.readAsText(f);
};
window.resetAll = function () {
  if (confirm('Delete ALL workouts and history? Export a backup first!') && confirm('Really sure? This cannot be undone.')) {
    ST = defaultState(); save(); go('home');
  }
};

/* ---------- install banner ---------- */
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredPrompt = e; });
function installBanner() {
  if (ST.settings.seenInstall || window.matchMedia('(display-mode: standalone)').matches || navigator.standalone) return '';
  return `<div class="install" id="installbanner">
    <div>📲 <b>Install this app</b> for offline gym use</div>
    <button class="mini" onclick="showInstall()">How</button>
    <button class="mini dim" onclick="dismissInstall()" aria-label="Dismiss install prompt">✕</button></div>`;
}
window.dismissInstall = function () { ST.settings.seenInstall = true; save(); const b = $('#installbanner'); if (b) b.remove(); };
window.showInstall = function (fromSettings) {
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const m = $('#modal');
  let inner;
  if (deferredPrompt) {
    inner = `<h2>Install RunStrong</h2><button class="btn primary big" onclick="deferredPrompt.prompt();closeModal()">Install now</button>`;
  } else if (isIOS) {
    inner = `<h2>Add to Home Screen (iPhone)</h2><ol class="steps">
      <li>Tap the <b>Share</b> button <span class="kbd">⎋</span> at the bottom of Safari</li>
      <li>Scroll down, tap <b>Add to Home Screen</b></li>
      <li>Tap <b>Add</b> — done. Opens full-screen, works offline.</li></ol>`;
  } else {
    inner = `<h2>Add to Home Screen (Android)</h2><ol class="steps">
      <li>Tap the <b>⋮</b> menu in Chrome</li>
      <li>Tap <b>Add to Home screen</b> / <b>Install app</b></li>
      <li>Confirm — done. Opens full-screen, works offline.</li></ol>`;
  }
  m.innerHTML = `<div class="sheet">${inner}<button class="linkbtn" onclick="closeModal();${fromSettings ? '' : 'dismissInstall()'}">Close</button></div>`;
  m.classList.add('open');
};

/* ---------- boot ---------- */
window.go = go;
window.skipRest = skipRest;
document.addEventListener('click', ensureAudio, { once: true });
/* update banner: new SW takes control (skipWaiting+claim) → offer one-tap reload */
let swReg = null;
if ('serviceWorker' in navigator) {
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('sw.js').then(r => { swReg = r; r.update().catch(() => {}); }).catch(() => {});
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) return; // first install, not an update
    if (document.getElementById('updatebar')) return;
    document.body.insertAdjacentHTML('beforeend',
      `<div class="updatebar" id="updatebar" onclick="location.reload()">⬆ App updated — tap to load the new version</div>`);
  });
  // installed PWAs often resume from background without a cold start and never
  // re-check for updates — so check every time the app comes to the foreground
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && swReg) swReg.update().catch(() => {});
  });
}
window.checkForUpdates = async function () {
  if (!('serviceWorker' in navigator)) { toast('Updates unavailable in this browser.'); return; }
  toast('Checking for updates…');
  try {
    const r = swReg || await navigator.serviceWorker.getRegistration();
    if (!r) { toast('Not installed as an app yet — updates apply on normal reload.'); return; }
    await r.update();
    setTimeout(() => {
      if (document.getElementById('updatebar')) return;                    // banner already offering it
      if (r.installing || r.waiting) toast('Update found — installing. The banner will appear in a moment.');
      else toast(`You're on the latest version (${APP_VERSION}).`);
    }, 2500);
  } catch (e) { toast('Update check failed — are you online?'); }
};
if (ST.activeSessionId && ST.sessions[ST.activeSessionId] && ST.sessions[ST.activeSessionId].status === 'active') {
  view = { name: 'session' };
  acquireWakeLock();
}
/* ---- hardware / browser Back ----
   Seed a state for the view we boot into, then let Back walk the stack. Leaving
   an active workout asks first: the sets are saved either way, but the app
   disappearing mid-set reads as data loss even when it isn't. */
try { history.replaceState({ view }, ''); } catch (e) {}
window.addEventListener('popstate', ev => {
  const target = (ev.state && ev.state.view) || { name: 'home' };
  if (view.name === 'session' && ST.activeSessionId && target.name !== 'session') {
    if (!confirm('Leave the workout? Your sets are saved — you can resume from Today.')) {
      try { history.pushState({ view }, ''); } catch (e) {}   // re-arm, stay put
      return;
    }
  }
  view = target;
  render();
  window.scrollTo(0, 0);
});
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});  // free eviction insurance
// tapping the dimmed backdrop dismisses any prompt sheet (it re-offers next open)
$('#modal').addEventListener('click', e => { if (e.target === e.currentTarget) closeModal(); });
render();
if (ST.timer) runTimerLoop();
stravaHandleCallback().then(handled => {
  stravaSync(false);               // quiet auto-sync (6h throttle, never blocks or breaks offline use)
  if (handled) return;             // fresh connect already toasts + renders
  if (maybeWeeklySummary()) return;   // Sunday-evening (or later) week in review takes the stage first
  if (checkInDue()) openCheckIn(); // morning HRV first; run prompt chains after save/skip
  else autoPromptRun();
});
