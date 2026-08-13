/* RunStrong — app logic */
'use strict';

/* ================= state & storage ================= */
const DB_KEY = 'runstrong.db';
const SCHEMA_VERSION = 5;

function defaultState() {
  return {
    schemaVersion: SCHEMA_VERSION,
    settings: { step: 2.5, sound: true, vibrate: true, seenInstall: false, seenWhy: false },
    program: buildProgram(),
    sessions: {},          // sessionId (== date) → session record
    runs: {},              // date → {km, min, feel, note}
    fitness: { daily: {}, vo2: {}, skipped: null },  // daily: date→{hrv,rhr}; vo2: date→ml/kg/min; skipped: last skipped date
    strava: { clientId: '', clientSecret: '', tokenUrl: '', auth: null, activities: {}, lastSync: null, includeOther: false },
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

let ST = loadState();
function save() { localStorage.setItem(DB_KEY, JSON.stringify(ST)); }
save(); // persist immediately so migrations and first-visit program generation stick

/* ================= helpers ================= */
const $ = sel => document.querySelector(sel);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

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
function exHistory(exId, beforeDate) {
  const out = [];
  for (const id of Object.keys(ST.sessions).sort()) {
    const s = ST.sessions[id];
    if (s.status !== 'done' && id !== ST.activeSessionId) continue;
    if (beforeDate && s.date >= beforeDate) continue;
    for (const e of s.exercises) {
      if (e.exId !== exId) continue;
      const sets = e.sets.filter(x => x.done);
      if (sets.length) out.push({ date: s.date, sets });
    }
  }
  return out;
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
  const fl = $('#flash');
  fl.classList.add('on');
  setTimeout(() => fl.classList.remove('on'), 1800);
}
function fmtSecs(s) { return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
function skipRest() { ST.timer = null; save(); clearTimeout(bgNotifyTimeout); tickTimer(); }

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

/* ================= sessions ================= */
function buildSession(date, tplId, downgraded) {
  const tpl = TEMPLATES[tplId];
  const exercises = tpl.items.map(([exId, sets, reps]) => {
    const n = downgraded ? Math.max(1, sets - 1) : sets;
    const presc = nextPrescription(exId, exHistory(exId, date), ST.settings.step, reps);
    let w = presc.weight;
    if (downgraded && w) w = roundToStep(w * 0.9, ST.settings.step);
    return {
      exId, origExId: exId, tplSets: n, tplReps: reps,
      prescWeight: w, prescReason: presc.reason + (downgraded ? ' (downgraded −10%)' : ''),
      sets: Array.from({ length: n }, () => ({ weight: null, reps: null, rpe: null, note: '', done: false, failed: false, ts: null })),
    };
  });
  return { id: date, date, tpl: tplId, title: tpl.title, status: 'active', downgraded: !!downgraded, readiness: null, exercises, curIdx: 0, startedTs: Date.now(), finishedTs: null };
}

function swapExercise(sess, idx, newExId) {
  const e = sess.exercises[idx];
  const done = e.sets.filter(s => s.done);
  const presc = nextPrescription(newExId, exHistory(newExId, sess.date), ST.settings.step, e.tplReps);
  e.exId = newExId;
  e.prescWeight = presc.weight;
  e.prescReason = presc.reason;
  // keep completed sets (they belong to the old variant via their exId snapshot… simplest: sets logged before swap stay attributed to new variant only if none done)
  if (!done.length) e.sets.forEach(s => { s.weight = null; s.reps = null; s.rpe = null; });
  save();
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
  // 1. RPE drift: mean deviation from target, per session, for RPE-targeted exercises
  const devs = recent.map(s => {
    const ds = [];
    for (const e of s.exercises) {
      const ex = EXERCISES[e.exId];
      if (!ex.rpe) continue;
      const tgt = (ex.rpe[0] + ex.rpe[1]) / 2;
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
  return 'Fatigue is stacking up: ' + signals.join(', ') + '. Consider the downgraded version of your next session — running comes first.';
}

/* ================= rendering ================= */
const APP = $('#app');
let view = { name: 'home' };

function go(name, params) { view = Object.assign({ name }, params); render(); window.scrollTo(0, 0); }

let elapsedInterval = null;
function render() {
  const views = { home: vHome, schedule: vSchedule, session: vSession, summary: vSummary, history: vHistory, exdetail: vExDetail, settings: vSettings };
  const keepScroll = view.name === 'session' ? window.scrollY : null;   // logging a set must not move the page
  APP.innerHTML = (views[view.name] || vHome)();
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
  document.querySelectorAll('[data-nav]').forEach(b => b.classList.toggle('active', b.dataset.nav === (view.name === 'exdetail' ? 'history' : view.name)));
}

function navBar() {
  return `<nav class="tabbar">
    <button data-nav="home" onclick="go('home')"><span>🏠</span>Today</button>
    <button data-nav="schedule" onclick="go('schedule')"><span>📅</span>Plan</button>
    <button data-nav="history" onclick="go('history')"><span>📈</span>History</button>
    <button data-nav="settings" onclick="go('settings')"><span>⚙️</span>Settings</button>
  </nav>`;
}

function raceCountdowns() {
  return `<div class="races">` + RACES.map(r => {
    const d = daysUntil(r.date);
    const txt = d > 0 ? `${d} day${d === 1 ? '' : 's'}` : d === 0 ? 'TODAY 🏁' : 'done ✓';
    return `<div class="race ${r.tag === 'A race' ? 'arace' : ''}"><div class="race-name">${r.name}</div><div class="race-tag">${r.tag}</div><div class="race-count">${txt}</div></div>`;
  }).join('') + `</div>`;
}

/* ---------- Home / Today ---------- */
function vHome() {
  const t = today();
  const day = dayFor(t);
  const phase = phaseLabel(t);
  let card = '';
  const active = ST.activeSessionId && ST.sessions[ST.activeSessionId];
  if (active && active.status === 'active') {
    card = `<div class="card action" onclick="go('session')">
      <div class="card-kicker">Workout in progress</div>
      <div class="card-title">${esc(active.title)}</div>
      <div class="card-sub">Tap to continue — your place is saved</div>
      <button class="btn primary big">Resume workout</button></div>`;
  } else if (!day) {
    card = t < ST.program.startDate
      ? `<div class="card"><div class="card-title">Program starts ${fmtDate(ST.program.startDate)}</div><div class="card-sub">Browse the plan meanwhile 👇</div></div>`
      : `<div class="card"><div class="card-title">Program complete 🎉</div><div class="card-sub">Hope Melbourne went fast.</div></div>`;
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
    const logged = mr
      ? `<div class="run-logged">✓ ${mr.src !== 'manual' ? `<span class="svbadge ${mr.src}">${mr.src}</span> ${esc(mr.name || 'Run')} — ` : ''}${mr.km} km · ${mr.min} min · ${paceStr(mr.km, mr.min) || ''}${mr.hr ? ` · ${mr.hr} bpm` : ''}${mr.feel ? ` · felt ${mr.feel}` : ''}${mr.note ? ` · 📝 ${esc(mr.note)}` : ''}</div>
         <button class="mini" onclick="openRunLog('${t}')">${mr.feel ? 'edit' : 'add feel'}</button>`
      : skippedManual
        ? `<div class="run-logged dim">✗ skipped</div><button class="mini" onclick="openRunLog('${t}')">log anyway</button>`
        : `<button class="btn big" onclick="openRunLog('${t}')">🏃 Log this run</button>`;
    card = `<div class="card run"><div class="card-kicker">${day.kind === 'race' ? 'RACE DAY' : "Today's run"}</div><div class="card-title">${esc(day.title)}</div><div class="card-sub">${esc(day.sub || '')}</div><div class="card-sub dim">No lifting today — running is the priority.</div>${logged}</div>`;
  } else {
    card = `<div class="card"><div class="card-title">${esc(day.title || 'Rest')}</div><div class="card-sub">${esc(day.sub || 'Recovery is training too.')}</div></div>`;
  }
  const radar = deloadRadar();
  const radarCard = radar ? `<div class="card deload"><div class="card-kicker">⚠️ Deload radar</div><div class="card-sub">${esc(radar)}</div></div>` : '';
  const hasData = Object.values(ST.sessions).some(s => s.status === 'done') || Object.keys(ST.runs).length > 0;
  const backupDue = hasData && (!ST.lastBackup || Date.now() - ST.lastBackup > 7 * 86400000);
  const backupCard = backupDue ? `<div class="card backup"><div class="card-sub">💾 ${ST.lastBackup ? "It's been over a week since your last backup." : 'No backup yet.'} Data lives only on this device.</div><button class="btn" onclick="exportJSON();render()">Export backup now</button></div>` : '';
  const whyBtn = `<button class="linkbtn" onclick="showWhy()">Why this schedule?</button>`;
  return `<header class="top"><div class="phase">${esc(phase)}</div>${raceCountdowns()}</header>
    <main>${radarCard}${card}${upNext(t)}${backupCard}${whyBtn}</main>${navBar()}${installBanner()}`;
}

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
  if (!m.dataset.feel) { alert('Tap how it felt — it feeds the deload radar.'); return; }
  const splits = [...document.querySelectorAll('.splitfield')].map(f => parseSplit(f.value)).filter(s => s != null);
  const hr = parseInt($('#runhr').value, 10);
  ST.runs[date] = { km: parseFloat(m.dataset.km), min: parseFloat(m.dataset.min), feel: m.dataset.feel, note: $('#runnote').value.trim(), hr: isNaN(hr) ? null : hr, splits };
  save(); closeModal(); render();
  autoPromptRun(); // catch-up: chain to the next unlogged run day, if any
};
window.saveStravaFeel = function (date) {
  const m = $('#modal');
  if (!m.dataset.feel) { toast('Tap how it felt — it feeds the deload radar.'); return; }
  const sr = stravaRunOn(date);
  ST.runs[date] = { km: sr.km, min: sr.movingMin, hr: sr.avgHr || null, feel: m.dataset.feel, note: ($('#runnote')?.value || '').trim(), splits: [], fromStrava: true };
  save(); closeModal(); render();
  autoPromptRun();
};
window.skipRun = function (date) {
  ST.runs[date] = { skipped: true };
  save(); closeModal(); render();
  autoPromptRun();
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
  save(); render();
  return { added, dupes, skipped };
}
window.importGarminFile = function (input) {
  const f = input.files[0]; if (!f) return;
  const rd = new FileReader();
  rd.onload = () => {
    const res = importGarminText(rd.result);
    if (res.error) { alert(res.error); return; }
    toast(`Garmin import ✓ — ${res.added} new run${res.added === 1 ? '' : 's'}, ${res.dupes} already known${res.skipped ? `, ${res.skipped} skipped (non-runs / unreadable)` : ''}. 💾 Export a backup when you get a chance.`, 5500);
  };
  rd.readAsText(f);
  input.value = '';
};

/* ---- merged runs: Strava is the source of truth for distance/time/HR; manual log keeps feel/notes ---- */
function stravaRunOn(date) {
  const acts = Object.values(ST.strava?.activities || {});
  return acts.find(a => a.date === date && (a.type === 'Run' || ST.strava.includeOther)) || null;
}
function mergedRunFor(date) {
  const sr = stravaRunOn(date);
  const mr = ST.runs[date];
  if (sr) return { km: sr.km, min: sr.movingMin, hr: sr.avgHr ?? (mr && mr.hr) ?? null, feel: mr && !mr.skipped ? mr.feel : null, note: (mr && mr.note) || '', splits: (mr && mr.splits) || [], src: sr.src || 'strava', name: sr.name, effort: sr.effort, elevM: sr.elevM };
  if (mr && !mr.skipped) return { ...mr, src: 'manual' };
  return null;
}
function mergedRunsAll() {
  const dates = new Set(Object.keys(ST.runs).filter(d => !ST.runs[d].skipped));
  for (const a of Object.values(ST.strava?.activities || {})) if (a.type === 'Run' || ST.strava.includeOther) dates.add(a.date);
  const out = {};
  for (const d of [...dates].sort()) { const r = mergedRunFor(d); if (r) out[d] = r; }
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

/* auto-prompt: on app open, pop the log sheet for the oldest unlogged run day ≤ today.
   Today's own run only prompts after 10:00 so a morning check-in doesn't nag pre-run. */
function autoPromptRun() {
  if (ST.activeSessionId) return;                      // never interrupt a workout
  if ($('#modal').classList.contains('open')) return;
  const t = today();
  const candidates = [];
  for (const wk of ST.program.weeks) for (const d of wk.days) {
    if ((d.kind === 'run' || d.kind === 'race') && d.date <= t && !ST.runs[d.date]) candidates.push(d.date);
  }
  if (!candidates.length) return;
  const oldest = candidates[0];
  if (oldest === t && new Date().getHours() < 10) return;
  openRunLog(oldest);
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
    ? `Your Strava history says tomorrow is long-run day (median ${pat.medKm.toFixed(0)} km over ${pat.n} runs). A lighter leg session today protects it.` : null;
  m.innerHTML = `<div class="sheet">
    <h2>Quick readiness check</h2>
    ${todayRun ? `<div class="pace-line">🏃 Already run today: <b>${esc(todayRun.name || 'Run')}</b> — ${todayRun.km} km · ${paceStr(todayRun.km, todayRun.movingMin) || ''}${todayRun.avgHr ? ` · ${todayRun.avgHr} bpm` : ''}. Expect legs to feel heavier than the numbers suggest.</div>` : ''}
    ${runAware ? `<div class="notice">🏃 ${esc(runAware)}</div><button class="btn warn big" onclick="beginSession('${date}','${tpl}',{sore:3,fat:3},true)">Start lighter version (run-aware)</button>` : ''}
    ${radar ? `<div class="notice">⚠️ ${esc(radar)}</div>` : ''}
    <div class="ready-q"><div>Muscle soreness</div><div class="scale" id="r-sore">${[1,2,3,4,5].map(n=>`<button data-v="${n}">${n}</button>`).join('')}</div><div class="scale-lbl"><span>fresh</span><span>wrecked</span></div></div>
    <div class="ready-q"><div>Overall fatigue</div><div class="scale" id="r-fat">${[1,2,3,4,5].map(n=>`<button data-v="${n}">${n}</button>`).join('')}</div><div class="scale-lbl"><span>energised</span><span>flat</span></div></div>
    <button class="btn primary big" id="r-go" disabled>Start</button>
    <button class="linkbtn" onclick="closeModal()">Cancel</button></div>`;
  m.classList.add('open');
  let sore = null, fat = null;
  const update = () => {
    const go = $('#r-go');
    go.disabled = !(sore && fat);
    if (sore && fat) {
      const poor = sore + fat >= 7;
      go.textContent = poor ? 'Start (full session)' : 'Start';
      if (poor && !$('#r-down')) {
        go.insertAdjacentHTML('beforebegin', `<div class="notice">Rough day. Want the lighter version? (−1 set each, −10% load)</div><button class="btn warn big" id="r-down">Start downgraded session</button>`);
        $('#r-down').onclick = () => beginSession(date, tpl, { sore, fat }, true);
      }
    }
  };
  $('#r-sore').onclick = e => { if (e.target.dataset.v) { sore = +e.target.dataset.v; [...$('#r-sore').children].forEach(b => b.classList.toggle('sel', +b.dataset.v <= sore)); update(); } };
  $('#r-fat').onclick = e => { if (e.target.dataset.v) { fat = +e.target.dataset.v; [...$('#r-fat').children].forEach(b => b.classList.toggle('sel', +b.dataset.v <= fat)); update(); } };
  $('#r-go').onclick = () => beginSession(date, tpl, { sore, fat }, false);
};
window.closeModal = function () { $('#modal').classList.remove('open'); $('#modal').innerHTML = ''; };

function beginSession(date, tpl, readiness, downgraded) {
  closeModal();
  if ('Notification' in window && Notification.permission === 'default') {
    try { Notification.requestPermission(); } catch (e) {}
  }
  const s = buildSession(date, tpl, downgraded);
  s.readiness = readiness;
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
  const lastStr = last ? last.sets.map(t => setStr(ex, t)).join(', ') + ` <span class="dim">(${fmtDate(last.date)})</span>` : 'first time — no history';
  const rpeStr = ex.rpe ? `@ RPE ${ex.rpe[0] === ex.rpe[1] ? ex.rpe[0] : ex.rpe.join('–')}` : '';
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
      <input id="setnote" class="notefield" placeholder="Notes — niggles, form cues (optional)" value="${esc(t.note)}">
      <button class="btn primary big" onclick="logSet()">✓ Log set — rest ${fmtSecs(ex.rest)}</button>
      <button class="linkbtn" onclick="failSet()">mark set failed</button>
    </div>`;

  return `<header class="top slim">
      <button class="backbtn" onclick="go('home')">‹</button>
      <div class="prog-wrap"><div class="prog"><div class="prog-fill" style="width:${(100 * doneSets / totalSets).toFixed(0)}%"></div></div>
      <div class="prog-txt">${doneSets}/${totalSets} sets · ~${remainMin} min left · ⏱ <span id="sess-elapsed">${fmtElapsed(Date.now() - s.startedTs)}</span></div></div>
    </header>
    <main class="session">
      ${(() => { const tr = stravaRunOn(s.date); return tr ? `<div class="pace-line">🏃 <span class="svbadge ${tr.src || 'strava'}">${tr.src || 'strava'}</span> Already run today: <b>${esc(tr.name || 'Run')}</b> — ${tr.km} km · ${paceStr(tr.km, tr.movingMin) || ''}${tr.avgHr ? ` · ${tr.avgHr} bpm` : ''}</div>` : ''; })()}
      <div class="ex-head">
        <div class="ex-count">Exercise ${s.curIdx + 1} / ${s.exercises.length}</div>
        <h1>${esc(ex.name)}${ex.perSide ? ' <span class="perside">each side</span>' : ''}</h1>
        <div class="ex-rx">${e.tplSets} × ${e.tplReps}${unit} ${rpeStr} · rest ${fmtSecs(ex.rest)}</div>
        ${e.prescWeight != null && ex.mode !== 'bw' ? `<div class="ex-presc">Recommended: <b>${e.prescWeight} kg × ${e.tplReps}${unit}${ex.perSide ? '/side' : ''}</b></div>` : ''}
        <div class="ex-reason dim">${esc(e.prescReason || '')}</div>
        ${(() => { const noneDone = !e.sets.some(x => x.done); const wp = noneDone ? warmupPlan(e.exId, e.prescWeight != null ? e.prescWeight : (e.sets[0] && e.sets[0].weight), ST.settings.step) : null; return wp ? `<div class="ex-warm">🔥 Warm-up: ${wp}</div>` : ''; })()}
        <div class="ex-last">Last: ${lastStr}</div>
        <div class="ex-cue">${esc(ex.cue || '')}</div>
        ${ex.swaps.length ? `<button class="mini swap" onclick="openSwap()">⇄ swap exercise</button>` : ''}
      </div>
      <div class="sets">${setRows}</div>
      ${curPanel}
      <div class="ex-nav">
        <button class="btn" ${s.curIdx === 0 ? 'disabled' : ''} onclick="moveEx(-1)">‹ Prev</button>
        ${s.curIdx < s.exercises.length - 1
          ? `<button class="btn" onclick="moveEx(1)">Next ›</button>`
          : `<button class="btn primary" onclick="finishSession()">Finish 🏁</button>`}
      </div>
      ${s.curIdx < s.exercises.length - 1 ? `<button class="linkbtn" onclick="finishSession()">finish workout early</button>` : ''}
    </main>
    <div id="restbar" class="restbar" onclick="skipRest()"><div id="restbar-fill" class="restbar-fill"></div><div class="restbar-txt"><span id="restbar-label"></span><b id="restbar-time"></b><span class="dim">tap to skip</span></div></div>`;
}

function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
function setStr(ex, t) {
  const u = ex.mode === 'time' ? 's' : ex.mode === 'carry' ? 'm' : '';
  const w = ex.mode === 'bw' || !t.weight ? '' : t.weight + 'kg × ';
  return `${w}${t.reps}${u}${t.rpe != null ? ' @' + t.rpe : ''}${t.failed ? ' ✗' : ''}`;
}

function stepper(id, label, val, step) {
  return `<div class="stepper">
    <div class="stepper-lbl">${label}</div>
    <div class="stepper-row">
      <button class="stepbtn" onclick="step_('${id}',-${step})">−</button>
      <div class="stepval" id="v-${id}">${val}</div>
      <button class="stepbtn" onclick="step_('${id}',${step})">+</button>
    </div></div>`;
}
window.step_ = function (id, d) {
  ensureAudio();
  const s = ST.sessions[ST.activeSessionId]; const e = s.exercises[s.curIdx];
  const cur = e.sets.findIndex(t => !t.done); if (cur === -1) return;
  const t = e.sets[cur];
  if (id === 'weight') t.weight = Math.max(0, Math.round((t.weight + d) * 100) / 100);
  else t.reps = Math.max(0, t.reps + d);
  $('#v-' + id).textContent = id === 'weight' ? t.weight : t.reps;
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
  if (ex.rpe && t.rpe == null && !failed) { alert('Tap an RPE first — it drives your next weights.'); return; }
  t.note = $('#setnote') ? $('#setnote').value.trim() : '';
  t.failed = !!failed;
  t.done = true; t.ts = Date.now();
  vibrate(40);
  const wasLast = !e.sets.some(x => !x.done);
  save();
  if (!(wasLast && s.curIdx === s.exercises.length - 1)) startRest(ex.rest, esc(ex.name));
  if (wasLast && s.curIdx < s.exercises.length - 1) {
    s.curIdx++;
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
  const m = $('#modal');
  m.innerHTML = `<div class="sheet nextex">
    <div class="nextex-done">✓ ${esc(doneEx.name)} — done</div>
    <div class="nextex-kicker">NEXT · Exercise ${s.curIdx + 1} of ${s.exercises.length}</div>
    <h2 class="nextex-name">${esc(ex.name)}</h2>
    <div class="nextex-rx">${e.tplSets} × ${e.tplReps}${unit}${ex.perSide ? '/side' : ''}${e.prescWeight != null && ex.mode !== 'bw' ? ` @ <b>${e.prescWeight} kg</b>` : ''}${ex.rpe ? ` · RPE ${ex.rpe[0] === ex.rpe[1] ? ex.rpe[0] : ex.rpe.join('–')}` : ''}</div>
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
  save(); render();
};

window.openSwap = function () {
  const s = ST.sessions[ST.activeSessionId]; const e = s.exercises[s.curIdx];
  const base = EXERCISES[e.origExId];
  const opts = [e.origExId, ...base.swaps].filter(id => id !== e.exId);
  const m = $('#modal');
  m.innerHTML = `<div class="sheet"><h2>Swap exercise</h2><div class="dim" style="margin-bottom:12px">Equipment taken? Each variant keeps its own weight history.</div>` +
    opts.map(id => `<button class="btn big swapopt" onclick="doSwap('${id}')">${esc(EXERCISES[id].name)}</button>`).join('') +
    `<button class="linkbtn" onclick="closeModal()">Cancel</button></div>`;
  m.classList.add('open');
};
window.doSwap = function (id) {
  const s = ST.sessions[ST.activeSessionId];
  swapExercise(s, s.curIdx, id);
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

window.finishSession = function () {
  const s = ST.sessions[ST.activeSessionId];
  s.status = 'done'; s.finishedTs = Date.now();
  ST.activeSessionId = null; ST.timer = null;
  save();
  if (wakeLock) { try { wakeLock.release(); } catch (e) {} wakeLock = null; }
  go('summary', { sid: s.id });
};

/* ---------- summary ---------- */
function vSummary() {
  const s = ST.sessions[view.sid];
  if (!s) return vHome();
  let vol = 0, prs = [], rpeNow = [], rpePrev = [];
  for (const e of s.exercises) {
    const ex = EXERCISES[e.exId];
    const done = e.sets.filter(t => t.done);
    for (const t of done) {
      if (ex.mode === 'reps') vol += (t.weight || 0) * (t.reps || 0) * (ex.perSide ? 2 : 1);
      if (t.rpe != null) rpeNow.push(t.rpe);
    }
    // PR check: best e1RM this session vs all history before
    const bestNow = Math.max(0, ...done.map(t => e1rm(t.weight, t.reps, t.rpe)));
    const hist = exHistory(e.exId, s.date);
    const bestPrev = Math.max(0, ...hist.flatMap(h => h.sets.map(t => e1rm(t.weight, t.reps, t.rpe))));
    if (bestNow > 0 && bestNow > bestPrev && hist.length) prs.push(`${ex.name} — e1RM ${bestNow.toFixed(1)} kg`);
    const prev = hist[hist.length - 1];
    if (prev) prev.sets.forEach(t => { if (t.rpe != null) rpePrev.push(t.rpe); });
  }
  const avg = a => a.length ? (a.reduce((x, y) => x + y, 0) / a.length) : null;
  const rN = avg(rpeNow), rP = avg(rpePrev);
  const mins = s.finishedTs && s.startedTs ? Math.round((s.finishedTs - s.startedTs) / 60000) : null;
  return `<header class="top"><div class="phase">${esc(phaseLabel(s.date))}</div></header>
  <main>
    <div class="card"><div class="card-kicker">Session complete ✓</div><div class="card-title">${esc(s.title)}</div>
    <div class="card-sub">${fmtDate(s.date)}${mins ? ` · ${mins} min` : ''}${s.downgraded ? ' · downgraded' : ''}</div></div>
    <div class="statgrid">
      <div class="stat"><div class="stat-v">${(vol / 1000).toFixed(1)}t</div><div class="stat-l">total volume</div></div>
      <div class="stat"><div class="stat-v">${rN ? rN.toFixed(1) : '—'}</div><div class="stat-l">avg RPE${rP ? ` (last: ${rP.toFixed(1)})` : ''}</div></div>
      <div class="stat"><div class="stat-v">${prs.length}</div><div class="stat-l">PRs</div></div>
    </div>
    ${prs.length ? `<div class="card gold"><div class="card-kicker">🏆 New e1RM PRs</div>${prs.map(p => `<div class="pr">${esc(p)}</div>`).join('')}</div>` : ''}
    ${s.exercises.map((e, ei) => {
      const ex = EXERCISES[e.exId];
      const done = e.sets.filter(t => t.done);
      return `<div class="sumrow"><b>${esc(ex.name)} <button class="mini editbtn" onclick="openEditSets('${s.id}',${ei})">✎ edit</button></b><span>${done.map(t => setStr(ex, t)).join(' · ') || 'skipped'}</span>
        ${done.filter(t => t.note).map(t => `<div class="notesum">📝 ${esc(t.note)}</div>`).join('')}</div>`;
    }).join('')}
    <button class="btn primary big" onclick="go('home')">Done</button>
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
      <input type="number" step="0.5" inputmode="decimal" id="ew-${i}" value="${t.weight ?? ''}">
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
  return `<header class="top"><div class="phase">${esc(phaseLabel(t))}</div>${raceCountdowns()}</header>
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
  <button class="linkbtn" onclick="showWhy()">Why this schedule?</button>
  </main>${navBar()}`;
}

window.showWhy = function () {
  const m = $('#modal');
  m.innerHTML = `<div class="sheet"><div class="why">${WHY_SCHEDULE.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\n/g, '<br>')}</div>
  <button class="btn primary big" onclick="closeModal()">Got it</button></div>`;
  m.classList.add('open');
  ST.settings.seenWhy = true; save();
};

/* ---------- history ---------- */
function vHistory() {
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
  return `<header class="top"><div class="phase">${esc(phaseLabel(today()))}</div></header>
  <main>
    ${vFitness()}
    <div class="section-label">🏃 Running — weekly km</div>
    <div class="volchart">${weekKms.map(v => `<div class="volcol"><div class="volbar runbar" style="height:${Math.max(2, 100 * v.km / maxKm)}%"></div><div class="voln">${v.km ? v.km.toFixed(0) : ''}</div><div class="voll">W${v.wk}</div></div>`).join('')}</div>
    <div class="section-label">Pace trend (min/km — up = faster)</div>
    ${runPaceChart(runPts)}
    ${runPts.length ? `<div class="section-label">Run log</div>` + runPts.slice().reverse().map(p =>
      `<div class="sumrow"><b>${typeIcon(p.type)} ${fmtDate(p.date)} — ${esc(p.type === 'race' ? 'RACE' : p.type)}${p.src !== 'manual' ? ' <span class="svbadge ' + p.src + '">' + p.src + '</span>' : ''}</b>
       <span>${p.km} km · ${p.min} min · ${paceStr(p.km, p.min)}${p.hr ? ` · ${p.hr} bpm` : ''}${p.feel ? ` · felt ${p.feel}` : ''}</span>
       ${p.splits.length ? `<div class="notesum">splits: ${p.splits.map(fmtSplit).join(' · ')}</div>` : ''}</div>`).join('') : ''}
    <div class="section-label">🏋️ Lifting — weekly volume (tonnes)</div>
    <div class="volchart">${weekVols.map(v => `<div class="volcol"><div class="volbar" style="height:${Math.max(2, 100 * v.vol / maxV)}%"></div><div class="voln">${(v.vol / 1000).toFixed(1)}</div><div class="voll">W${v.wk}</div></div>`).join('')}</div>
    <div class="section-label">Exercise trends</div>
    ${withHist.length ? withHist.map(id => {
      const h = exHistory(id);
      const last = h[h.length - 1];
      const top = Math.max(...last.sets.map(t => t.weight || 0));
      return `<div class="exlist-row" onclick="go('exdetail',{ex:'${id}'})"><span>${esc(EXERCISES[id].name)}</span><span class="dim">${h.length} session${h.length > 1 ? 's' : ''} · last ${top} kg</span><span>›</span></div>`;
    }).join('') : `<div class="card"><div class="card-sub">No workouts logged yet. Charts appear here after your first session.</div></div>`}
  </main>${navBar()}`;
}

function vExDetail() {
  const id = view.ex; const ex = EXERCISES[id];
  const h = exHistory(id);
  const pts = h.map(s => ({
    date: s.date,
    top: Math.max(...s.sets.map(t => t.weight || 0)),
    e1: Math.max(...s.sets.map(t => e1rm(t.weight, t.reps, t.rpe))),
  }));
  return `<header class="top slim"><button class="backbtn" onclick="go('history')">‹</button><div class="phase">${esc(ex.name)}</div></header>
  <main>
    ${svgChart(pts)}
    ${h.slice().reverse().map(s => `<div class="sumrow"><b>${fmtDate(s.date)}</b><span>${s.sets.map(t => setStr(ex, t)).join(' · ')}</span>
      ${s.sets.filter(t => t.note).map(t => `<div class="notesum">📝 ${esc(t.note)}</div>`).join('')}</div>`).join('')}
  </main>${navBar()}`;
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

/* ---------- settings ---------- */
function vSettings() {
  return `<header class="top"><div class="phase">Settings</div></header>
  <main>
    <div class="set-row"><span>Weight stepper increment</span>
      <select onchange="ST.settings.step=+this.value;save()">
        ${[1, 1.25, 2.5, 5].map(v => `<option value="${v}" ${ST.settings.step === v ? 'selected' : ''}>${v} kg</option>`).join('')}
      </select></div>
    <div class="set-row"><span>Rest chime</span><button class="toggle ${ST.settings.sound ? 'on' : ''}" onclick="ST.settings.sound=!ST.settings.sound;save();render()">${ST.settings.sound ? 'ON' : 'OFF'}</button></div>
    <div class="set-row"><span>Vibration</span><button class="toggle ${ST.settings.vibrate ? 'on' : ''}" onclick="ST.settings.vibrate=!ST.settings.vibrate;save();render()">${ST.settings.vibrate ? 'ON' : 'OFF'}</button></div>
    <div class="section-label">Run sync</div>
    <div class="dim small" style="margin-bottom:8px">Import your runs from <b>Garmin Connect</b> (free): on connect.garmin.com go to Activities → All Activities → Export CSV, then load the file here. Re-imports skip runs it already knows.</div>
    <button class="btn primary big" onclick="document.getElementById('garminpick').click()">📥 Import Garmin CSV</button>
    <input type="file" id="garminpick" accept=".csv,text/csv" style="display:none" onchange="importGarminFile(this)">
    <div class="set-row"><span>Synced activities</span><span class="dim small">${Object.keys(ST.strava.activities).length} cached${ST.strava.lastSync ? ' · updated ' + new Date(ST.strava.lastSync).toLocaleDateString() : ''}</span></div>
    <div class="set-row"><span>Include non-run activities</span><button class="toggle ${ST.strava.includeOther ? 'on' : ''}" onclick="ST.strava.includeOther=!ST.strava.includeOther;save();render()">${ST.strava.includeOther ? 'ON' : 'OFF'}</button></div>
    ${Object.keys(ST.strava.activities).length ? `<button class="btn small" onclick="if(confirm('Remove all synced activities? Manual run logs are kept.')){ST.strava.activities={};save();render();}">Clear synced activities</button>` : ''}
    <div class="section-label">Strava (optional — needs a paid Strava subscription for API access)</div>
    ${stravaConnected() ? `
      <div class="set-row"><span>Connected${ST.strava.auth.athlete ? ' as <b>' + esc(ST.strava.auth.athlete.name) + '</b>' : ''}</span><span class="svbadge">✓ strava</span></div>
      <div class="set-row"><span>Last sync</span><span class="dim small">${ST.strava.lastSync ? new Date(ST.strava.lastSync).toLocaleString() : 'never'} · ${Object.keys(ST.strava.activities).length} activities cached</span></div>
      <div class="set-row"><span>Include non-run activities</span><button class="toggle ${ST.strava.includeOther ? 'on' : ''}" onclick="ST.strava.includeOther=!ST.strava.includeOther;save();render()">${ST.strava.includeOther ? 'ON' : 'OFF'}</button></div>
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
    <div class="section-label">Danger zone</div>
    <button class="btn danger big" onclick="resetAll()">Reset everything</button>
    <div class="dim" style="text-align:center;margin-top:16px">RunStrong · schema v${SCHEMA_VERSION} · all data stays on this device</div>
  </main>${navBar()}`;
}

window.restoreV4Backup = function () {
  if (!confirm('Restore the automatic pre-Strava backup? This replaces current data with the state from just before the Strava update.')) return;
  try {
    const raw = localStorage.getItem('runstrong.backup.v4');
    ST = migrate(JSON.parse(raw)); save(); render();
    toast('Backup restored (and re-migrated to the current version).');
  } catch (e) { alert('Restore failed: ' + e.message); }
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
window.importJSON = function (input) {
  const f = input.files[0]; if (!f) return;
  const r = new FileReader();
  r.onload = () => {
    try {
      const s = JSON.parse(r.result);
      if (!s.schemaVersion || !s.sessions) throw new Error('not a RunStrong backup');
      ST = migrate(s); save(); render();
      alert('Import complete ✓');
    } catch (e) { alert('Import failed: ' + e.message); }
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
    <button class="mini dim" onclick="dismissInstall()">✕</button></div>`;
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
if ('serviceWorker' in navigator) {
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('sw.js').catch(() => {});
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) return; // first install, not an update
    if (document.getElementById('updatebar')) return;
    document.body.insertAdjacentHTML('beforeend',
      `<div class="updatebar" id="updatebar" onclick="location.reload()">⬆ App updated — tap to load the new version</div>`);
  });
}
if (ST.activeSessionId && ST.sessions[ST.activeSessionId] && ST.sessions[ST.activeSessionId].status === 'active') {
  view = { name: 'session' };
  acquireWakeLock();
}
render();
if (ST.timer) runTimerLoop();
stravaHandleCallback().then(handled => {
  stravaSync(false);               // quiet auto-sync (6h throttle, never blocks or breaks offline use)
  if (handled) return;             // fresh connect already toasts + renders
  if (checkInDue()) openCheckIn(); // morning HRV first; run prompt chains after save/skip
  else autoPromptRun();
});
