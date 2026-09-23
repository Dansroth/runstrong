/* RunStrong — app logic */
'use strict';

/* ================= state & storage ================= */
const DB_KEY = 'runstrong.db';
const SCHEMA_VERSION = 34;
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
    picks: {},          // v70: { [mesoIndex]: { [pool]: exId } } — the athlete's own rotation choice
    rescueDismissed: {},// v71: missed lift days the athlete chose to let go
    blockSeen: null,    // v70: the last mesocycle whose review card was acknowledged
    settings: { step: WEIGHT_STEP_DEFAULT, barWeight: 20, equip: defaultEquip(), sound: true, vibrate: true, seenInstall: false, disclaimerSeen: false, notifPrimed: false, reminder: { on: false, time: '17:30' } },
    program: buildProgram(),
    sessions: {},          // sessionId (== date) → session record
    runs: {},              // date → {km, min, feel, note}
    cardio: {},            // v75: date → {min, hr, rpe, note} | {skipped:true}
    fitness: { daily: {}, vo2: {}, skipped: null },  // daily: date→{hrv,rhr}; vo2: date→ml/kg/min; skipped: last skipped date
    weeklySummaries: [],   // archived Sunday summaries (data, not markup)
    races: { geelong: { checklist: {} } },   // checklist only since v64; the February race was removed in v69
    maintenance: { active: false, startedOn: null, program: 'balanced', mesoStart: null },
    routines: {},          // date → {prep, stretch} — warm-ups and run cool-downs
    planOverrides: {},     // date → day plan — days swapped in the Plan tab (see planWeeks)
    soreLog: [],           // [{date, areas: [STRETCH_AREAS ids]}] — from the on-demand stretch picker
    weights: {},           // date → kg. One number, weekly. Nothing derived from it.
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
  // 12 → 13: Melbourne dropped, Geelong is the A race (2026-09-12). The
  // program is stored, not recomputed, so rebuild it (precedent: 1 → 2):
  // the plan now ends on Geelong's Sunday with a real taper week. Sessions,
  // runs and routines are keyed by date and survive untouched. Melbourne's
  // race record only ever held an empty checklist for this user — drop it
  // rather than carry a dead race around.
  12: (s) => {
    s.program = buildProgram();
    if (s.races) delete s.races.melbourne;
    s.schemaVersion = 13; return s;
  },
  // 13 → 14: the off-season is a dated calendar (recovery week + hypertrophy
  // block, see buildOffseason in program.js), so the program is rebuilt to
  // run through 2026-11-29. Anyone who had started the old free-form
  // hypertrophy maintenance mode is moved onto the calendar (active → false);
  // the balanced 3-a-week fallback keeps working as a legacy mode. History
  // (sessions/runs/routines, keyed by date) is untouched.
  13: (s) => {
    s.program = buildProgram();
    if (s.maintenance && s.maintenance.active && s.maintenance.program === 'hypertrophy') s.maintenance.active = false;
    s.schemaVersion = 14; return s;
  },
  // 14 → 15: the hypertrophy block's program itself (v34) — new balanced
  // templates (hypLowerA/UpperA/LowerB/UpperB/Arms) replace the v27
  // chest-and-arms ones on the calendar, so the stored program is rebuilt.
  // Nothing else changes shape; history untouched.
  14: (s) => { s.program = buildProgram(); s.schemaVersion = 15; return s; },
  // 15 → 16: the February 2027 half joins RACES and the calendar gains the
  // 12-week run build (buildRunBuild). Additive: one new race record, the
  // program rebuilt. Geelong's record and result are untouched.
  15: (s) => {
    s.races = s.races || {};
    s.races.feb2027 = s.races.feb2027 || { checklist: {}, result: null, feel: null, note: '', projAtRace: null };
    s.program = buildProgram();
    s.schemaVersion = 16; return s;
  },
  // 16 → 17: swapping days in the Plan tab. Additive: planOverrides{}, keyed
  // by date, applied on read (planWeeks) so a rebuilt program never loses a
  // swap. History untouched.
  16: (s) => { s.planOverrides = s.planOverrides || {}; s.schemaVersion = 17; return s; },
  // 17 → 18: every hypertrophy session gains rotating slots (lower days,
  // shoulder press), the run build's lifting becomes maintenance
  // (maint* templates, 2-3 a week), and the February race gets its real
  // name. Stored program rebuilt; swaps and history untouched.
  17: (s) => { s.program = buildProgram(); s.schemaVersion = 18; return s; },
  // 18 → 19: February became the Carman's Classic 10 km instead of the half
  // (2026-09-20). The 12-week half-marathon build is deleted and replaced by
  // the summer block — hypertrophy-led, running owned by the user's Runna
  // plan (buildSummer in program.js) — and the hypertrophy block's own week
  // is restructured: four 60 min lifts Mon/Tue/Thu/Fri, a short Sunday
  // session stacked with that day's run, Saturday off. Both are calendar
  // changes, so the stored program is rebuilt (precedent: 1 → 2). A swap
  // stored against a date whose plan no longer exists is dropped rather than
  // left pointing at a retired session; sessions, runs and routines are
  // keyed by date and survive untouched.
  18: (s) => {
    s.program = buildProgram();
    if (s.planOverrides) {
      for (const d of Object.keys(s.planOverrides)) {
        const o = s.planOverrides[d];
        if (o && o.kind === 'lift' && !TEMPLATES[o.tpl]) delete s.planOverrides[d];
      }
    }
    s.schemaVersion = 19; return s;
  },
  // 19 → 20: a bodyweight log. Purely additive — weights{} keyed by date,
  // one number per entry, weekly. Nothing else is stored and nothing is
  // derived from it; see the BODYWEIGHT header in program.js for why.
  19: (s) => { s.weights = s.weights || {}; s.schemaVersion = 20; return s; },
  // 20 → 21: the block starts Mon 2026-09-21 instead of 09-28 — the user asked
  // to begin the morning after Geelong, so the post-race recovery week is gone
  // and the block is ten weeks rather than nine (it still ends 29 Nov, so the
  // summer block is untouched). Calendar change, so the stored program is
  // rebuilt; a swap pointing at a day that no longer exists is dropped.
  20: (s) => {
    s.program = buildProgram();
    if (s.planOverrides) {
      for (const d of Object.keys(s.planOverrides)) {
        const o = s.planOverrides[d];
        if (o && o.kind === 'lift' && !TEMPLATES[o.tpl]) delete s.planOverrides[d];
      }
    }
    s.schemaVersion = 21; return s;
  },
  // 21 → 22: the daily reminder setting. Additive and off by default — an app
  // that switches its own notifications on is an app people mute.
  21: (s) => {
    s.settings = s.settings || {};
    s.settings.reminder = s.settings.reminder || { on: false, time: '17:30' };
    s.schemaVersion = 22; return s;
  },
  // 22 -> 23: the calendar no longer stops at the February race — eight
  // post-race weeks follow it (buildPostRace). Program rebuilt.
  22: (s) => { s.program = buildProgram(); s.schemaVersion = 23; return s; },
  // 23 → 24: Monday and Tuesday swapped so the week opens with Upper A and the
  // first squat session lands on Tuesday. Calendar change, program rebuilt.
  23: (s) => { s.program = buildProgram(); s.schemaVersion = 24; return s; },
  // 24 → 25: audit fixes — calf slots to 5 sets, and the summer Monday becomes
  // one blended lower session (hypLowerS) instead of alternating A/B. Calendar
  // change, program rebuilt.
  24: (s) => { s.program = buildProgram(); s.schemaVersion = 25; return s; },
  /* 25 → 26: the Strava and Garmin-CSV run sync is removed. The activities it
     cached were real run history — every km total, the aerobic-efficiency
     chart, the pace trend, the streak heatmap and the block reports read
     through mergedRunsAll(), which merged them with manually logged runs.
     Dropping the store outright would have deleted months of running from all
     of those, retroactively and silently. So each synced activity is folded
     into the manual run log first, and only then is strava{} discarded.
     A manual entry for the same date always wins: it is the one with the
     feel and the notes on it, and it was the user's own typing. */
  25: (s) => {
    const acts = (s.strava && s.strava.activities) || {};
    let kept = 0;
    for (const a of Object.values(acts)) {
      if (!a || !a.date || !a.km || !a.movingMin) continue;
      if (a.type && a.type !== 'Run' && !(s.strava && s.strava.includeOther)) continue;
      if (s.runs[a.date]) continue;                 // manual log, or a deliberate skip — leave it
      s.runs[a.date] = {
        km: a.km, min: a.movingMin, hr: a.avgHr || null, feel: null,
        note: a.name && a.name !== 'Run' ? a.name : '', splits: [], imported: true,
      };
      kept++;
    }
    s.importedRunCount = kept;                      // surfaced once in Settings so the change is visible
    delete s.strava;
    s.schemaVersion = 26; return s;
  },
  /* 26 → 27: "Log official result" is gone — a race is logged like any other
     run now, through the screenshot import or by hand. Any result already
     recorded is folded into that day's run note rather than dropped, since it
     was a finish time the user typed and the run log is where race day lives
     from here. The checklist stays: it is race-week prep, not a result. */
  26: (s) => {
    for (const key of Object.keys(s.races || {})) {
      const st = s.races[key] || {};
      const race = (typeof RACES !== 'undefined' ? RACES : []).find(r => r.key === key);
      if (st.result && race) {
        const run = s.runs[race.date];
        const line = 'Official: ' + st.result + (st.feel ? ' (' + st.feel + ')' : '') + (st.note ? ' — ' + st.note : '');
        if (run && !run.skipped) run.note = run.note ? run.note + ' · ' + line : line;
        else if (!run) s.runs[race.date] = { km: null, min: null, hr: null, feel: st.feel || null, note: line, splits: [] };
      }
      s.races[key] = { checklist: st.checklist || {} };
    }
    s.schemaVersion = 27; return s;
  },
  // 27 → 28: Arms & Core moves to Saturday, Sunday becomes a run. Calendar
  // change, so the stored program is rebuilt.
  27: (s) => { s.program = buildProgram(); s.schemaVersion = 28; return s; },
  // 28 → 29: a dated exception for the week of 21 Sep (start Tuesday, upper
  // first, no leg days). Calendar change, so the stored program is rebuilt —
  // and it will need rebuilding again when the exception expires, which the
  // next schema bump or any later calendar change will do anyway.
  28: (s) => { s.program = buildProgram(); s.schemaVersion = 29; return s; },
  /* 29 → 30: the split rebuilt around chest, biceps and abs. New templates
     (hypPush / hypPull / hypUpper) replace the old upper/lower pair, legs
     become one full session, and the calendar is rebuilt. A day-swap pointing
     at a template that no longer exists is dropped rather than left dangling. */
  29: (s) => {
    s.program = buildProgram();
    if (s.planOverrides) {
      for (const d of Object.keys(s.planOverrides)) {
        const o = s.planOverrides[d];
        if (o && o.kind === 'lift' && !TEMPLATES[o.tpl]) delete s.planOverrides[d];
      }
    }
    s.schemaVersion = 30; return s;
  },
  // 30 → 31: no switch to a running programme on 30 Nov. The summer block,
  // its transition week and the post-race block collapse into one continuous
  // thirty-week block on the same split. Calendar rebuilt.
  30: (s) => { s.program = buildProgram(); s.schemaVersion = 31; return s; },
  // 31 → 32: the February 10 km is removed. Its race-week layout goes with it,
  // so that week becomes an ordinary training week; the calendar is rebuilt and
  // the race's stored record dropped. Geelong's is kept — it was actually run.
  31: (s) => {
    if (s.races) delete s.races.feb2027;
    s.program = buildProgram();
    s.schemaVersion = 32; return s;
  },
  /* 32 → 33: the four things that make a thirty-week block worth opening —
     a benchmark day in every deload week, rotation on the accessory slots
     that were frozen, a rep style per mesocycle, and a choice at each block
     boundary. The calendar changes (Saturday of a deload week is now the
     benchmark), so the stored program is rebuilt.

     Nothing is discarded. Logged sessions are keyed by date and untouched;
     the lifts that left the templates keep their history and their PRs,
     because an exercise dropping out of a rotation has never meant its
     history should vanish — the same rule v67 followed when it retired three
     pools. `picks` starts empty, which is exactly the behaviour before this
     migration: no pick means the computed rotation. `blockSeen` is seeded to
     the CURRENT mesocycle rather than to null so an upgrade mid-block does
     not open on a review of four weeks the athlete has already lived
     through; the card appears at the next real boundary. */
  32: (s) => {
    s.program = buildProgram();
    s.picks = s.picks || {};
    if (s.blockSeen == null) {
      const t = today();
      s.blockSeen = t >= HYPER_START ? mesoIndex(HYPER_START, t) : null;
    }
    s.schemaVersion = 33; return s;
  },
  /* 33 → 34: no running goal any more, so the Wednesday and Sunday runs
     become conditioning days (see CONDITIONING in program.js). The calendar
     is rebuilt; every logged run stays in ST.runs and in the running stats —
     it happened, so it stays history. Cardio gets its own log, because a
     bike session has no kilometres and a run sheet would ask for them. */
  33: (s) => {
    s.program = buildProgram();
    s.cardio = s.cardio || {};
    s.schemaVersion = 34; return s;
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
  invalidateExHistory(); invalidateMergedRuns(); invalidatePlan();
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
const APP_VERSION = 'v75';   // keep in step with the sw.js CACHE bump each deploy
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

/* The calendar as the user sees it: the generated program with any swapped
   days applied. Every reader goes through this (or weekFor/dayFor), never
   planWeeks() directly, so a swap shows up everywhere at once. Cached
   per render; save() and render() drop it. */
var _planCache = null;   // var, not let: loadState() → save() clears this before the line runs
function planWeeks() {
  if (!_planCache) _planCache = applyOverrides(ST.program['weeks'], ST.planOverrides || {});
  return _planCache;
}
function invalidatePlan() { _planCache = null; }
/* The day as the generator laid it out, ignoring swaps. */
function originalDay(date) {
  const w = ST.program['weeks'].find(w => date >= w.days[0].date && date <= w.days[w.days.length - 1].date);
  return w ? w.days.find(d => d.date === date) : null;
}
function weekFor(date) {
  return planWeeks().find(w => date >= w.days[0].date && date <= w.days[w.days.length - 1].date) || null;
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
/* The exercise-insight heading. "Why this helps your half" is honest in a
   race block; in the hypertrophy block the lifts are growth lifts and their
   copy says so, so the heading must not claim otherwise. */
function whyLabel(date) {
  const key = phaseKeyFromLabel((weekFor(date || today()) || {}).phase);
  return key === 'hypertrophy' || key === 'hyperDeload' ? 'Why this exercise' : 'Why this helps your half';
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
      /* tplReps travels with the entry (v70). nextPrescription() judges a
         session against the rep target it was actually prescribed, which is
         no longer always the current one — the rep style turns over every
         mesocycle. Sessions logged before v70 already carry tplReps because
         buildSession() has always written it, so this is retroactive for
         free; the engine falls back to the current target where it is
         missing. */
      arr.push({ date: s.date, sets, tplReps: e.tplReps });
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
/* Every caller that turns a template id into real exercises goes through
   here, so the athlete's rotation picks (v70) reach the day preview, the
   Home card, the warm-up and the session itself without five call sites
   having to remember to pass them. materializeTemplate() stays pure and
   takes them as an argument; this is the one function that reads ST. */
function matTpl(tplId, date) {
  return materializeTemplate(tplId, date, mesoAnchor(ST.maintenance), ST.picks);
}
function progressionCtx(date, downgrade) {
  if (downgrade) return { phase: 'deload' };
  if (ST.maintenance.active) return { phase: inRecoveryWeek() ? 'deload' : 'maint' };   // legacy balanced fallback
  const w = weekFor(date);
  return { phase: phaseKeyFromLabel(w && w.phase) };
}

/* downgrade: false | 'light' (−1 set, −10% load) | 'red' (−40% volume, −10% load).
   The −10% load now comes from the 'deload' phase policy inside nextPrescription,
   so it is rounded to the user's increment once instead of being multiplied twice. */
function buildSession(date, tplId, downgrade, capMins) {
  // materializeTemplate resolves hypertrophy-phase 'ROTATE:<pool>' sentinels
  // into real exIds for this date; every other template has no sentinel and
  // passes through unchanged, so this is safe for every tplId.
  /* The time cap is applied BEFORE the readiness downgrade, not instead of
     it. They answer different questions — 'how long have I got' and 'how
     rough do I feel' — and someone can honestly be both short of time and
     wrecked. fitToMinutes() decides which exercises and how many sets fit;
     the downgrade below then trims what is left, as it always has. */
  const tpl = fitToMinutes(matTpl(tplId, date), capMins);
  const ctx = progressionCtx(date, downgrade);
  // Block volume (weekly ramp, deload halving) is already applied by
  // materializeTemplate; only the readiness downgrade is decided here.
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
  return { id: date, date, tpl: tplId, title: tpl.title, status: 'active', downgraded: downgrade || false, phase: ctx.phase,
    capMins: tpl.capMins || null, capDropped: tpl.dropped || [], capTrimmed: tpl.trimmed || [], capEst: tpl.est,
    readiness: null, guidance: null, stretch: null, exercises, curIdx: 0, startedTs: Date.now(), finishedTs: null };
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
  const views = { home: vHome, schedule: vSchedule, session: vSession, summary: vSummary, exdetail: vExDetail, daypreview: vDayPreview, settings: vSettings, stretch: vStretch, catalogue: vCatalogue, programme: vProgramme, progress: vProgress, history: vProgress, trends: vProgress };
  invalidateMergedRuns(); invalidateExHistory(); invalidatePlan();   // one build per render, never a stale one
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
  /* Only races still AHEAD (v72, on request). It used to keep a finished race
     on the header for a fortnight, which meant the first thing on the screen
     you open every morning was a countdown that had already finished — above
     the actual session. The countdown itself is untouched and returns on its
     own the day a race is added back. */
  const live = RACES.filter(r => daysUntil(r.date) >= 0);
  if (!live.length) return '';
  return `<div class="races">` + live.map(r => {
    const d = daysUntil(r.date);
    const txt = d > 0 ? `${d} day${d === 1 ? '' : 's'}` : 'TODAY 🏁';   // past races are filtered out above, so there is no third case
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
    out += `<div class="card racekit" role="button" tabindex="0" onclick="openChecklist('${rw}')"><div class="card-kicker">🏁 ${esc(r.name)} — race week</div><div class="card-sub">Checklist: ${done} of ${RACE_CHECKLIST.length} ticked. Tap to open.</div></div>`;
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
  for (const d in (ST.cardio || {})) if (cardioFor(d)) set.add(d);
  // a scheduled mobility session is a training day too (off-season weeks
  // plan one); an ad-hoc cool-down on a rest day is not
  for (const d in (ST.routines || {})) {
    const day = dayFor(d);
    if (day && (day.kind === 'mobility' || day.mobility) && routineDone(d, 'stretch')) set.add(d);
  }
  return set;
}
/* A day that keeps a streak alive: one you trained, or one the plan gave you
   off. Before v45 only the first counted, and since v39 — when the block
   gained a Saturday rest day — that made a streak longer than six days
   arithmetically impossible: it reset every Saturday. A streak that cannot be
   built is worse than no streak.
   So a scheduled rest day now bridges rather than breaks. It does not count
   toward the number either — the streak still measures days you trained, it
   just stops punishing you for a day off the plan asked you to take. The Home
   card for that day already says "Recovery is training too". A day you were
   meant to train and didn't still breaks it, which is the part that matters.
   Optional sessions bridge for the same reason adherence() excludes them. */
/* Whether the plan gave this day off. An optional session counts as off for
   the same reason adherence() excludes it: skipping it guilt-free is the
   point. The arithmetic itself is streakCount()/longestStreakCount() in
   program.js, where it is pure and tested. */
function plannedOffDay(d) {
  const day = dayFor(d);
  return !!(day && (day.kind === 'rest' || day.optional));
}
function currentStreak() { return streakCount(activityDates(), plannedOffDay, today(), STREAK_GRACE_DAYS); }
/* Longest run of consecutive activity dates ever, not just the live one —
   currentStreak() answers "am I on one right now", this answers "what's the
   best I've done", which needs the whole history rather than a walk back
   from today. */
function longestStreak() { return longestStreakCount(activityDates(), plannedOffDay, today(), STREAK_GRACE_DAYS); }
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
    <div class="card-kicker">${esc(kicker)}</div>
    <div class="card-sub">${streak > 0 ? `A lift or a run, any day, keeps it alive — and one missed day a fortnight won't end it.` : 'Log a lift or a run today to start one.'}</div>
    <div class="heatmap">${cells}</div>
  </div>`;
}

/* ---------- Home / Today ---------- */
function vHome() {
  const t = today();
  const day = dayFor(t);
  const phase = ST.maintenance.active ? (inRecoveryWeek() ? 'Recovery week' : 'Maintenance') : phaseLabel(t);
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
    card = `<div class="card card--lead action" role="button" tabindex="0" onclick="go('session')">
      <div class="card-kicker">Workout in progress</div>
      <div class="card-title">${esc(active.title)}</div>
      <div class="card-sub">Tap to continue — your place is saved</div>
      <button class="btn primary big">Resume workout</button></div>`;
  } else if (!day) {
    card = t < ST.program.startDate
      ? `<div class="card"><div class="card-title">Program starts ${fmtDate(ST.program.startDate)}</div><div class="card-sub">Browse the plan meanwhile 👇</div></div>`
      : `<div class="card"><div class="card-title">Program complete 🎉</div><div class="card-sub">Hope ${esc(finalRace().name)} went fast.</div><button class="btn primary big" onclick="offerRecoveryMode()">What's next?</button></div>`;
  } else if (day.kind === 'lift') {
    const done = ST.sessions[t] && ST.sessions[t].status === 'done';
    /* A lift day the plan also runs on — the summer block's Tuesday, the
       hypertrophy block's Sunday. The lift owns the card because it is what
       the app drives; the run gets its own row so it can be logged from
       here exactly as it would be on a run day. Mirrors the `mobility` flag
       on a run day, which works the same way round. */
    const runRow = !day.run ? '' : (() => {
      const mr = mergedRunFor(t);
      return mr
        ? `<div class="run-logged">✓ ${mr.km} km · ${mr.min} min${mr.feel ? ` · felt ${esc(mr.feel)}` : ''}</div>`
        : `<div class="card-sub dim">🏃 ${esc(day.runSub || 'A run today as well — either side of the lift.')}</div>
           <button class="btn" onclick="event.stopPropagation();openRunShot('${t}')">📷 Upload run screenshot</button>
           <button class="mini" onclick="event.stopPropagation();openRunLog('${t}')">or enter it manually</button>`;
    })();
    card = done
      ? `<div class="card"><div class="card-kicker">Done today ✓</div><div class="card-title">${esc(day.title)}</div><button class="btn" onclick="event.stopPropagation();go('summary',{sid:'${t}'})">View summary</button>${runRow}</div>`
      : `<div class="card card--lead action">
          <div class="card-kicker">${day.optional ? 'Optional today' : day.run ? "Today's lift + run" : "Today's lift"} · ~${TEMPLATES[day.tpl].est} min${(() => {
            /* Name the rep style on the card. An unannounced change from six
               reps to nine reads as the app getting it wrong; named, it reads
               as the block it is. */
            const st = matTpl(day.tpl, t).style;
            return st && st.delta ? ` · ${esc(st.name)} block` : '';
          })()}</div>
          <div class="card-title">${esc(day.title)}</div>${day.sub ? `<div class="card-sub">${esc(day.sub)}</div>` : ''}
          <div class="card-sub" role="button" tabindex="0" onclick="event.stopPropagation();go('daypreview',{tpl:'${day.tpl}',date:'${t}'})">${matTpl(day.tpl, t).items.map(i => esc(EXERCISES[i[0]].name)).join(' · ')} ›</div>
          <button class="btn primary big" onclick="openReadiness('${t}','${day.tpl}')">Start workout</button>${runRow}</div>`;
  } else if (day.kind === 'run' || day.kind === 'race') {
    const mr = mergedRunFor(t);
    const skippedManual = ST.runs[t] && ST.runs[t].skipped;
    /* Warm-up before the run, cool-down after it — the card only ever shows the
       one that's next, so "Log this run" never gets pushed down the screen.
       The warm-up is mobility only: no jog, no strides. */
    const prepBtn = `<button class="btn" onclick="startRunPrep('${t}')">🔥 ${routineDone(t, 'prep') ? 'Warm up again' : `Warm up — ${runPrepMins(day)} min`}</button>`;
    /* A run day flagged `mobility` carries the week's mobility session: the
       cool-down slot becomes the full-body routine instead of the run-only one. */
    const coolBtn = day.mobility
      ? `<button class="btn big" onclick="startMobility('${t}')">🧘 ${routineDone(t, 'stretch') ? 'Mobility done ✓ — again?' : `Mobility session — ${MOBILITY_MINS} min`}</button>`
      : `<button class="btn big" onclick="offerRunStretch('${t}')">🧘 ${routineDone(t, 'stretch') ? 'Stretch again' : 'Cool down'}</button>`;
    const logged = mr
      ? `<div class="run-logged">✓ ${mr.km} km · ${mr.min} min · ${paceStr(mr.km, mr.min) || ''}${mr.hr ? ` · ${mr.hr} bpm` : ''}${mr.feel ? ` · felt ${mr.feel}` : ''}${mr.note ? ` · 📝 ${esc(mr.note)}` : ''}</div>
         ${coolBtn}<button class="mini" onclick="openRunLog('${t}')">${mr.feel ? 'edit' : 'add feel'}</button>`
      : skippedManual
        ? `<div class="run-logged dim">✗ skipped</div><button class="mini" onclick="openRunLog('${t}')">log anyway</button>`
        : `${prepBtn}<button class="btn big" onclick="openRunShot('${t}')">📷 Upload run screenshot</button>
           <button class="mini" onclick="openRunLog('${t}')">or enter it manually</button>`;
    const raceHere = day.kind === 'race' ? RACES.find(r => r.date === t) : null;
    const raceBtn = '';   // "Log official result" removed in v64 — a race is logged like any other run
    // the mobility session is its own thing — reachable whether or not the run is logged yet
    const mobBtn = day.mobility && !mr ? coolBtn : '';
    card = `<div class="card card--lead run"><div class="card-kicker">${day.kind === 'race' ? 'RACE DAY' : day.mobility ? "Today's run + mobility" : "Today's run"}</div><div class="card-title">${esc(day.title)}</div><div class="card-sub">${esc(day.sub || '')}</div><div class="card-sub dim">${day.mobility ? 'No lifting today — an easy run, then the week\'s mobility session.' : 'No lifting today — running is the priority.'}</div>${logged}${mobBtn}${raceBtn}</div>`;
  } else if (day.kind === 'cardio') {
    card = cardioCard(day, t);
  } else if (day.kind === 'mobility') {
    const done = routineDone(t, 'stretch');
    card = `<div class="card ${done ? '' : 'card--lead action'}"><div class="card-kicker">${done ? 'Done today ✓' : `Mobility · ~${MOBILITY_MINS} min`}</div>
      <div class="card-title">${esc(day.title)}</div><div class="card-sub">${esc(day.sub || '')}</div>
      <button class="btn ${done ? '' : 'primary'} big" onclick="startMobility('${t}')">🧘 ${done ? 'Go again' : 'Start mobility session'}</button></div>`;
  } else {
    card = `<div class="card card--lead"><div class="card-title">${esc(day.title || 'Rest')}</div><div class="card-sub">${esc(day.sub || 'Recovery is training too.')}</div></div>`;
  }
  const radar = deloadRadar();
  const radarCard = (() => { try { return blockMomentCard() + rescueCard() + reminderCard() + weightNudgeCard(); } catch (e) { return ''; } })()
    + (radar ? `<div class="card deload"><div class="card-kicker">⚠️ Deload radar</div><div class="card-sub">${esc(radar)}</div></div>` : '');
  /* The unlogged-run backlog card is gone (v61, by request). It began as an
     improvement — v23 turned a queue of modal sheets into one passive card —
     but it was still the app counting your misses back at you every time you
     opened it, on a screen whose job is to show you today's session. Runs are
     logged when you log them; the pace trend and the deload radar work with
     whatever is there. */
  const backlogCard = '';
  const hasData = Object.values(ST.sessions).some(s => s.status === 'done') || Object.keys(ST.runs).length > 0 || Object.keys(ST.cardio || {}).length > 0;
  const backupDue = hasData && (!ST.lastBackup || Date.now() - ST.lastBackup > 7 * 86400000);
  const backupCard = backupDue ? `<div class="card backup"><div class="card-sub">💾 ${ST.lastBackup ? "It's been over a week since your last backup." : 'No backup yet.'} Data lives only on this device.</div><button class="btn" onclick="exportJSON();render()">Export backup now</button></div>` : '';
  const whyBtn = `<button class="linkbtn" onclick="showWhy()">Why this plan?</button>`;
  /* ---- ORDER IS THE HIERARCHY (v72) ----
     Today's session used to render THIRD, below a countdown for a race
     already run and a weight-log nudge, in a card visually identical to
     both of them. On the screen opened every single day, the one thing
     that matters was indistinguishable from a dismissible reminder.

     It now leads, and it is the only .card--lead on the screen. Nothing
     was added, removed or rewired — every card that rendered before still
     renders, with the same data and the same handlers. They are simply in
     the order of how much they matter, and the ones that are furniture now
     look like furniture. */
  const dateLine = new Date(t + 'T12:00').toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
  return `<header class="top">
      <div class="top-date">${esc(dateLine)}</div>
      <h1 class="phase">${esc(phase)}</h1>${raceCountdowns()}</header>
    <main>${card}${radarCard}${raceExtraCards()}${streakHeatmap()}${upNext(t)}${backlogCard}${backupCard}${soreSpotBtn()}${whyBtn}</main>${navBar()}${installBanner()}`;
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

/* ================= run screenshot → run log (v62) =================
   Point the camera roll at a Runna run screen and let the app read it, rather
   than tapping a distance in half-kilometre steps.

   Two decisions worth stating. The OCR engine (tesseract.js, ~15 MB with its
   wasm core and English model) loads from a CDN on first use and is cached by
   the service worker in a bucket that survives version bumps — bundling it
   would treble a first install for a feature most launches never touch, and
   re-downloading it on every deploy would be worse.

   And nothing is ever saved from a parse. The numbers land in the normal run
   sheet with everything editable and a Save you still have to press. OCR is
   confident and occasionally wrong, which is the combination that quietly
   corrupts a training log. Reading the screen for you is the feature; deciding
   what is true is not. */
const OCR_SRC = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
let ocrLoad = null;
function loadOcr() {
  if (window.Tesseract) return Promise.resolve();
  if (!ocrLoad) {
    ocrLoad = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = OCR_SRC;
      s.onload = res;
      s.onerror = () => { ocrLoad = null; rej(new Error('load failed')); };
      document.head.appendChild(s);
    });
  }
  return ocrLoad;
}
window.openRunShot = function (date) {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = 'image/*';
  inp.onchange = () => { if (inp.files && inp.files[0]) readRunShot(date, inp.files[0]); };
  inp.click();
};
async function readRunShot(date, file) {
  const m = $('#modal');
  const say = (s, sub) => {
    m.innerHTML = `<div class="sheet"><h2>📷 Reading your screenshot</h2>
      <div class="card-sub">${esc(s)}</div>${sub ? `<div class="dim small">${esc(sub)}</div>` : ''}
      <button class="linkbtn" onclick="closeModal()">Cancel</button></div>`;
    m.classList.add('open');
  };
  say('Starting up…', 'The first screenshot takes longer — the text reader downloads once, then works offline.');
  let worker;
  try {
    await loadOcr();
    say('Reading the numbers…', 'This takes a few seconds.');
    worker = await Tesseract.createWorker('eng');
    const { data } = await worker.recognize(file);
    const p = parseRunScreenshot(data.text);
    if (p.km == null && p.min == null) {
      m.innerHTML = `<div class="sheet"><h2>Couldn't read that one</h2>
        <div class="card-sub">No distance or time found. A full-screen shot of the run summary usually works best — or enter it by hand.</div>
        <button class="btn primary big" onclick="openRunLog('${date}')">Enter it manually</button>
        <button class="linkbtn" onclick="openRunShot('${date}')">Try another screenshot</button>
        <button class="linkbtn" onclick="closeModal()">Cancel</button></div>`;
      return;
    }
    closeModal();
    openRunLog(date, p);
  } catch (e) {
    m.innerHTML = `<div class="sheet"><h2>Couldn't read that one</h2>
      <div class="card-sub">${window.Tesseract ? 'Something went wrong reading the image.' : 'The text reader needs one online visit before it works offline.'}</div>
      <button class="btn primary big" onclick="openRunLog('${date}')">Enter it manually</button>
      <button class="linkbtn" onclick="closeModal()">Cancel</button></div>`;
  } finally {
    if (worker) { try { await worker.terminate(); } catch (e) {} }
  }
}

window.openRunLog = function (date, shot) {
  const day = dayFor(date);
  const r = ST.runs[date] && !ST.runs[date].skipped ? ST.runs[date] : { km: day && day.title === 'Long Run' ? 20 : day && (day.kind === 'race') ? 21.1 : day && day.title === 'Hard Run' ? 10 : 8, min: 60, feel: null, note: '', hr: '', splits: [] };
  /* Values read off a screenshot override the defaults but nothing else — the
     sheet stays fully editable and still needs a deliberate Save. */
  if (shot) {
    if (shot.km != null) r.km = shot.km;
    if (shot.min != null) r.min = Math.round(shot.min);
    if (shot.hr != null) r.hr = shot.hr;
  }
  /* A screenshot of a different day's run is an easy mistake to make and an
     annoying one to find later, so it is said out loud rather than silently
     filed against whatever day you happened to tap. */
  const shotNote = shot && shot.date && shot.date !== date
    ? `<div class="card-sub dim">⚠️ That screenshot is dated ${esc(fmtDate(shot.date))}, but you're logging ${esc(fmtDate(date))}.</div>` : '';
  const shotRead = shot
    ? `<div class="card-sub dim">📷 Read from your screenshot${shot.paceSec ? ` · ${Math.floor(shot.paceSec / 60)}:${String(shot.paceSec % 60).padStart(2, '0')} /km` : ''}${shot.elevM != null ? ` · ${shot.elevM} m↑` : ''}${shot.cadence != null ? ` · ${shot.cadence} spm` : ''}. Check it before saving.</div>` : '';
  const hard = isHardRun(date);
  const m = $('#modal');
  m.innerHTML = `<div class="sheet"><h2>${esc(day ? day.title : 'Run')} — ${fmtDate(date)}</h2>${shotNote}${shotRead}
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
window.skipRun = function (date) {
  ST.runs[date] = { skipped: true };
  save(); closeModal(); render();
};

/* ================= conditioning (v75) =================
   The two cardio days (see CONDITIONING in program.js). Logged as what the
   athlete asked to track — minutes, average heart rate, RPE — plus a note.
   Its own store rather than ST.runs: a bike session has no kilometres, and
   folding it into the runs would put watt-less, distance-less entries into
   every pace and efficiency chart the Progress tab draws. */
function cardioFor(date) {
  const c = ST.cardio && ST.cardio[date];
  return c && !c.skipped ? c : null;
}
function cardioSkipped(date) { return !!(ST.cardio && ST.cardio[date] && ST.cardio[date].skipped); }
function cardioLine(c) {
  return `${c.min} min${c.hr ? ` · ${c.hr} bpm` : ''}${c.rpe ? ` · RPE ${c.rpe}` : ''}${c.note ? ` · 📝 ${esc(c.note)}` : ''}`;
}
function cardioCard(day, t) {
  const c = cardioFor(t), cd = day.cardio || {};
  const hiit = cd.type === 'hiit';
  const mobBtn = day.mobility
    ? `<button class="btn big" onclick="startMobility('${t}')">🧘 ${routineDone(t, 'stretch') ? 'Mobility done ✓ — again?' : `Mobility session — ${MOBILITY_MINS} min`}</button>` : '';
  const detail = `<div class="card-sub"><b>${esc(cd.machine || '')}</b> · ${esc(cd.main || '')}</div>
    <div class="card-sub dim">Target: ${esc(cd.target || '')} · ~${cd.mins || ''} min${hiit ? ` incl. warm-up` : ''}</div>`;
  const action = c
    ? `<div class="run-logged">✓ ${cardioLine(c)}</div>${mobBtn}<button class="mini" onclick="openCardioLog('${t}')">edit</button>`
    : cardioSkipped(t)
      ? `<div class="run-logged dim">✗ skipped</div><button class="mini" onclick="openCardioLog('${t}')">log anyway</button>`
      : `<button class="btn primary big" onclick="openCardioLog('${t}')">Log ${hiit ? 'intervals' : 'cardio'}</button>${mobBtn}`;
  const why = hiit
    ? 'The week\'s one hard session — four days before legs, so it is gone by Thursday.'
    : 'Strictly easy — tomorrow is leg day. If you can\'t breathe through your nose, back off.';
  return `<div class="card ${c ? '' : 'card--lead action'} cardio"><div class="card-kicker">${c ? 'Done today ✓' : day.mobility ? "Today's cardio + mobility" : "Today's cardio"}</div>
    <div class="card-title">${esc(day.title)}</div>${detail}<div class="card-sub dim">${esc(why)}</div>${action}</div>`;
}
window.openCardioLog = function (date) {
  const day = dayFor(date);
  const cd = (day && day.cardio) || {};
  const prev = cardioFor(date);
  const r = prev ? { ...prev } : { min: cd.mins || 40, hr: '', rpe: null, note: '' };
  const m = $('#modal');
  m.innerHTML = `<div class="sheet"><h2>${esc(day ? day.title : 'Cardio')} — ${fmtDate(date)}</h2>
    ${cd.main ? `<div class="card-sub dim">Planned: ${esc(cd.machine)} · ${esc(cd.main)} · ${esc(cd.target)}</div>` : ''}
    <div class="stepper"><div class="stepper-lbl">Time (minutes, including warm-up)</div><div class="stepper-row">
      <button class="stepbtn" aria-label="5 minutes less" onclick="cardioStep(-5)">−</button><div class="stepval" id="cv-min">${r.min}</div><button class="stepbtn" aria-label="5 minutes more" onclick="cardioStep(5)">+</button></div></div>
    <div class="stepper"><div class="stepper-lbl">Average heart rate (bpm, optional)</div>
      <input id="cardiohr" class="notefield" type="number" inputmode="numeric" placeholder="${cd.type === 'hiit' ? 'e.g. 145' : 'e.g. 122'}" value="${r.hr || ''}"></div>
    <div class="stepper"><div class="stepper-lbl">How hard was it overall? (RPE 1–10)</div><div class="rpes" id="cardiorpes">
      ${[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(v => `<button class="rpe ${r.rpe === v ? 'sel' : ''}" data-v="${v}" onclick="pickCardioRpe(${v})">${v}</button>`).join('')}</div></div>
    <input id="cardionote" class="notefield" placeholder="Notes (optional) — e.g. watts or calories per rep" value="${esc(r.note || '')}">
    <button class="btn primary big" onclick="saveCardio('${date}')">Save</button>
    <button class="linkbtn" onclick="skipCardio('${date}')">I didn't do this session</button>
    <button class="linkbtn" onclick="closeModal()">Cancel</button></div>`;
  m.classList.add('open');
  m.dataset.min = r.min; m.dataset.rpe = r.rpe || '';
};
window.cardioStep = function (d) {
  const m = $('#modal');
  const v = Math.max(5, Math.min(120, (parseInt(m.dataset.min, 10) || 0) + d));
  m.dataset.min = v; $('#cv-min').textContent = v;
};
window.pickCardioRpe = function (v) {
  $('#modal').dataset.rpe = v;
  document.querySelectorAll('#cardiorpes .rpe').forEach(b => b.classList.toggle('sel', +b.dataset.v === v));
};
window.saveCardio = function (date) {
  const m = $('#modal');
  const rpe = parseInt(m.dataset.rpe, 10);
  if (!rpe) { const row = $('#cardiorpes'); if (row) { row.classList.remove('nudge'); void row.offsetWidth; row.classList.add('nudge'); } toast('Tap an RPE — it is how the sessions are compared week to week.'); return; }
  const hr = parseInt($('#cardiohr').value, 10);
  ST.cardio = ST.cardio || {};
  ST.cardio[date] = { min: parseInt(m.dataset.min, 10), hr: isNaN(hr) ? null : hr, rpe, note: $('#cardionote').value.trim() };
  save(); closeModal(); render();
};
window.skipCardio = function (date) {
  ST.cardio = ST.cardio || {};
  ST.cardio[date] = { skipped: true };
  save(); closeModal(); render();
};

function mergedRunFor(date) {
  const mr = ST.runs[date];
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
/* long-run day pattern from your logged runs (last 4 weeks) */
function longRunPattern() {
  const acts = Object.values(mergedRunsAll()).filter(a => a.date >= dadd(today(), -28));
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
  return planWeeks().map(wk => {
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
};
window.skipCheckIn = function () {
  ST.fitness.skipped = today();
  save(); closeModal();
};
window.updateVo2 = function () {
  const v = prompt('VO₂ max from Garmin (ml/kg/min):', Object.values(ST.fitness.vo2).slice(-1)[0] || '48');
  const n = parseInt(v, 10);
  if (!isNaN(n) && n > 20 && n < 90) { ST.fitness.vo2[today()] = n; save(); render(); }
};
/* aerobic efficiency: EF = (m/min) / avg HR, easy + long runs only (like vs like).
   Uses the manual run log. */
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
/* Removed in v69 with the February race — see below. Kept as a stub only in
   this comment: it projected a half-marathon finish from recent long runs, and
   with no race on the calendar there is nothing to project. */

/* Removed with the backlog card and the launch prompt (v61) — its only two
   callers were the two things that chased you about unlogged runs, and a
   helper whose whole purpose is enumerating your misses has no other use
   here. The Plan tab already shows which run days have a log against them. */

/* The launch-time run prompt is gone (v61, by request). v23 already cut it
   from a chain of sheets down to one; this removes the last of it. Opening the
   app to a dialog asking what you did yesterday is the app's agenda, not
   yours, and the Today screen's job is the session in front of you. Runs are
   logged from the run day itself, or from the Plan tab, when you choose to. */

function upNext(t) {
  const items = [];
  for (let i = 1; i <= 7 && items.length < 3; i++) {
    const d = dayFor(dadd(t, i));
    if (d && d.kind !== 'rest') items.push(d);
  }
  if (!items.length) return '';
  return `<div class="upnext"><div class="section-label">Up next</div>` + items.map(d =>
    `<div class="upnext-row"><span class="upnext-date">${fmtDate(d.date)}</span><span class="upnext-title ${d.kind}">${d.kind === 'run' ? '🏃 ' : d.kind === 'cardio' ? '🚴 ' : d.kind === 'race' ? '' : d.kind === 'lift' ? '🏋️ ' : ''}${esc(d.title)}</span></div>`).join('') + `</div>`;
}

/* ================= race kit + maintenance mode ================= */
function raceState(key) { return ST.races[key]; }
function raceInfo(key) { return RACES.find(r => r.key === key); }
/* The last race in RACES is the one the block builds to — its result is what
   opens the "what now?" hand-off. nextRace() is the first race still ahead
   (or the final one once they're all run) for countdown-style copy. Both
   exist so no view ever needs a literal race key again. */
function finalRace() { return RACES[RACES.length - 1]; }
function nextRace() { return RACES.find(r => daysUntil(r.date) >= 0) || finalRace(); }
function activeRaceWeek() {
  for (const r of RACES) { const d = daysUntil(r.date); if (d >= 0 && d <= 6) return r.key; }
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
/* Shown once the final race result is logged (and from the result card /
   "Program complete" card). The off-season is already on the calendar —
   this sheet just says so, and keeps the old free-form 3-a-week maintenance
   reachable as a fallback for anyone who wants no calendar at all. */
function offerRecoveryMode() {
  const m = $('#modal');
  const blockEnd = dadd(HYPER_START, BLOCK_WEEKS * 7 - 1);
  m.innerHTML = `<div class="sheet"><h2>The block is done. 🏁</h2>
    <p class="dim" style="line-height:1.6;margin-bottom:10px">Six weeks, one race. What's next is already on your Plan:</p>
    <div class="wksum-li">• <b>One continuous block</b> — ${esc(fmtDate(HYPER_START))} to ${esc(fmtDate(blockEnd))}. Five lifts a week (Push, Pull, Lower, Upper, and a 30 min Arms & Core), two cardio days and a mobility session, in four-week mesocycles of three loading weeks and a deload.</div>
    <div class="wksum-li">• <b>Cardio, not running</b> — Wednesday is easy zone-2 cardio (${CARDIO_HR.easy[0]}–${CARDIO_HR.easy[1]} bpm) the day before legs, so it has to leave them fresher. Sunday is the week's one interval session, four days before legs, alternating short reps and 4-minute reps each mesocycle. Mostly bikes, rower and uphill treadmill: cycling interferes with muscle growth less than running does, and short, hard sessions build fitness without eating into recovery.</div>
    <div class="wksum-li dim">The February 10 km sits inside it as one lighter week rather than a running block.</div>
    <button class="btn primary big" onclick="closeModal();go('schedule')" style="margin-top:12px">See the plan</button>
    <button class="linkbtn" onclick="if(confirm('Switch to 3 flexible workouts a week with no calendar? You can come back to the plan from Settings.'))startMaintenance('balanced')">Prefer 3 flexible workouts and no calendar?</button>
    <button class="linkbtn" onclick="closeModal()">Close</button></div>`;
  m.classList.add('open');
}
/* Legacy fallback: free-form balanced maintenance (3 sessions a week, any
   order, no calendar). The hypertrophy block is calendar-driven now and no
   longer a 'program' flavour here. */
window.startMaintenance = function () {
  ST.maintenance = { active: true, startedOn: today(), program: 'balanced', mesoStart: today() };
  save(); closeModal(); go('home');
  toast('Maintenance mode on: 3 workouts a week, your pace. The calendar is back in Settings whenever you want it.');
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
/* ---------- readiness check ---------- */
window.openReadiness = function (date, tpl) {
  ensureAudio();
  const m = $('#modal');
  const radar = deloadRadar();
  // run-aware guidance: today's completed run (context) + tomorrow's likely long run (suggestion)
  const todayRun = mergedRunFor(date);
  const isLower = tpl.startsWith('lower');
  const pat = longRunPattern();
  const tomorrowDow = new Date(dadd(date, 1) + 'T12:00').getDay();
  const runAware = isLower && pat && pat.dow === tomorrowDow
    ? `Your logged runs say tomorrow is long-run day (median ${pat.medKm.toFixed(0)} km over ${pat.n} runs). A lighter leg workout today protects it.` : null;
  m.innerHTML = `<div class="sheet">
    <h2>Quick readiness check</h2>
    ${todayRun ? `<div class="pace-line">🏃 Already run today: <b>${esc(todayRun.name || 'Run')}</b> — ${todayRun.km} km · ${paceStr(todayRun.km, todayRun.movingMin) || ''}${todayRun.avgHr ? ` · ${todayRun.avgHr} bpm` : ''}. Expect legs to feel heavier than the numbers suggest.</div>` : ''}
    ${runAware ? `<div class="notice">🏃 ${esc(runAware)}</div><button class="btn warn big" id="r-runaware">Start lighter version (run-aware)</button>` : ''}
    ${radar ? `<div class="notice">⚠️ ${esc(radar)}</div>` : ''}
    <div class="ready-q"><div>Muscle soreness</div><div class="scale" id="r-sore">${[1,2,3,4,5].map(n=>`<button data-v="${n}">${n}</button>`).join('')}</div><div class="scale-lbl"><span>fresh</span><span>wrecked</span></div></div>
    <div class="ready-q"><div>Overall fatigue</div><div class="scale" id="r-fat">${[1,2,3,4,5].map(n=>`<button data-v="${n}">${n}</button>`).join('')}</div><div class="scale-lbl"><span>energised</span><span>flat</span></div></div>
    ${(() => {
      /* Only offered where it would actually change something — a cap of 45
         on a 30 min arms day is a button that does nothing, and a row of
         those teaches people the row is decorative. */
      const est = (matTpl(tpl, date) || { est: 0 }).est;
      const caps = TIME_CAPS.filter(c => c < est);
      if (!caps.length) return '';
      return `<div class="ready-q"><div>Time you've got</div>
        <div class="scale" id="r-cap"><button data-v="0" class="sel">Full · ${est} min</button>${caps.slice().reverse().map(c => `<button data-v="${c}">${c} min</button>`).join('')}</div>
        <div class="scale-lbl"><span>Short on time? Take the cap — the main lifts stay, the tail comes off.</span></div></div>`;
    })()}
    <div class="ready-q" id="r-wu" hidden><div>Warm-up length</div>
      <div class="scale" id="r-wumins">${PREP_MINS_CHOICES.map(n => `<button data-v="${n}"${n === PREP_MINS_LIFT ? ' class="sel"' : ''}>${n} min</button>`).join('')}</div></div>
    <button class="btn primary big" id="r-go" disabled>Start</button>
    <button class="linkbtn" id="r-skipwu" hidden>Skip warm-up — straight to the workout</button>
    <button class="linkbtn" onclick="closeModal()">Cancel</button></div>`;
  m.classList.add('open');
  let sore = null, fat = null, guidance = null, wuMins = PREP_MINS_LIFT, capMins = null;
  /* Wired rather than inlined in the markup so it reads the cap chosen
     after the sheet was built, like every other exit from this sheet. */
  if ($('#r-runaware')) $('#r-runaware').onclick = () => beginSession(date, tpl, { sore: 3, fat: 3 }, 'light', null, capMins);
  if ($('#r-cap')) $('#r-cap').onclick = e => {
    if (!e.target.dataset.v) return;
    capMins = +e.target.dataset.v || null;
    [...$('#r-cap').children].forEach(b => b.classList.toggle('sel', (+b.dataset.v || null) === capMins));
  };
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
    if ($('#r-red')) $('#r-red').onclick = () => beginSession(date, tpl, { sore, fat }, 'red', { ...guidance, followed: 'lighter' }, capMins);
    /* The warm-up leads into the workout rather than sitting beside it — one tap
       to do the right thing, one link to opt out. The two "lighter day" escapes
       above keep starting immediately; someone taking those wants to get going. */
    go.textContent = guidance.level === 'red' ? `🔥 Warm up ${wuMins} min → full workout` : `🔥 Warm up ${wuMins} min → workout`;
    $('#r-wu').hidden = false;
    const skip = $('#r-skipwu');
    skip.hidden = false;
    skip.onclick = () => beginSession(date, tpl, { sore, fat }, false, guidance ? { ...guidance, followed: guidance.level === 'red' ? 'full-anyway' : 'full' } : null, capMins);
    if (!ST.settings.disclaimerSeen) { ST.settings.disclaimerSeen = true; save(); }
    if (!ST.settings.notifPrimed) { ST.settings.notifPrimed = true; save(); }
  };
  $('#r-sore').onclick = e => { if (e.target.dataset.v) { sore = +e.target.dataset.v; [...$('#r-sore').children].forEach(b => b.classList.toggle('sel', +b.dataset.v <= sore)); update(); } };
  $('#r-fat').onclick = e => { if (e.target.dataset.v) { fat = +e.target.dataset.v; [...$('#r-fat').children].forEach(b => b.classList.toggle('sel', +b.dataset.v <= fat)); update(); } };
  $('#r-go').onclick = () => startLiftPrep(date, tpl, { sore, fat }, false, guidance ? { ...guidance, followed: guidance.level === 'red' ? 'full-anyway' : 'full' } : null, wuMins, capMins);
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

function beginSession(date, tpl, readiness, downgrade, guidance, capMins) {
  closeModal();
  if ('Notification' in window && Notification.permission === 'default') {
    try { Notification.requestPermission(); } catch (e) {}
  }
  const s = buildSession(date, tpl, downgrade, capMins);
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
      ${(() => { const tr = mergedRunFor(s.date); return tr ? `<div class="pace-line">🏃 Already run today — ${tr.km} km · ${paceStr(tr.km, tr.min) || ''}${tr.hr ? ` · ${tr.hr} bpm` : ''}</div>` : ''; })()}
      ${(() => {
        /* Say what the cap cost, once, at the top. A shortened session that
           does not admit to being shortened is how someone later reads their
           own log and concludes the programme changed under them. */
        if (!s.capMins) return '';
        const bits = [];
        if ((s.capTrimmed || []).length) bits.push(`fewer sets on ${s.capTrimmed.map(x => esc(x.name)).join(', ')}`);
        if ((s.capDropped || []).length) bits.push(`no ${s.capDropped.map(esc).join(', ')}`);
        return `<div class="pace-line">⏱ ${s.capMins} min cap — ${bits.length ? bits.join('; ') : 'trimmed to fit'}. Still counts.</div>`;
      })()}
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
          <span class="ex-why-t">🎯 ${whyLabel(s.date)} ${whyOpen ? '▾' : '▸'}</span>
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
  /* Running is training too, and since v73 it is the ONLY way calves, hips,
     glutes and hamstrings reach a lifting day's routine. stretchRoutine() no
     longer reserves them a share of every session regardless of what you did;
     instead a recent run enters here as LOAD and they compete on merit at
     step 1, ranked against the muscles you actually lifted.

     Any run in the last two days now counts, not just a 12 km+ one. The old
     threshold made sense when the essentials had a guaranteed slot anyway —
     it was a BOOST on top. Now it is the whole mechanism, and an easy 8 km
     still leaves calves that want thirty seconds. Scaled by distance so a
     recovery jog does not outrank a session's worth of lifting: an easy run
     lands below a muscle that took six sets, a long run above it. */
  const run = [sess.date, dadd(sess.date, -1)]
    .map(d => mergedRunFor(d)).filter(r => r && r.km > 0).sort((a, b) => b.km - a.km)[0];
  if (run) {
    const bias = run.km >= 18 ? 4 : run.km >= 12 ? 3 : 2;
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
    <div class="dim" style="margin-bottom:12px;font-size:.9rem">Built from what you just trained${s.readiness && s.readiness.sore >= 4 ? ', biased toward today\'s soreness' : ''}${mergedRunFor(s.date) || mergedRunFor(dadd(s.date, -1)) ? ', plus the legs from your run' : ''}.</div>
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
function startLiftPrep(date, tpl, readiness, downgrade, guidance, mins, capMins) {
  closeModal();
  const m = mins || PREP_MINS_LIFT;
  const r = prepRoutine(plannedLoads(tpl, date, mesoAnchor(ST.maintenance)), m, { soreBias: !!(readiness && readiness.sore >= 4) });
  startRoutine({
    list: r.list, kind: 'prep', title: '🔥 Warm-up',
    endLabel: 'skip the rest — start the workout',
    markComplete: () => markRoutine(date, 'prep', m, r.list.length),
    onDone: () => beginSession(date, tpl, readiness, downgrade, guidance, capMins),
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
/* The weekly mobility session — a scheduled `kind: 'mobility'` day, or the
   `mobility` flag on a run day. Full body from the existing stretch library
   (mobilityRoutine in program.js), logged like any other routine so streaks,
   the Plan tab and the block retro can count it. */
window.startMobility = function (date) {
  closeModal();
  const r = mobilityRoutine(MOBILITY_MINS);
  startRoutine({
    list: r.list, kind: 'stretch', title: '🧘 Mobility',
    endLabel: 'end mobility — back to today',
    markComplete: () => markRoutine(date, 'stretch', MOBILITY_MINS, r.list.length),
    onDone: () => go('home'),
  });
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
    // legacy maintenance: 3 flexible sessions a week since start
    const perWeek = 3;
    const weeks = Math.max(1, Math.ceil((new Date(t) - new Date(ST.maintenance.startedOn || t)) / (7 * 86400000)));
    const done = Object.values(ST.sessions).filter(s => s.status === 'done' && s.date >= (ST.maintenance.startedOn || t)).length;
    return { done, planned: weeks * perWeek, streak: null };
  }
  const days = [];
  for (const wk of planWeeks()) for (const d of wk.days) if (d.kind === 'lift' && !d.optional && d.date <= t) days.push(d.date);
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
    <button class="mini" style="margin-top:6px" onclick="go('programme')">📋 Whole programme ›</button>
    <div class="dim small" style="margin-top:6px">💪 ${ad.done} of ${ad.planned} workouts${ad.streak != null && ad.streak >= 2 ? ` · 🔥 ${ad.streak}-workout streak` : ''}</div></header>
  <main>
  ${planWeeks().map(wk => `
    <div class="wk ${w && wk.num === w.num ? 'cur' : ''}">
      <div class="wk-head"><b>Week ${wk.num}</b><span>${esc(wk.phase)}</span>${wk.days.some(d => ST.planOverrides && ST.planOverrides[d.date]) ? `<button class="mini" onclick="resetWeek('${wk.days[0].date}')">reset week</button>` : ''}</div>
      ${wk.days.map(d => {
        const s = ST.sessions[d.date];
        const done = s && s.status === 'done';
        const isRun = d.kind === 'run' || d.kind === 'race';
        const merged = mergedRunFor(d.date);
        const runRec = isRun && (merged || ST.runs[d.date]);
        const runLogged = isRun && !!merged;
        const runSkipped = isRun && !merged && ST.runs[d.date] && ST.runs[d.date].skipped;
        const extraRun = false;   // was: a synced run on a non-plan day. Nothing syncs now, so a run only exists where it was logged.
        const mobDone = (d.kind === 'mobility' || d.mobility) && routineDone(d.date, 'stretch');
        const isCardio = d.kind === 'cardio';
        const cardioRec = isCardio ? cardioFor(d.date) : null;
        const cardioSkip = isCardio && !cardioRec && cardioSkipped(d.date);
        const icon = d.kind === 'run' ? (d.mobility ? '🏃🧘' : '🏃') : isCardio ? (d.mobility ? '🚴🧘' : '🚴') : d.kind === 'race' ? '🏁' : d.kind === 'lift' ? (d.run ? '🏋️🏃' : '🏋️') : d.kind === 'mobility' ? '🧘' : '·';
        let action = '';
        const moved = !!(ST.planOverrides && ST.planOverrides[d.date]);
        if (done) action = `<button class="mini" onclick="event.stopPropagation();go('summary',{sid:'${d.date}'})">view</button>`;
        else if (isRun && d.date <= t) action = `<button class="mini" onclick="event.stopPropagation();openRunLog('${d.date}')">${runRec ? 'edit' : 'log'}</button>`;
        else if (isCardio && d.date <= t) action = `<button class="mini" onclick="event.stopPropagation();openCardioLog('${d.date}')">${cardioRec || cardioSkip ? 'edit' : 'log'}</button>`;
        else if (!swapLockReason(d, t, isLoggedDate)) action = `<button class="mini" aria-label="Move ${esc(d.title || 'Rest')} to another day" onclick="event.stopPropagation();openMove('${d.date}')">move</button>`;
        const isLift = d.kind === 'lift' && !done;
        const rowClick = isLift ? ` onclick="go('daypreview',{tpl:'${d.tpl}',date:'${d.date}'})"` : '';
        return `<div class="wk-day ${d.date === t ? 'today' : ''} ${d.kind}"${rowClick}>
          <span class="wk-date">${fmtDate(d.date)}</span>
          <span class="wk-icon">${extraRun ? '🏃' : icon}</span>
          <span class="wk-title">${esc(d.title || 'Rest')}${done || runLogged || cardioRec || (mobDone && !isRun && !isCardio) ? ' <b class="done-tick">✓</b>' : ''}${moved ? ' <span class="tag-moved">moved</span>' : ''}${runSkipped || cardioSkip ? ' <span class="dim">✗</span>' : ''}${cardioRec ? ` <span class="dim">${cardioRec.min} min${cardioRec.rpe ? ` · RPE ${cardioRec.rpe}` : ''}</span>` : ''}${isCardio && d.cardio && !cardioRec ? ` <span class="dim">${esc(d.cardio.main)}</span>` : ''}${(runLogged || extraRun) && merged ? ` <span class="dim">${merged.km}km · ${paceStr(merged.km, merged.min) || ''}</span>` : ''}</span>
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

/* ---------- swapping days (Plan tab) ---------- */
/* A date is "logged" once anything happened on it — a lift (done or in
   progress), a run (manual or synced), a warm-up or a stretch. Those days
   stay where they are; the record and the plan must keep agreeing. */
function isLoggedDate(d) {
  const s = ST.sessions[d];
  if (s && (s.status === 'done' || s.status === 'active')) return true;
  if (mergedRunFor(d)) return true;
  if (cardioFor(d)) return true;
  const r = ST.routines && ST.routines[d];
  return !!(r && ((r.stretch && r.stretch.completed) || (r.prep && r.prep.completed)));
}
window.openMove = function (date) {
  const t = today();
  const day = dayFor(date), w = weekFor(date);
  const lock = swapLockReason(day, t, isLoggedDate);
  if (lock) { toast(`Can't move that — ${lock}.`); return; }
  const m = $('#modal');
  m.innerHTML = `<div class="sheet"><h2>Move ${esc(day.title || 'Rest')}</h2>
    <div class="dim small" style="margin-bottom:12px;line-height:1.5">${esc(fmtDate(date))}. Pick the day to trade places with — both days swap, nothing is lost. The plan will warn you if the new order puts leg work before a key run.</div>
    ${w.days.filter(d => d.date !== date).map(d => {
      const l = swapLockReason(d, t, isLoggedDate);
      return `<button class="exlist-row" ${l ? 'disabled style="opacity:.5"' : `onclick="doSwap('${date}','${d.date}')"`}><span>${esc(fmtDate(d.date))}</span><span class="dim">${esc(d.title || 'Rest')}${l ? ' · ' + esc(l) : ''}</span><span>${l ? '' : '›'}</span></button>`;
    }).join('')}
    <button class="linkbtn" onclick="closeModal()">Cancel</button></div>`;
  m.classList.add('open');
};
window.doSwap = function (a, b, force) {
  const w = weekFor(a);
  const dayA = dayFor(a), dayB = dayFor(b);
  if (!w || !dayA || !dayB || weekFor(b) !== w) { toast('Swaps stay inside one week.'); return; }
  const ov = swapDays(dayA, dayB);
  const after = w.days.map(d => ov[d.date] || d);
  const warnings = swapWarnings(after);
  if (warnings.length && !force) {
    const m = $('#modal');
    m.innerHTML = `<div class="sheet"><h2>Worth knowing</h2>
      ${warnings.map(x => `<div class="notice" style="margin-top:8px">⚠️ ${esc(x)}</div>`).join('')}
      <div class="dim small" style="margin:12px 0 4px">Your call — the plan just says why it was laid out the way it was.</div>
      <button class="btn primary big" onclick="doSwap('${a}','${b}',true)">Swap anyway</button>
      <button class="linkbtn" onclick="closeModal()">Leave it</button></div>`;
    m.classList.add('open');
    return;
  }
  ST.planOverrides = ST.planOverrides || {};
  for (const [date, plan] of Object.entries(ov)) {
    // a swap that lands a day back on its generated plan is no longer an override
    if (samePlan(originalDay(date), plan)) delete ST.planOverrides[date]; else ST.planOverrides[date] = plan;
  }
  save(); closeModal(); render();
  toast(`${dayA.title || 'Rest'} ↔ ${dayB.title || 'Rest'} swapped.`);
};
window.resetWeek = function (monday) {
  if (!ST.planOverrides) return;
  for (let i = 0; i < 7; i++) delete ST.planOverrides[dadd(monday, i)];
  save(); render(); toast('Week back to the plan.');
};

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
/* ---------- Progress ----------
   One page, four sections — Strength, Running, Recovery, Milestones — each
   a headline number, one chart and at most three lines, with everything
   else behind a "Details" disclosure or the existing detail views
   (vExDetail, showWeeklySummary, showRetro, showHyperRetro). It used to be
   two segments and ~20 items with the EF chart drawn twice; the old
   Log/Insights names survive only as deep-link aliases (setProgressTab).
   Order is phase-aware: Strength first in the hypertrophy block, Running
   first in a race build. A section with no data collapses to one dim line,
   never an empty chart. Nothing was deleted on the computation side —
   liftTrajectories, the explorers, efVerdict… only where they render. */
window.setProgressTab = function () { view = { name: 'progress' }; render(); window.scrollTo(0, 0); };
const PROGRESS_WEEKS = 10;   // bars shown: the last 10 weeks up to the current one
/* The last PROGRESS_WEEKS rows of weeklyLoad() up to the current week —
   28 calendar weeks of bars is unreadable on a phone. */
function recentLoad() {
  const t = today();
  const all = weeklyLoad();
  let idx = all.findIndex(w => t >= w.monday && t <= dadd(w.monday, 6));
  if (idx < 0) idx = all.length - 1;
  return { rows: all.slice(Math.max(0, idx - PROGRESS_WEEKS + 1), idx + 1), cur: all[idx] || null, prev: all[idx - 1] || null };
}
function barChart(rows, key, fmt, cls) {
  const max = Math.max(1, ...rows.map(r => r[key]));
  return `<div class="volchart">${rows.map(r => `<div class="volcol"><div class="volbar ${cls || ''}" style="height:${Math.max(2, 100 * r[key] / max)}%"></div><div class="voln">${r[key] ? fmt(r[key]) : ''}</div><div class="voll">W${r.wk}</div></div>`).join('')}</div>`;
}
const vs = (cur, prev, unit) => prev == null || !prev ? '' : ` <span class="dim small">vs ${prev}${unit} last week</span>`;
/* Weekly sets per muscle — the hypertrophy metric the app prescribed from but
   never showed (v42). Only rendered in a hypertrophy phase: during a race
   block the question is not "did chest get 13 sets", and the section would be
   noise. Logged against planned for the current week, plus the block's average
   week so a single missed session does not read as a collapse. */
function volumeByMuscleBlock() {
  const t = today();
  const blk = reportBlock(t);
  const wk = weekFor(t);
  if (!wk) return null;
  const weekStart = wk.days[0].date, weekEnd = wk.days[6].date;
  const sessions = Object.values(ST.sessions);
  const meso = mesoAnchor(ST.maintenance);
  const logged = setsByMuscle(sessions, weekStart, weekEnd);
  const planned = plannedSetsByMuscle(planWeeks(), weekStart, weekEnd, meso);
  const tons = tonnageByMuscle(sessions, weekStart, weekEnd);
  /* Block to date, averaged per week — weeksSince is whole weeks elapsed, so
     +1 counts the week in progress and never divides by zero. */
  const weeksIn = Math.max(1, weeksSince(blk.since, t) + 1);
  const blockSets = setsByMuscle(sessions, blk.since, t);
  const muscles = [...new Set([...Object.keys(planned), ...Object.keys(logged)])];
  if (!muscles.length) return null;
  const rank = m => (PRIORITY_MUSCLES.includes(m) ? 0 : 1);
  muscles.sort((a, b) => rank(a) - rank(b) || (planned[b] || 0) - (planned[a] || 0) || a.localeCompare(b));
  return { blk, weekStart, weekEnd, logged, planned, tons, blockSets, weeksIn, muscles };
}
function volumeByMuscleBody() {
  const v = volumeByMuscleBlock();
  if (!v) return '';
  const rows = v.muscles.map(m => {
    const done = v.logged[m] || 0, plan = v.planned[m] || 0;
    const pct = plan ? Math.min(100, Math.round(done / plan * 100)) : (done ? 100 : 0);
    const avg = (v.blockSets[m] || 0) / v.weeksIn;
    const ton = (v.tons[m] || 0) / 1000;
    const pri = PRIORITY_MUSCLES.includes(m);
    return `<div class="sumrow${pri ? '' : ' dim'}">
      <b>${pri ? '★ ' : ''}${esc(m)}</b>
      <span>${done}/${plan} sets · ${avg.toFixed(1)}/wk this block${ton >= 0.1 ? ` · ${ton.toFixed(1)} t` : ''}</span>
      <span class="volbar"><i style="width:${pct}%"></i></span></div>`;
  }).join('');
  /* How hard the week's sets actually were. [H4] drives every rpe target in
     the plan, and sets drifting to RPE 6-7 is the usual reason a block that
     looks right on paper underdelivers — so it is shown next to the volume
     rather than buried, and phrased as a fact rather than a grade. */
  const hs = hardSetShare(Object.values(ST.sessions), v.weekStart, v.weekEnd);
  const hardLine = hs.working
    ? `<div class="sumrow"><b>Close to failure</b><span>${hs.hard} of ${hs.working} working sets at RPE ${HARD_SET_RPE}+ · ${Math.round(hs.share * 100)}%</span>
       <span class="volbar"><i style="width:${Math.round(hs.share * 100)}%"></i></span></div>`
    : '';
  return `<details class="disc"><summary>Sets per muscle, this week ›</summary>
    <div class="prb-h">Week of ${fmtDate(v.weekStart)} · ${esc(v.blk.name)}</div>
    ${rows}
    ${(() => {
      /* Load against how you felt. The readiness check has been collecting a
         soreness and fatigue score before every session since the app began,
         and it was only ever spent on same-day guidance. Four weeks of sets
         beside four weeks of readiness is a pattern only the app can see.
         Stated as two columns and nothing else — volumeShiftNote() sets the
         precedent that this app does not assert causation from a correlation
         of n=4, and it is not going to start here. */
      const all = Object.values(ST.sessions);
      const rows = [];
      for (let i = 3; i >= 0; i--) {
        const wkStart = dadd(v.weekStart, -7 * i), wkEnd = dadd(wkStart, 6);
        const sets = Object.values(setsByMuscle(all, wkStart, wkEnd)).reduce((a, b) => a + b, 0);
        const r = readinessMean(all, wkStart, wkEnd);
        if (!sets && r == null) continue;
        rows.push(`<div class="sumrow"><b>${fmtDate(wkStart)}</b><span>${sets} muscle-sets · ${r == null ? 'no check-ins' : `readiness ${r.toFixed(1)}/10`}</span></div>`);
      }
      return rows.length > 1 ? `<div class="prb-h" style="margin-top:12px">Load and how you felt</div>${rows.join('')}
        <div class="dim small">Readiness is the pre-session soreness + fatigue score; higher is worse. Four weeks is too few to prove anything — it is here so you can notice, not so the app can diagnose.</div>` : '';
    })()}
    ${hardLine ? `<div class="prb-h" style="margin-top:12px">Effort</div>${hardLine}
      <div class="dim small">Counts only sets on lifts that carry an RPE target — plyometrics, carries and planks are prescribed nowhere near failure on purpose, so they sit this out.</div>` : ''}
    <div class="dim small" style="margin-top:8px">★ = what this block is for. Logged sets against what the plan asked for, so a set you skipped is not counted. A set credits every muscle its exercise is tagged with — a bench press counts for chest and shoulders both — which is why the pressing and pulling muscles read high. Only direct work is tagged, so presses and rows carry no arm tag and the arm numbers understate what your arms actually did.</div>
  </details>`;
}
/* ================= daily reminder (v47) =================
   The app only works if it gets opened, and until now nothing ever asked it
   to be: notifications existed solely for the rest timer.

   Be straight about the limits. A PWA with no push server cannot reliably
   wake itself at a chosen time — that needs a server pushing to the device,
   which this app deliberately does not have (everything stays local). Two
   mechanisms, best first, and the Settings copy says which one you are on:

   1. Notification Triggers (TimestampTrigger): the service worker fires the
      notification at the time even with the app shut. Chromium-only and not
      guaranteed, hence the capability check rather than a claim.
   2. An in-app nudge on Home: opened after the reminder time on a training
      day with nothing logged, you get a card. Weaker — it cannot reach you
      if you never open the app — but it never lies about what it is.

   Never on a rest day, and never once the session is logged. A reminder that
   fires on a day the plan gave you off is how people learn to ignore an app. */
function reminderCanSchedule() {
  return typeof window !== 'undefined' && 'Notification' in window
    && 'showTrigger' in (window.Notification.prototype || {}) && 'TimestampTrigger' in window;
}
/* The next moment we would want to nudge: today's reminder time if it is
   still ahead, otherwise tomorrow's. Pure given `now`. */
function nextReminderAt(now, hhmm) {
  const [h, m] = String(hhmm || '17:30').split(':').map(Number);
  const at = new Date(now); at.setHours(h || 0, m || 0, 0, 0);
  if (at <= now) at.setDate(at.getDate() + 1);
  return at;
}
/* Is `date` a day the plan expects a session, still unlogged? */
function reminderDue(date) {
  const day = dayFor(date);
  if (!day || day.kind !== 'lift' || day.optional) return false;
  return !(ST.sessions[date] && ST.sessions[date].status === 'done');
}
window.toggleReminder = async function () {
  const r = ST.settings.reminder;
  if (r.on) { r.on = false; save(); render(); return; }
  if ('Notification' in window && Notification.permission === 'default') {
    try { await Notification.requestPermission(); } catch (e) { /* denied is fine — the Home nudge still works */ }
  }
  r.on = true; save(); scheduleReminder(); scheduleBlockNotice(); render();
};
async function scheduleReminder() {
  const r = ST.settings.reminder;
  if (!r || !r.on || !reminderCanSchedule() || Notification.permission !== 'granted') return;
  try {
    const reg = await navigator.serviceWorker.ready;
    // clear any previously scheduled one so changing the time doesn't stack
    for (const n of await reg.getNotifications({ includeTriggered: true, tag: 'rs-daily' })) n.close();
    const at = nextReminderAt(new Date(), r.time);
    const iso = dstr(at);
    if (!reminderDue(iso)) return;            // tomorrow is a rest day — nothing to nudge about
    const day = dayFor(iso);
    await reg.showNotification('RunStrong', {
      tag: 'rs-daily', body: `${day.title} today.`, icon: './icons/icon-192.png',
      showTrigger: new TimestampTrigger(at.getTime()),
    });
  } catch (e) { /* unsupported or blocked — the Home nudge covers it */ }
}
/* The other half of the new-block moment: a notification on the Monday it
   starts. Same honest limits as the daily reminder — no push server, so
   this only fires where Notification Triggers exist, and the Home card is
   the mechanism that actually works. Deliberately tied to the reminder
   toggle rather than given its own switch: someone who turned daily
   nudges off has said what they want, and one more setting to find is not
   the answer. Four notifications a year at most. */
function nextBlockMonday(fromISO) {
  const m = mesoFor(fromISO);
  return dadd(m.start, HYPER_MESO_WEEKS * 7);
}
async function scheduleBlockNotice() {
  const r = ST.settings.reminder;
  if (!r || !r.on || !hyperLive() || !reminderCanSchedule() || Notification.permission !== 'granted') return;
  try {
    const reg = await navigator.serviceWorker.ready;
    for (const x of await reg.getNotifications({ includeTriggered: true, tag: 'rs-block' })) x.close();
    const iso = nextBlockMonday(today());
    const [y, mo, d] = iso.split('-').map(Number);
    const [hh, mm] = String(r.time || '17:30').split(':').map(Number);
    const at = new Date(y, mo - 1, d, hh || 0, mm || 0, 0, 0);
    if (at <= new Date()) return;
    const style = repStyleFor(mesoAnchor(ST.maintenance), iso);
    await reg.showNotification('RunStrong — new block', {
      tag: 'rs-block', icon: './icons/icon-192.png',
      body: `${style.name} block starts today. New exercises to pick, and the last four weeks are in.`,
      showTrigger: new TimestampTrigger(at.getTime()),
    });
  } catch (e) { /* unsupported or blocked — the Home card covers it */ }
}

/* The weight log is entirely passive — nothing ever asks, so realistically it
   gets used twice and forgotten. The rest day is the one day of the week with
   no session competing for attention, so that is where the ask lives: once a
   week at most, only on a day the plan gave off, and only when the last entry
   is already a week old. Independent of the reminder toggle, because this is
   a card you can ignore rather than a notification that interrupts. */
function weightNudgeCard() {
  const t = today();
  const day = dayFor(t);
  if (!day || day.kind !== 'rest') return '';
  const since = daysSinceWeight(ST.weights, t);
  if (since != null && since < 7) return '';
  return `<div class="card"><div class="card-kicker">⚖️ Rest day</div>
    <div class="card-sub">${since == null
      ? 'Tracking your weight is optional — one number, once a week, if you want the trend.'
      : `Last weighed ${since} day${since === 1 ? '' : 's'} ago.`}</div>
    <button class="btn" onclick="openWeightLog()">Log weight</button></div>`;
}

/* The fallback: a card on Home when the app is opened past the reminder time
   on a training day that hasn't been logged. */
function reminderCard() {
  const r = ST.settings.reminder;
  if (!r || !r.on) return '';
  const t = today();
  if (!reminderDue(t)) return '';
  const [h, m] = String(r.time || '17:30').split(':').map(Number);
  const now = new Date();
  if (now.getHours() * 60 + now.getMinutes() < (h || 0) * 60 + (m || 0)) return '';
  const day = dayFor(t);
  return `<div class="card"><div class="card-kicker">⏰ Reminder</div>
    <div class="card-sub">${esc(day.title)} is still on today's plan. Twenty minutes counts — so does deciding not to.</div></div>`;
}

/* =====================================================================
   RESCUING A MISSED SESSION (v71)
   =====================================================================
   See the pure half in program.js. This is the part that reads ST: which
   lift days just went unlogged, where one could go, and the dismissal
   that stops the card asking twice about the same day.

   Deliberately an offer and not an automatic reshuffle. The plan moving
   itself while you were not looking is worse than the session being
   missed — and sometimes a missed session is just a missed session, which
   is what 'Let it go' is for. */
function loggedOn(date) {
  return !!(ST.sessions[date] && ST.sessions[date].status === 'done')
    || !!mergedRunFor(date) || !!cardioFor(date) || routineDone(date, 'stretch');
}
function rescueOffer() {
  if (ST.maintenance.active) return null;
  const t = today();
  const wk = weekFor(t);
  if (!wk) return null;
  ST.rescueDismissed = ST.rescueDismissed || {};
  /* Only within this week: a lift missed last Thursday has been overtaken
     by a whole week of its own sessions, and shovelling it into next
     Sunday is how a plan turns into a backlog. */
  /* ONE RESCUE A WEEK. Found by driving it: rescue Tuesday into Wednesday
     and the card immediately came back offering to put Monday into Sunday,
     which would have produced a seven-lift week with one run in it — the
     backlog this is supposed to prevent, assembled two taps at a time.
     A week that lost two sessions has lost them; the honest move is to
     save one and let the other go. */
  if (wk.days.some(d => d.moved)) return null;
  const missed = missedLifts(wk.days, t, d => !!(ST.sessions[d] && ST.sessions[d].status === 'done'))
    .filter(d => !ST.rescueDismissed[d.date]);
  if (!missed.length) return null;
  const from = missed[missed.length - 1];          // the most recent one
  const to = rescueTarget(wk.days, t, loggedOn);
  if (!to) return null;
  const warnings = swapWarnings(rescueWeek(wk.days, from.date, to.date));
  return { from, to, warnings };
}
function rescueCard() {
  const r = rescueOffer();
  if (!r) return '';
  const when = r.to.date === today() ? 'today' : fmtDate(r.to.date);
  return `<div class="card rescue">
    <div class="card-kicker">↩️ Missed session</div>
    <div class="card-title">${esc(r.from.title)} didn't happen on ${fmtDate(r.from.date)}</div>
    <div class="card-sub">There's room ${when} — it's ${esc((r.to.title || r.to.kind).toLowerCase())} at the moment, and that would come off the plan.</div>
    ${r.warnings.length ? `<div class="card-sub dim">⚠️ ${esc(r.warnings[0])}</div>` : ''}
    <button class="btn primary big" onclick="doRescue('${r.from.date}','${r.to.date}')">Move it to ${when}</button>
    <button class="mini" onclick="dismissRescue('${r.from.date}')">Let it go</button></div>`;
}
window.doRescue = function (fromISO, toISO) {
  const wk = weekFor(today());
  const from = wk && wk.days.find(d => d.date === fromISO);
  if (!from) return;
  /* A one-way move, not a swap: the missed day keeps the plan it had,
     because that is the day that was missed and rewriting history helps
     nobody. Only the target date gets an override. */
  const plan = { ...from }; delete plan.date;
  ST.planOverrides = ST.planOverrides || {};
  ST.planOverrides[toISO] = { ...plan, date: toISO, moved: fromISO, sub: `Moved from ${fmtDate(fromISO)}.` };
  ST.rescueDismissed = ST.rescueDismissed || {};
  ST.rescueDismissed[fromISO] = true;
  save(); invalidatePlan(); render();
  if (typeof toast === 'function') toast('Moved ✓');
};
window.dismissRescue = function (dateISO) {
  ST.rescueDismissed = ST.rescueDismissed || {};
  ST.rescueDismissed[dateISO] = true;
  save(); render();
};

/* =====================================================================
   THE NEW-BLOCK MOMENT (v70)
   =====================================================================
   Every four weeks the rotation changed the exercises and the ramp reset,
   and none of it was visible: the athlete opened the app on a Monday and
   the session was quietly different. That is a training system working and
   an experience of nothing happening, which over thirty weeks is the
   problem this release is about.

   So the boundary gets a moment, and it does two jobs at once rather than
   two cards doing one each: here is what the last four weeks actually
   produced, and here is the choice for the next four. The review answers
   'is this working' at the point the honest answer stops being 'look at
   the bar going up', and the pick turns a substitution that was already
   happening into a decision the athlete made.

   Shown once per mesocycle and acknowledged, not nagged: ST.blockSeen is
   the last index dismissed. No claim is made that either half grows more
   muscle. Neither does. */
function hyperLive() {
  return !ST.maintenance.active && today() >= HYPER_START;
}
/* The mesocycle a date falls in, with its window and its rep style. */
function mesoFor(dateISO) {
  const anchor = mesoAnchor(ST.maintenance);
  const idx = mesoIndex(anchor, dateISO);
  const start = dadd(anchor, idx * HYPER_MESO_WEEKS * 7);
  return { idx, anchor, start, end: dadd(start, HYPER_MESO_WEEKS * 7 - 1), style: repStyleFor(anchor, dateISO) };
}
/* What a mesocycle produced. Read from what was LOGGED, never from what was
   planned — the same convention setsByMuscle() has always used, and the
   only one that can honestly be shown back to someone as their own work. */
function blockReview(m) {
  const all = Object.values(ST.sessions);
  const done = all.filter(x => x.status === 'done' && x.date >= m.start && x.date <= m.end);
  const planned = planWeeks().filter(w => w.monday >= m.start && w.monday <= m.end)
    .reduce((a, w) => a + w.days.filter(d => d.kind === 'lift' && !d.optional).length, 0);
  let sets = 0, kg = 0;
  for (const x of done) for (const e of x.exercises) for (const t of (e.sets || [])) {
    if (!t.done) continue;
    sets++;
    if (t.weight > 0 && t.reps > 0) kg += t.weight * t.reps;
  }
  const inWin = d => d && d >= m.start && d <= m.end;
  const prs = (() => { try { return liftPRBook(); } catch (e) { return []; } })()
    .filter(p => inWin(p.wDate) || inWin(p.eDate)).map(p => p.name);
  const km = Object.entries(mergedRunsAll()).filter(([d]) => d >= m.start && d <= m.end)
    .reduce((a, [, r]) => a + (r.km || 0), 0);
  return { sessions: done.length, planned, sets, tonnes: kg / 1000, prs, km, tests: benchmarkRows() };
}
/* Every benchmark ever logged, newest first per lift, with the movement
   against the first test. Empty until a benchmark has actually been done,
   and it renders nothing rather than an empty chart in that case. */
function benchmarkRows() {
  const out = [];
  for (const [exId] of (TEMPLATES.hypBench || { items: [] }).items) {
    const h = exHistory(exId).map(e => {
      const best = (e.sets || []).filter(x => x.reps > 0).reduce((a, b) => (!a || b.reps > a.reps ? b : a), null);
      return best ? { date: e.date, reps: best.reps, weight: best.weight } : null;
    }).filter(Boolean);
    if (!h.length) continue;
    const first = h[0], last = h[h.length - 1];
    out.push({ exId, name: EXERCISES[exId].name, n: h.length, first, last, delta: last.reps - first.reps, hist: h });
  }
  return out;
}
/* Which rotating slots this block resolves, and what else was available.
   Grouped by session because 'chest accessory' means nothing on its own and
   'Push · Chest' is how the athlete thinks about it. */
function blockSlots(m) {
  const out = [];
  for (const tp of HYPER_ORDER) {
    const pools = (TEMPLATES[tp] || { items: [] }).items.map(([id]) => String(id))
      .filter(id => id.startsWith('ROTATE:')).map(id => id.slice(7));
    if (!pools.length) continue;
    out.push({
      tpl: tp, title: TEMPLATES[tp].title,
      slots: pools.map(p => ({
        pool: p, label: HYPER_POOL_LABEL[p],
        cur: hyperExId(HYPER_POOLS[p], m.anchor, m.start, null, ST.picks, p),
        options: HYPER_POOLS[p],
        picked: !!((ST.picks[m.idx] || {})[p]),
      })),
    });
  }
  return out;
}
function blockMomentCard() {
  if (!hyperLive()) return '';
  const m = mesoFor(today());
  if (ST.blockSeen != null && ST.blockSeen >= m.idx) return '';
  const prev = m.idx > 0 ? blockReview(mesoFor(dadd(m.start, -1))) : null;
  const adherence = prev && prev.planned ? Math.round(100 * prev.sessions / prev.planned) : null;
  const look = prev && prev.sessions ? [
    `<div class="sumrow"><b>Sessions</b><span>${prev.sessions} of ${prev.planned}${adherence != null ? ` · ${adherence}%` : ''}</span></div>`,
    `<div class="sumrow"><b>Hard sets</b><span>${prev.sets}</span></div>`,
    prev.tonnes >= 0.1 ? `<div class="sumrow"><b>Moved</b><span>${prev.tonnes.toFixed(1)} tonnes</span></div>` : '',
    prev.km >= 1 ? `<div class="sumrow"><b>Ran</b><span>${Math.round(prev.km)} km</span></div>` : '',
    prev.prs.length ? `<div class="sumrow"><b>PRs</b><span>${esc(prev.prs.slice(0, 4).join(', '))}${prev.prs.length > 4 ? ` +${prev.prs.length - 4} more` : ''}</span></div>` : '',
  ].filter(Boolean).join('') : '';
  const tests = (prev ? prev.tests : []).filter(t => t.n >= 2).map(t =>
    `<div class="sumrow"><b>${esc(t.name)}</b><span>${t.last.reps} reps${t.delta ? ` (${t.delta > 0 ? '+' : ''}${t.delta} since your first test)` : ''}</span></div>`).join('');
  return `<div class="card action blockmoment">
    <div class="card-kicker">🔄 Block ${m.idx + 1} starts</div>
    <div class="card-title">${esc(m.style.name)} — new exercises, new rep range</div>
    <div class="card-sub">${esc(m.style.note)}</div>
    ${look ? `<div class="prb-h" style="margin-top:12px">Last four weeks</div>${look}${tests}` : '<div class="card-sub dim">First block — nothing to look back on yet.</div>'}
    <button class="btn primary big" onclick="openBlockPicks()">Choose this block's exercises</button>
    <button class="mini" onclick="ackBlock()">Keep the suggested ones</button></div>`;
}
window.ackBlock = function () { ST.blockSeen = mesoFor(today()).idx; save(); render(); };
window.openBlockPicks = function () {
  const m = mesoFor(today());
  const groups = blockSlots(m).map(g => `<div class="prb-h" style="margin-top:14px">${esc(g.title)}</div>${g.slots.map(sl => `
      <div class="dim small" style="margin:8px 0 4px">${esc(sl.label)}</div>
      <div class="pickrow">${sl.options.map(id => `<button class="pickchip${id === sl.cur ? ' on' : ''}" onclick="setPick('${sl.pool}','${id}')">${esc(EXERCISES[id].name)}</button>`).join('')}</div>`).join('')}`).join('');
  const mo = $('#modal');
  mo.innerHTML = `<div class="sheet"><h2>Block ${m.idx + 1} — your exercises</h2>
    <div class="dim" style="margin-bottom:6px;font-size:.88rem">The app already rotates these every four weeks. Pick the ones you actually want; anything you leave alone stays on the suggestion. Changes apply from your next session.</div>
    <div class="dim" style="margin-bottom:10px;font-size:.88rem">Rep range this block: <b>${esc(m.style.name)}</b> — ${esc(m.style.note)}</div>
    ${groups}
    <button class="btn primary big" style="margin-top:16px" onclick="ackBlock();closeModal()">Done</button>
    <button class="mini" onclick="clearPicks()">Reset to the suggested ones</button></div>`;
  mo.classList.add('open');
};
window.setPick = function (pool, exId) {
  const m = mesoFor(today());
  ST.picks[m.idx] = ST.picks[m.idx] || {};
  ST.picks[m.idx][pool] = exId;
  save(); openBlockPicks();
};
window.clearPicks = function () {
  delete ST.picks[mesoFor(today()).idx];
  save(); openBlockPicks();
};

/* ---------- bodyweight (v43) ----------
   Deliberately plain. The chart leads with the trailing mean because one
   morning's number is mostly water and dinner, and there is no goal line, no
   target band and no copy telling the user whether the number is good — the
   app cannot see what it would need to see to say that. */
function weightChart(series) {
  const W = 340, H = 130, P = 26;
  const vals = series.flatMap(p => [p.kg, p.avg]);
  const min = Math.min(...vals) - 1, max = Math.max(...vals) + 1;
  const x = i => P + (W - 2 * P) * (series.length === 1 ? .5 : i / (series.length - 1));
  const y = v => H - P - (H - 2 * P) * (v - min) / (max - min || 1);
  const path = series.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(p.avg).toFixed(1)}`).join(' ');
  const dots = series.map((p, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(p.kg).toFixed(1)}" r="2.6" fill="var(--run)" opacity=".55"/>`).join('');
  return `<div class="chartwrap"><svg viewBox="0 0 ${W} ${H}">
    <text x="${P}" y="13" class="ch-lbl">Weight — line is the ${WEIGHT_AVG_OVER}-entry average, dots are each entry</text>
    <path class="ln2" d="${path}" fill="none"/>${dots}
  </svg></div>`;
}
function secWeight() {
  const series = weightSeries(ST.weights);
  const since = daysSinceWeight(ST.weights, today());
  const btn = `<button class="btn big" onclick="openWeightLog()">⚖️ ${series.length ? 'Log this week\'s weight' : 'Log your weight'}</button>`;
  if (!series.length) {
    return `<div class="section-label">⚖️ Weight</div>
      <div class="card"><div class="dim small">One number a week, if you want it. Nothing is worked out from it — it is here so the trend is visible, not to score you.</div>${btn}</div>`;
  }
  const last = series[series.length - 1];
  const prev = series.length > 1 ? series[series.length - 2] : null;
  const drift = prev ? last.avg - prev.avg : 0;
  return `<div class="section-label">⚖️ Weight</div>
    <div class="card">
      <div class="headline">${last.avg.toFixed(1)} kg <span class="headline-sub">${WEIGHT_AVG_OVER}-entry average</span>${prev ? ` <span class="dim small">${drift >= 0 ? '+' : ''}${drift.toFixed(1)} since last</span>` : ''}</div>
      ${series.length > 1 ? weightChart(series) : `<div class="dim small">One entry so far — the trend needs a few more.</div>`}
      <div class="dim small">Last logged ${fmtDate(last.date)}${since != null && since >= 7 ? ' · due for another whenever suits' : ''}</div>
      ${btn}
    </div>`;
}
window.openWeightLog = function () {
  const d = today();
  const cur = (ST.weights || {})[d];
  const series = weightSeries(ST.weights);
  const start = cur || (series.length ? series[series.length - 1].kg : 75);
  const m = $('#modal');
  m.innerHTML = `<div class="sheet"><h2>⚖️ Weight — ${fmtDate(d)}</h2>
    <div class="dim small" style="margin-bottom:10px">Weekly is plenty. Same time of day is more useful than the exact day.</div>
    <input id="wkg" class="notefield" type="number" inputmode="decimal" step="0.1" min="20" max="400" value="${start}">
    <button class="btn primary big" onclick="saveWeight()">Save</button>
    ${cur ? `<button class="linkbtn" onclick="deleteWeight('${d}')">Delete today's entry</button>` : ''}
    <button class="linkbtn" onclick="closeModal()">Cancel</button></div>`;
  m.classList.add('open');
};
window.saveWeight = function () {
  const v = parseFloat(($('#wkg') || {}).value);
  if (!(v > 20 && v < 400)) { toast('That does not look like a weight in kg.'); return; }
  ST.weights = ST.weights || {};
  ST.weights[today()] = Math.round(v * 10) / 10;
  save(); closeModal(); render();
};
window.deleteWeight = function (d) {
  if (ST.weights) delete ST.weights[d];
  save(); closeModal(); render();
};
function secStrength(load) {
  const safe = (fn, fb) => { try { return fn(); } catch (e) { return fb; } };
  const withHist = Object.keys(EXERCISES).filter(id => exHistory(id).length > 0);
  if (!withHist.length) return `<div class="section-label">🏋️ Strength</div><div class="dim small sec-empty">Your first logged lift starts this section.</div>`;
  const traj = safe(liftTrajectories, []);
  const prsL = safe(liftPRBook, []);
  const movers = traj.slice(0, 3);
  const cur = load.cur ? load.cur.tonnes : 0;
  return `<div class="section-label">🏋️ Strength</div>
    <div class="card">
      <div class="headline">${cur} t <span class="headline-sub">lifted this week</span>${vs(cur, load.prev && load.prev.tonnes, ' t')}</div>
      ${barChart(load.rows, 'tonnes', v => v.toFixed(1))}
      ${movers.length ? `<div class="tj-wrap">${trajBars(movers)}</div><div class="dim small">Estimated 1RM, early sessions vs recent — tap a lift for its chart.</div>` : `<div class="dim small">Log each lift 3+ times and its trajectory appears here.</div>`}
      ${safe(benchmarkBody, '')}
      ${['hypertrophy', 'hyperDeload'].includes(phaseKeyFromLabel((weekFor(today()) || {}).phase)) ? safe(volumeByMuscleBody, '') : ''}
      <details class="disc"><summary>All lifts, PR book ›</summary>
        ${prsL.length ? `<div class="prb-h">🏆 PR book</div>` + prsL.map(p => `<div class="prb-row" role="button" tabindex="0" onclick="go('exdetail',{ex:'${p.exId}',back:'insights'})">
          <span class="prb-name">${esc(p.name)}</span><span class="prb-val">${p.maxW} kg × ${p.wReps}</span>
          <span class="prb-sub">${p.maxE > 0 ? `e1RM ${p.maxE.toFixed(1)} · ${fmtDate(p.eDate)}` : fmtDate(p.wDate)}</span></div>`).join('') : ''}
        ${traj.length > 3 ? `<div class="prb-h" style="margin-top:12px">Every trajectory</div><div class="tj-wrap">${trajBars(traj)}</div>` : ''}
        <div class="prb-h" style="margin-top:12px">Every lift you've logged</div>
        ${withHist.map(id => { const h = exHistory(id); const top = Math.max(...h[h.length - 1].sets.map(t => t.weight || 0));
          return `<button class="exlist-row" onclick="go('exdetail',{ex:'${id}',back:'log'})"><span>${esc(EXERCISES[id].name)}</span><span class="dim">${h.length} session${h.length > 1 ? 's' : ''} · last ${top} kg</span><span>›</span></button>`; }).join('')}
      </details>
    </div>`;
}
/* The benchmark, rendered as the thing it is: one fixed load, one number
   that goes up. It sits inside Strength above the per-muscle volume
   because when the training PRs dry up — which they do, and around the
   third month — this is the progress that is still moving and still real.
   Renders nothing at all until a benchmark has been done: a chart of one
   point, or of none, is worse than the space it takes. */
function benchmarkBody() {
  const rows = benchmarkRows();
  if (!rows.length) {
    const next = (planWeeks().flatMap(w => w.days).find(d => d.tpl === 'hypBench' && d.date >= today()) || {}).date;
    return next ? `<div class="sumrow dim"><b>📊 Benchmark</b><span>First test ${fmtDate(next)} — a fixed-load rep-out you repeat every four weeks.</span></div>` : '';
  }
  const spark = h => {
    if (h.length < 2) return '';
    const max = Math.max(...h.map(p => p.reps)) || 1;
    return `<span class="bmspark">${h.map(p => `<i style="height:${Math.max(8, Math.round(100 * p.reps / max))}%" title="${fmtDate(p.date)}: ${p.reps}"></i>`).join('')}</span>`;
  };
  const body = rows.map(r => `<div class="sumrow">
    <b>${esc(r.name)}</b>
    <span>${r.last.reps} reps${r.last.weight > 0 ? ` @ ${r.last.weight} kg` : ''}${r.n >= 2 ? ` · ${r.delta > 0 ? '+' : ''}${r.delta} vs first test` : ' · baseline set'}</span>
    ${spark(r.hist)}</div>`).join('');
  const next = (planWeeks().flatMap(w => w.days).find(d => d.tpl === 'hypBench' && d.date > today()) || {}).date;
  return `<div class="prb-h" style="margin-top:12px">📊 Benchmark — same load every test, the reps are the score</div>${body}`
    + (next ? `<div class="dim small">Next test ${fmtDate(next)}.</div>` : '');
}
function secRunning(load) {
  const mergedAll = mergedRunsAll();
  const runPts = Object.keys(mergedAll).map(d => {
    const r = mergedAll[d]; const day = dayFor(d);
    const type = day && day.kind === 'race' ? 'race' : runKind(d, r);
    return { date: d, km: r.km, min: r.min, hr: r.hr, feel: r.feel, splits: r.splits || [], type, src: r.src, name: r.name, pace: r.km && r.min ? r.min * 60 / r.km : null };
  }).filter(p => p.pace);
  if (!runPts.length) return `<div class="section-label">🏃 Running</div><div class="dim small sec-empty">Log or sync a run and this section fills in.</div>`;
  const rb = (() => { try { return runBests(); } catch (e) { return null; } })();
  const last = runPts[runPts.length - 1];
  const typeIcon = t => t === 'Hard Run' ? '⚡' : t === 'Long Run' ? '🛣️' : t === 'race' ? '🏁' : '🏃';
  const cur = load.cur ? load.cur.km : 0;
  return `<div class="section-label">🏃 Running</div>
    <div class="card">
      <div class="headline">${cur} km <span class="headline-sub">this week</span>${vs(cur, load.prev && load.prev.km, ' km')}</div>
      ${barChart(load.rows, 'km', v => v.toFixed(0), 'runbar')}
      <div class="sumrow"><span>Last run: ${typeIcon(last.type)} ${fmtDate(last.date)} — ${last.km} km · ${paceStr(last.km, last.min)}${last.feel ? ` · felt ${last.feel}` : ''}</span></div>
      ${rb ? `<div class="sumrow"><span>Longest ${rb.longest.km} km (${fmtDate(rb.longest.date)}) · biggest week ${rb.bigWeek.km} km</span></div>` : ''}
      <details class="disc"><summary>Pace trend, run bests, run log ›</summary>
        <div class="prb-h">Pace trend (min/km — up = faster)</div>
        ${runPaceChart(runPts)}
        ${rb ? `<div class="prb-h" style="margin-top:12px">🏆 Run bests</div>` + rb.buckets.map(b => `<div class="prb-row"><span class="prb-name">${esc(b.label)}</span><span class="prb-val">${b.pace}</span><span class="prb-sub">${b.km} km · ${fmtDate(b.date)}</span></div>`).join('') : ''}
        <div class="prb-h" style="margin-top:12px">Run log</div>
        ${runPts.slice().reverse().map(p => `<div class="sumrow"><b>${typeIcon(p.type)} ${fmtDate(p.date)} — ${esc(p.type === 'race' ? 'RACE' : p.type)}</b>
          <span>${p.km} km · ${p.min} min · ${paceStr(p.km, p.min)}${p.hr ? ` · ${p.hr} bpm` : ''}${p.feel ? ` · felt ${p.feel}` : ''}</span>
          ${p.splits.length ? `<div class="notesum">splits: ${p.splits.map(fmtSplit).join(' · ')}</div>` : ''}</div>`).join('')}
      </details>
    </div>`;
}
function secRecovery(load) {
  const safe = (fn, fb) => { try { return fn(); } catch (e) { return typeof fb === 'function' ? fb(e) : fb; } };
  const es = fitnessEntries();
  const t = today();
  const vo2Dates = Object.keys(ST.fitness.vo2).sort();
  const vo2 = vo2Dates.length ? ST.fitness.vo2[vo2Dates[vo2Dates.length - 1]] : null;
  const vo2Btn = `<button class="mini" style="margin-left:8px" onclick="updateVo2()">VO₂: ${vo2 ?? '—'} ✎</button>`;
  const hrvPts = es.filter(e => e.hrv != null);
  const ef = safe(efVerdict, { ready: false, n: 0, pts: [] });
  const explErr = e => ({ ready: false, line: `This one hit an error (${e.message}) — the rest of the page still works.` });
  const explorers = [
    { icon: '🔻', title: 'Do red days pay off?', s: safe(redDayStory, explErr) },
    { icon: '🔁', title: 'Big weeks → next-week recovery', s: safe(loadHrvLag, explErr) },
    { icon: '🏃', title: 'Do long runs hurt your lifting?', s: safe(runInterference, explErr) },
    { icon: '⚖️', title: 'Same weight, less effort?', s: safe(rpeDrift, explErr) },
  ];
  if (hrvPts.length < 2 && !ef.pts.length) return `<div class="section-label">💓 Recovery ${vo2Btn}</div><div class="dim small sec-empty">Two morning check-ins (HRV + resting HR) start this section. Prompts appear on training days.</div>`;
  const b = hrvBaseline(dadd(t, 1));
  const latest = es[es.length - 1];
  let headline, headSub;
  if (!b.ready) { headline = `${latest && latest.hrv != null ? latest.hrv + ' ms' : '—'}`; headSub = `baseline building · ${Math.min(b.n ?? es.length, 5)} of 5 mornings`; }
  else {
    const dev = latest.hrv - b.mean;
    headline = `${latest.hrv} ms`;
    headSub = Math.abs(dev) <= Math.max(0.75 * b.sd, 4) ? `HRV in your normal range (baseline ${b.mean.toFixed(0)})` : dev > 0 ? `HRV above baseline (+${dev.toFixed(0)})` : `HRV below baseline (${dev.toFixed(0)})`;
  }
  const lines = [];
  const dip = recoveryDip();
  if (dip) lines.push(`⚠ ${dip} — worth an easier day; your call.`);
  const ramp = loadRampFlag();
  if (ramp) lines.push(`⚠ ${ramp}`);
  if (ef.ready) lines.push(`🫀 ${ef.line}`);
  const loadLine = load.rows.filter(w => w.km + w.tonnes > 0).slice(-3).map(w => `W${w.wk}: ${w.km} km + ${w.tonnes} t`).join(' · ');
  return `<div class="section-label">💓 Recovery ${vo2Btn}</div>
    <div class="card">
      <div class="headline">${headline} <span class="headline-sub">${esc(headSub)}</span></div>
      ${hrvChart(es, t)}
      ${lines.slice(0, 3).map(l => `<div class="sumrow"><span style="color:var(--fg)">${l}</span></div>`).join('')}
      <details class="disc"><summary>Aerobic engine, cause & effect ›</summary>
        <div class="prb-h">Aerobic engine</div>
        ${ef.ready ? `${efChart(ef.pts)}<div class="dim small">${esc(ef.line)}</div>` : `<div class="dim small">Needs ${6 - ef.n} more runs with heart rate to read the engine trend (have ${ef.n}).</div>`}
        ${loadLine ? `<div class="prb-h" style="margin-top:12px">Weekly load</div><div class="dim small">${loadLine}</div>` : ''}
        <div class="prb-h" style="margin-top:12px">Cause & effect</div>
        ${explorers.map(x => `<div class="sumrow ${x.s.ready ? '' : 'dim'}"><b>${x.icon} ${esc(x.title)}</b><span>${esc(x.s.line)}</span></div>`).join('')}
      </details>
    </div>`;
}
function secMilestones() {
  const safe = (fn, fb) => { try { return fn(); } catch (e) { return fb; } };
  /* No race on the calendar since v69, so this renders nothing. Left in place
     rather than deleted: the day a race is added back, the countdown returns
     on its own. */
  const next = RACES.find(r => daysUntil(r.date) >= 0);
  const raceLine = next ? `🏁 ${next.name} in ${daysUntil(next.date)} day${daysUntil(next.date) === 1 ? '' : 's'}` : '';
  const retroReady = RACES.some(r => daysUntil(r.date) < 0) || ST.maintenance.active;
  const hyperReady = today() >= HYPER_START && !ST.maintenance.active;
  return `<div class="section-label">💡 Milestones</div>
    <div class="card insight"><div class="card-kicker">Insight of the week</div><div class="card-sub">${safe(topInsight, 'Insights are having a moment — the rest of the page still works.')}</div>
      ${raceLine ? `<div class="sumrow"><span>${raceLine}</span></div>` : ''}
      ${retroReady || hyperReady || ST.weeklySummaries.length ? `<details class="disc"><summary>Reports and weekly summaries ›</summary>
        ${retroReady ? `<button class="btn big" onclick="showRetro()">📜 Geelong block, in numbers</button>` : ''}
        ${hyperReady ? `<button class="btn big" onclick="showHyperRetro()">🏋️ ${esc(reportBlock(today()).name)}, in numbers</button>` : ''}
        ${ST.weeklySummaries.length ? `<div class="prb-h" style="margin-top:12px">📒 Weekly summaries</div>` + ST.weeklySummaries.slice().reverse().map((s, i) =>
          `<button class="exlist-row" onclick='showWeeklySummary(ST.weeklySummaries[${ST.weeklySummaries.length - 1 - i}], true)'><span>${esc(s.phase)}</span><span class="dim">week of ${fmtDate(s.weekOf)}</span><span>›</span></button>`).join('') : ''}
      </details>` : ''}
    </div>`;
}
function vProgress() {
  const load = recentLoad();
  const key = ST.maintenance.active ? 'maint' : phaseKeyFromLabel((weekFor(today()) || {}).phase);
  const liftFirst = key === 'hypertrophy' || key === 'hyperDeload' || key === 'maint';
  const first = liftFirst ? [secStrength(load), secRunning(load)] : [secRunning(load), secStrength(load)];
  const safe = (fn, fb) => { try { return fn(); } catch (e) { return fb; } };
  return `<header class="top"><h1 class="phase">Progress</h1><div class="dim small">${esc(phaseLabel(today()))}</div></header>
  <main>${first.join('')}${safe(secWeight, '')}${secRecovery(load)}${secMilestones()}</main>${navBar()}`;
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
  const backBtn = view.back === 'daypreview'
    ? `<button class="backbtn" aria-label="Back" onclick="go('daypreview',{tpl:'${view.tpl}',date:'${view.date}'})">‹</button>`
    : `<button class="backbtn" aria-label="Back to Progress" onclick="setProgressTab('${backTab}')">‹</button>`;
  return `<header class="top slim">${backBtn}<h1 class="phase">${esc(ex.name)}</h1></header>
  <main>
    ${ex.steps ? `<div class="card"><div class="card-kicker">📋 How to</div>
      <ol class="ex-steps" style="color:var(--fg)">${ex.steps.map(s => `<li>${esc(s)}</li>`).join('')}</ol></div>` : ''}
    ${ex.why ? `<div class="card"><div class="card-kicker">🎯 ${whyLabel(view.date)}</div>
      <div class="card-sub" style="color:var(--fg)">${esc(ex.why)}</div>
      ${ex.deep ? `<div class="card-sub" style="margin-top:8px">${esc(ex.deep)}</div>` : ''}</div>` : ''}
    ${svgChart(pts)}
    ${h.slice().reverse().map(s => `<div class="sumrow"><b>${fmtDate(s.date)}</b><span>${s.sets.map(t => setStr(ex, t)).join(' · ')}</span>
      ${s.sets.filter(t => t.note).map(t => `<div class="notesum">📝 ${esc(t.note)}</div>`).join('')}</div>`).join('')}
  </main>${navBar()}`;
}

function vDayPreview() {
  const tplId = view.tpl;
  const date = view.date || today();
  const tpl = matTpl(tplId, date);
  if (!tpl) return vSchedule();
  return `<header class="top slim"><button class="backbtn" aria-label="Back to Plan" onclick="go('schedule')">‹</button><h1 class="phase">${esc(tpl.title)}</h1></header>
  <main>
    <div class="dim small" style="margin:-4px 0 14px">~${tpl.est} min · ${tpl.items.length} exercise${tpl.items.length === 1 ? '' : 's'}</div>
    ${tpl.style && tpl.style.delta ? `<div class="card-sub" style="margin:-8px 0 14px"><b>${esc(tpl.style.name)} block</b> — ${esc(tpl.style.note)}</div>` : ''}
    ${tpl.items.map(([exId, sets, reps]) => {
      const ex = EXERCISES[exId];
      const unit = ex.mode === 'time' ? 's' : ex.mode === 'carry' ? 'm' : '';
      const perSide = ex.perSide ? '/side' : '';
      return `<button class="exlist-row" onclick="go('exdetail',{ex:'${exId}',back:'daypreview',tpl:'${tplId}',date:'${date}'})"><span>${esc(ex.name)}</span><span class="dim">${sets} × ${reps}${unit}${perSide}</span><span>›</span></button>`;
    }).join('')}
  </main>${navBar()}`;
}

/* ================= Sunday weekly summary ================= */
function buildWeeklySummary(monday) {
  const sunday = dadd(monday, 6);
  const wk = planWeeks().find(w => w.days[0].date === monday) || weekFor(monday);
  const inWeek = d => d >= monday && d <= sunday;
  const doneSessions = Object.values(ST.sessions).filter(s => s.status === 'done' && inWeek(s.date));
  const planned = ST.maintenance.active ? 3 : wk ? wk.days.filter(d => d.kind === 'lift' && !d.optional).length : 4;
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
  const nextWk = wk ? planWeeks().find(w => w.num === wk.num + 1) : null;
  const race = nextRace();
  const raceDays = daysUntil(race.date);
  const PHASE_FOCUS = {
    'Intro': 'settling into the pattern', 'Build': 'the heaviest work of the block lives here',
    'Build — peak load': 'the peak — after this it only gets lighter',
    'Geelong taper': 'volume drops, intensity stays crisp — race legs loading, that\'s the plan working, not slacking',
    'Recovery week': 'walk, eat, sleep — the race is still in your legs',
    'Hypertrophy — block 1 deload': 'sets halved, loads kept — fatigue out, then block 2',
    'Hypertrophy — block 2 deload': 'sets halved, loads kept — last deload before running comes back',
    'Hypertrophy': '5 lifts, easy cardio on Wednesday, intervals on Sunday, 1 mobility session — loads creep up each week',
    'Transition': 'three lifts, three easy runs — the body relearns running before the build asks anything of it',
    'Base': 'three runs a week again, strides and hills — the aerobic base before the hard work; lifting just holds',
    'Build — strength maintenance': 'tempo and intervals arrive; three short lifts a week hold what the block built',
    'Peak': 'the longest runs of the build — lifting stays maintenance, running is the point',
    'Down week': 'long run drops to ~70%, one lift fewer — absorb the last three weeks',
    'Taper': 'volume keeps dropping while intensity stays crisp — race legs loading',
    'Carman\'s race week': 'almost nothing in the gym: the work is done',
  };
  // longest matching key wins, so 'Hypertrophy — block 1 deload' beats 'Hypertrophy'
  const phaseKey = p => Object.keys(PHASE_FOCUS).sort((a, b) => b.length - a.length).find(k => (p || '').startsWith(k));
  const nextFocus = nextWk ? (PHASE_FOCUS[phaseKey(nextWk.phase)] || nextWk.phase) : 'the calendar ends here — time to plan the next block';
  // a note of yours from the week
  let note = null;
  for (const s of doneSessions) for (const e of s.exercises) for (const t of e.sets) if (t.note && (!note || t.note.length > note.length)) note = t.note;
  for (const d of Object.keys(ST.runs)) if (inWeek(d) && ST.runs[d].note && (!note || ST.runs[d].note.length > note.length)) note = ST.runs[d].note;
  return { weekOf: monday, phase: ST.maintenance.active ? 'Maintenance' : wk ? `Week ${wk.num} — ${wk.phase}` : 'off-plan week',
    nextPhase: ST.maintenance.active ? null : nextWk ? `Week ${nextWk.num} — ${nextWk.phase}` : null,
    nextFocus: ST.maintenance.active ? 'maintenance — 3 workouts a week, your pace' : nextFocus,
    raceWeeks: Math.max(0, Math.ceil(raceDays / 7)), raceName: race.name,
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
      <div class="wksum-li">${sum.phase === 'Maintenance' || !sum.raceWeeks ? '' : `${sum.raceWeeks} week${sum.raceWeeks === 1 ? '' : 's'} to ${esc(sum.raceName || 'the race')}. `}${sum.nextPhase ? `Next: ${esc(sum.nextPhase)} — ${esc(sum.nextFocus)}.` : esc(sum.nextFocus)}</div></div>
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
const HYPER_ANCHORS = ['squat', 'bench', 'rdl', 'pullup', 'ohp', 'bbcurl', 'overheadext'];
function hyperTrajectories() {
  const since = HYPER_START;
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
  return traj.map(x => `<div class="tj-row" role="button" tabindex="0" onclick="go('exdetail',{ex:'${x.exId}',back:'trends'})">
    <div class="tj-name">${esc(x.name)}</div>
    <div class="tj-track"><div class="tj-bar ${x.pct >= 0 ? 'up' : 'down'}" style="width:${Math.min(100, Math.abs(x.pct) / maxAbs * 100)}%"></div></div>
    <div class="tj-pct ${x.pct >= 0 ? 'up' : 'down'}">${x.pct >= 0 ? '+' : ''}${x.pct}%</div>
  </div>`).join('');
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
  /* Reads the run logged on race day rather than a separate result field:
     with the official-time sheet gone, the run log IS the race record. */
  const raceLines = RACES.map(r => {
    const run = merged[r.date];
    if (!run) return `${r.name}: not logged.`;
    const h = Math.floor(run.min / 60), mm = String(Math.round(run.min % 60)).padStart(2, '0');
    return `${r.name}: ${run.km} km in ${h ? h + ':' + mm : run.min + ' min'}${paceStr(run.km, run.min) ? ' · ' + paceStr(run.km, run.min) : ''}${run.feel ? ` — felt ${run.feel}` : ''}.`;
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
/* One entry per HYPER_POOLS key — a missing one renders "undefined: <lift>"
   in the rotation list, so this moves whenever the pools do. */
const HYPER_POOL_LABEL = {
  chestAcc: 'Chest accessory', backAcc: 'Back accessory', bicepsAcc: 'Biceps accessory', tricepsAcc: 'Triceps accessory',
  quadAcc: 'Second quad lift', gluteAcc: 'Glute lift', unilateral: 'Single-leg lift',
  calfStand: 'Straight-knee calf', calfSeat: 'Bent-knee calf', coreAcc: 'Core lift',
  // ---- v70: the slots that used to be frozen ----
  pressAcc: 'Second chest press', tricepsLong: 'Overhead triceps', sideDelt: 'Side delts',
  bicepsLong: 'Stretched curl', rowAcc: 'Heavy row', rearDelt: 'Rear delts',
};
/* Retired pools keep their labels above so an old report still reads; a
   label with no pool is three words, a pool with no label renders
   "undefined" in the block review. This asserts the direction that
   matters. */
for (const p of Object.keys(HYPER_POOLS)) if (!HYPER_POOL_LABEL[p]) HYPER_POOL_LABEL[p] = p;
/* Which block this report is about. Before v41 the function was pinned to the
   nine-week one — HYPER_START, HYPER_WEEKS and HYPER_WEEK were read directly —
   so from 30 Nov it would have shown "week 9 of 9" for the whole summer and
   counted adherence against five templates the user had stopped doing, with
   the sessions they were actually doing absent from the list. */
function reportBlock() {
  return { since: HYPER_START, weeks: BLOCK_WEEKS, name: 'Hypertrophy block' };
}
window.showHyperRetro = function () {
  const t = today();
  const blk = reportBlock(t);
  const since = blk.since;
  const mesoStart = mesoAnchor(ST.maintenance);
  const weeksIn = Math.min(blk.weeks, weeksSince(since, t) + 1);
  const blockNum = Math.floor(weeksSince(mesoStart, t) / HYPER_MESO_WEEKS) + 1;
  const doneSessions = Object.values(ST.sessions).filter(s => s.status === 'done' && s.date >= since);
  const byTpl = {};
  for (const s of doneSessions) byTpl[s.tpl] = (byTpl[s.tpl] || 0) + 1;
  /* Read the templates off the plan itself rather than off a layout constant:
     the summer block's Monday alternates quad-led and hinge-led, so no single
     week's layout is the whole list, and a day-swap should not hide a session
     from its own report. */
  const weekTpls = [...new Set(planWeeks().filter(w => w.monday >= since).flatMap(w => w.days)
    .filter(d => d.kind === 'lift').map(d => d.tpl))];
  const dayLines = weekTpls.map(tp => `${TEMPLATES[tp].title}: ${byTpl[tp] || 0}`);
  const traj = hyperTrajectories();
  const lifters = traj.map(x => `${x.name}: ${x.pct >= 0 ? '+' : ''}${x.pct}% e1RM`);
  const totTon = Math.round(tonnageIn(since, t) / 100) / 10;
  const runsInPhase = Object.keys(mergedRunsAll()).filter(d => d >= since).length;
  /* A run is either its own day or a flag on a lift day (day.run), so both
     count toward what was planned — otherwise the summer block's Tuesday run
     and the hypertrophy block's Sunday run go missing from adherence. */
  const runsPlanned = planWeeks().filter(w => w.monday >= since && w.monday <= t).reduce((a, w) => a + w.days.filter(d => (d.kind === 'run' || d.run) && d.date <= t).length, 0);
  const cardioDays = planWeeks().filter(w => w.monday >= since && w.monday <= t).flatMap(w => w.days).filter(d => d.kind === 'cardio' && d.date <= t);
  const cardioLine = cardioDays.length
    ? `${cardioDays.filter(d => cardioFor(d.date)).length} of ${cardioDays.length} cardio session${cardioDays.length === 1 ? '' : 's'} logged (easy ${cardioDays.filter(d => d.cardio && d.cardio.type === 'easy' && cardioFor(d.date)).length} · intervals ${cardioDays.filter(d => d.cardio && d.cardio.type === 'hiit' && cardioFor(d.date)).length})`
    : 'No cardio days due yet.';
  const mobilityDone = Object.keys(ST.routines || {}).filter(d => d >= since && routineDone(d, 'stretch') && (dayFor(d) || {}).mobility).length;
  const rotation = Object.keys(HYPER_POOLS).map(pool => `${HYPER_POOL_LABEL[pool]}: ${EXERCISES[hyperExId(HYPER_POOLS[pool], mesoStart, t)].name}`);
  /* The block's arc: first four weeks against the last four, per muscle and
     per week. The weekly view answers "did I hit this week"; over a block the
     question people actually care about is "what has changed since I started",
     and nothing in the app answered it. Needs eight weeks of block for the two
     windows not to overlap, so it simply does not render before then. */
  const arc = (() => {
    if (weeksSince(since, t) < 8) return '';
    const all = Object.values(ST.sessions);
    const early = setsByMuscle(all, since, dadd(since, 27));
    const late = setsByMuscle(all, dadd(t, -27), t);
    const muscles = [...new Set([...Object.keys(early), ...Object.keys(late)])]
      .sort((a, b) => (PRIORITY_MUSCLES.includes(b) ? 1 : 0) - (PRIORITY_MUSCLES.includes(a) ? 1 : 0) || (late[b] || 0) - (late[a] || 0));
    if (!muscles.length) return '';
    const rows = muscles.map(m => {
      const e = (early[m] || 0) / 4, l = (late[m] || 0) / 4, d = l - e;
      return `<div class="wksum-li">${PRIORITY_MUSCLES.includes(m) ? '★ ' : ''}${esc(m)}: ${e.toFixed(1)} → ${l.toFixed(1)} sets/wk${Math.abs(d) >= 0.5 ? ` (${d > 0 ? '+' : ''}${d.toFixed(1)})` : ''}</div>`;
    }).join('');
    return `<div class="wksum-sec"><div class="wksum-h">📈 First four weeks → last four</div>${rows}
      <div class="wksum-li dim">Logged sets per week, not prescribed. ★ is what this block is for.</div></div>`;
  })();
  const m = $('#modal');
  m.innerHTML = `<div class="sheet"><h2>🏋️ ${esc(blk.name)}, in numbers</h2>
    <div class="dim small" style="margin-bottom:10px">Week ${weeksIn} of ${blk.weeks} · rotation block ${blockNum} (accessories rotate every ${HYPER_MESO_WEEKS} weeks)</div>
    <div class="wksum-sec"><div class="wksum-h">📅 Sessions this block</div>${dayLines.map(l => `<div class="wksum-li">${esc(l)}</div>`).join('')}</div>
    <div class="wksum-sec"><div class="wksum-h">🏋️ Anchor lifts (est. 1RM change)</div>
      ${lifters.length ? lifters.map(l => `<div class="wksum-li">${esc(l)}</div>`).join('') : '<div class="wksum-li dim">Not enough repeat sessions yet to compare.</div>'}</div>
    ${arc}
    <div class="wksum-sec"><div class="wksum-h">🔄 Currently rotating in</div>${rotation.map(l => `<div class="wksum-li">${esc(l)}</div>`).join('')}</div>
    <div class="wksum-sec"><div class="wksum-h">🚴 Cardio · 🧘 mobility</div><div class="wksum-li">${esc(cardioLine)} · ${mobilityDone} mobility session${mobilityDone === 1 ? '' : 's'} done</div>${runsPlanned || runsInPhase ? `<div class="wksum-li dim">🏃 ${runsInPhase} of ${runsPlanned} planned run${runsPlanned === 1 ? '' : 's'} logged, from before the switch to cardio</div>` : ''}</div>
    <div class="wksum-sec"><div class="wksum-h">📦 Totals</div><div class="wksum-li">${doneSessions.length} gym sessions · ${totTon} t lifted</div></div>
    <button class="btn primary big" onclick="closeModal()">Close</button></div>`;
  m.classList.add('open');
};

/* ================= whole programme (v55) =================
   The Plan tab is a scroll of 36 weeks, one day per row, which answers "what
   is Thursday" and never answers "what am I actually doing between now and
   April". This is the second question: every week on one screen, grouped by
   block, with the shape of the week visible as seven marks rather than seven
   paragraphs. Nothing here is new data — it is planWeeks() read at a
   different altitude. */
function programmeBlocks() {
  return [
    { name: 'Geelong block', until: dadd(HYPER_START, -1), note: 'the six-week build that ended on race day' },
    { name: 'Hypertrophy block', until: '9999-12-31', note: 'Push · Pull · Lower · Upper · Arms + easy cardio and intervals' },
  ];
}
function dayMark(d) {
  if (d.kind === 'race') return { c: 'race', t: '🏁' };
  if (d.kind === 'lift') return { c: d.run ? 'lift run' : 'lift', t: d.run ? '🏋️🏃' : '🏋️' };
  if (d.kind === 'run') return { c: d.mobility ? 'run mob' : 'run', t: d.mobility ? '🏃🧘' : '🏃' };
  if (d.kind === 'cardio') return { c: d.mobility ? 'cardio mob' : 'cardio', t: '🚴' };
  if (d.kind === 'mobility') return { c: 'mob', t: '🧘' };
  return { c: 'rest', t: '·' };
}
function vProgramme() {
  const t = today();
  const weeks = planWeeks();
  const cur = weekFor(t);
  const blocks = programmeBlocks();
  let bi = 0, out = '';
  for (const wk of weeks) {
    while (bi < blocks.length - 1 && wk.monday > blocks[bi].until) bi++;
    const b = blocks[bi];
    if (!b.open) {
      if (bi > 0) out += '</div>';
      const inBlock = weeks.filter(w => w.monday <= b.until && (bi === 0 || w.monday > blocks[bi - 1].until));
      const last = inBlock[inBlock.length - 1];
      out += `<div class="section-label">${esc(b.name)}</div>
        <div class="dim small" style="margin-bottom:6px">${fmtDate(inBlock[0].monday)} → ${fmtDate(last.days[6].date)} · ${inBlock.length} week${inBlock.length === 1 ? '' : 's'} · ${esc(b.note)}</div><div class="pgm">`;
      b.open = true;
    }
    const isCur = cur && wk.num === cur.num;
    const deload = phaseKeyFromLabel(wk.phase) === 'hyperDeload' || /deload|down week/i.test(wk.phase);
    // the block name is already the section heading — don't repeat it per row
    const short = wk.phase.replace(/^(Hypertrophy|Summer)\s*—\s*/i, '').replace(/^post-race\s*/i, '');
    /* Each week opens to its actual sessions. Filled on demand rather than
       up front: eagerly materialising 36 weeks of templates is ~180 sessions
       and a thousand-odd DOM rows for a screen most of which is never opened.
       The current week starts open, because that is the one you came for. */
    out += `<details class="pgm-det"${isCur ? ' open' : ''} ontoggle="fillWeekDetail(this,'${wk.monday}')">
      <summary class="pgm-wk${isCur ? ' cur' : ''}${deload ? ' deload' : ''}">
      <span class="pgm-n">${wk.num}</span>
      <span class="pgm-days">${(() => {
        /* Place each day in its real weekday column rather than in sequence.
           Week 1 of the programme is a partial Thu-Sun intro, and laid out in
           sequence it would put a Thursday under every other week's Monday —
           which breaks the one thing a grid like this is for. */
        const slots = Array(7).fill(null);
        for (const d of wk.days) slots[(new Date(d.date + 'T00:00:00').getDay() + 6) % 7] = d;
        return slots.map(d => {
          if (!d) return '<i class="pgm-d empty"></i>';
          const m = dayMark(d);
          const done = (ST.sessions[d.date] && ST.sessions[d.date].status === 'done') || !!cardioFor(d.date);
          /* v72: the glyph is the ONLY encoding of what each day is, and an
             emoji inside an <i> has no accessible name — a screen reader
             reads it as whatever Unicode happens to call the character, or
             skips it. `title` gave a hover tooltip, which is no use on a
             phone and is not reliably announced. role="img" plus aria-label
             gives it the name the sighted user gets from the shape. */
          const label = `${fmtDate(d.date)} — ${d.title || 'Rest'}${done ? ' (logged)' : ''}`;
          return `<i class="pgm-d ${m.c}${done ? ' done' : ''}${d.date === t ? ' today' : ''}" role="img" aria-label="${esc(label)}" title="${esc(label)}">${m.t}</i>`;
        }).join('');
      })()}</span>
      <span class="pgm-ph">${esc(short)}</span>
      </summary><div class="pgm-body"></div>
    </details>`;
  }
  out += '</div>';
  return `<header class="top"><h1 class="phase">Whole programme</h1>
    <div class="dim small">${weeks.length} weeks · ${fmtDate(weeks[0].monday)} → ${fmtDate(weeks[weeks.length - 1].days[6].date)}. Mon→Sun left to right; a filled mark is a session you logged.</div></header>
  <main>${out}
    <div class="dim small" style="margin-top:14px">🏋️ lift · 🏋️🏃 lift + run · 🏃 run · 🏃🧘 run + mobility · 🧘 mobility · 🏁 race · · rest. Shaded rows are deload weeks.</div>
  </main>${navBar()}`;
}

/* The sessions of one week, written out in full. Reads the same
   materializeTemplate() the session itself will run, so the ramp, the deload
   and whichever accessory is rotating in that mesocycle are all reflected —
   this is the actual prescription for that date, not a template sketch. */
function weekDetailHTML(monday) {
  const wk = planWeeks().find(w => w.monday === monday);
  if (!wk) return '';
  const meso = mesoAnchor(ST.maintenance);
  const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  return wk.days.map(d => {
    const dow = DOW[(new Date(d.date + 'T00:00:00').getDay() + 6) % 7];
    if (d.kind !== 'lift') {
      return `<div class="pgm-day"><b>${dow}</b> <span>${esc(d.title || 'Rest')}</span>
        ${d.sub ? `<div class="dim small">${esc(d.sub)}</div>` : ''}</div>`;
    }
    const tpl = matTpl(d.tpl, d.date);
    const rows = tpl.items.map(([id, sets, reps]) => {
      const ex = EXERCISES[id];
      const unit = ex.mode === 'time' ? 's' : ex.mode === 'carry' ? 'm' : '';
      return `<div class="pgm-ex"><span>${esc(ex.name)}</span><span class="dim">${sets} × ${reps}${unit}${ex.perSide ? '/side' : ''}${ex.rpe ? ` · RPE ${ex.rpe[0] === ex.rpe[1] ? ex.rpe[0] : ex.rpe.join('–')}` : ''}</span></div>`;
    }).join('');
    return `<div class="pgm-day"><b>${dow}</b> <span>${esc(tpl.title)}</span>
      <span class="dim small">~${TEMPLATES[d.tpl].est} min${d.run ? ` · + ${esc(d.runSub || 'run')}` : ''}</span>
      ${rows}</div>`;
  }).join('');
}
window.fillWeekDetail = function (el, monday) {
  if (!el.open || el.dataset.filled) return;
  const box = el.querySelector('.pgm-body');
  if (box) box.innerHTML = weekDetailHTML(monday);
  el.dataset.filled = '1';
};

/* ================= exercise catalogue (v53) =================
   753 strength/plyo/olympic entries from free-exercise-db (Unlicense, public
   domain), trimmed to name, equipment, muscle tags and the step-by-step
   instructions, with its muscle vocabulary mapped onto MUSCLE_MAP's.

   It is a REFERENCE, not a programme source, and the distinction is the whole
   design. The dataset carries no rest periods and no RPE targets, and
   nextPrescription() has nothing to autoregulate without them — so a
   catalogue entry cannot be scheduled or progressed. What it is good for is
   the moment the rack is taken and you need to know what else trains the same
   thing, which is a question this app could not answer until now.

   Loaded on demand rather than bundled: 637 KB has no business in the startup
   path of an app whose job is to show you today's session. Once fetched the
   service worker has it, so it works offline from then on. */
let CATALOGUE = null, catQuery = '';
async function loadCatalogue() {
  if (CATALOGUE) return;
  try {
    const r = await fetch('assets/exercise-catalogue.json');
    CATALOGUE = await r.json();
  } catch (e) {
    CATALOGUE = [];
    toast('Could not load the exercise library — it needs one online visit first.');
  }
  if (view.v === 'catalogue') renderCatalogueResults();
}
/* Names already in the curated library, normalised, so the programme's own
   exercises are marked rather than looking like just another search hit. */
function curatedNames() {
  const set = new Set();
  for (const id of Object.keys(EXERCISES)) set.add(EXERCISES[id].name.toLowerCase().replace(/[^a-z]/g, ''));
  return set;
}
function vCatalogue() {
  if (!CATALOGUE) loadCatalogue();
  return `<header class="top"><h1 class="phase">Exercise library</h1>
    <div class="dim small">Every exercise, searchable. The ones in your programme are marked ★ — the rest are reference, since they carry no rest or RPE targets to progress from.</div></header>
  <main>
    <input id="catq" class="notefield" type="search" placeholder="Search name, muscle or equipment" oninput="renderCatalogueResults()" value="${esc(catQuery)}">
    <div id="catres">${CATALOGUE ? '' : '<div class="dim small">Loading the library…</div>'}</div>
  </main>${navBar()}`;
}
window.renderCatalogueResults = function () {
  const box = $('#catres'); if (!box) return;
  const inp = $('#catq'); catQuery = inp ? inp.value : catQuery;
  if (!CATALOGUE) { box.innerHTML = '<div class="dim small">Loading the library…</div>'; return; }
  const q = catQuery.trim().toLowerCase();
  const hit = e => !q || e.n.toLowerCase().includes(q) || e.eq.toLowerCase().includes(q)
    || e.m.some(m => m.includes(q)) || e.s.some(m => m.includes(q));
  const all = CATALOGUE.filter(hit);
  const cur = curatedNames();
  const isCur = e => cur.has(e.n.toLowerCase().replace(/[^a-z]/g, ''));
  // programme exercises first — when you are looking for an alternative, what
  // you already have a history for is the most useful answer
  all.sort((a, b) => (isCur(b) ? 1 : 0) - (isCur(a) ? 1 : 0) || a.n.localeCompare(b.n));
  const shown = all.slice(0, 60);
  box.innerHTML = `<div class="dim small" style="margin:8px 0">${all.length} exercise${all.length === 1 ? '' : 's'}${all.length > shown.length ? ` · showing the first ${shown.length}` : ''}</div>`
    + shown.map(e => `<details class="disc"><summary>${isCur(e) ? '★ ' : ''}${esc(e.n)}</summary>
        <div class="dim small">${esc([e.m.join(', '), e.eq, e.mech, e.lvl].filter(Boolean).join(' · '))}${e.s.length ? ` · also ${esc(e.s.join(', '))}` : ''}</div>
        ${e.steps.length ? '<ol class="howto">' + e.steps.map(s => `<li>${esc(s)}</li>`).join('') + '</ol>' : '<div class="dim small">No instructions in the source data.</div>'}
      </details>`).join('')
    + (all.length ? '' : '<div class="dim small">Nothing matches that.</div>');
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
    <div class="set-row"><span>Daily reminder</span>${toggleBtn(ST.settings.reminder.on, "toggleReminder()")}</div>
    ${ST.settings.reminder.on ? `<div class="set-row"><span>Remind me at</span>
      <input type="time" value="${esc(ST.settings.reminder.time)}" onchange="ST.settings.reminder.time=this.value;save();scheduleReminder();scheduleBlockNotice();render()"></div>` : ''}
    <div class="dim small" style="margin-bottom:8px">A nudge on training days only — never on a rest day, and never once the session is logged.${ST.settings.reminder.on && !reminderCanSchedule() ? ' <b>Your browser can\'t schedule notifications in the background</b>, so this shows as a prompt on the Home tab when you next open the app instead. Adding RunStrong to your home screen makes that more reliable.' : ''}</div>
    <div class="section-label">Exercise library</div>
    <div class="dim small" style="margin-bottom:8px">753 exercises from the public-domain free-exercise-db, searchable by name, muscle or equipment — for when the rack is taken and you need to know what else trains the same thing.</div>
    <button class="btn big" onclick="go('catalogue')">📖 Browse the exercise library</button>
    <div class="section-label">Equipment on hand</div>
    <div class="dim small" style="margin-bottom:8px">Turn off anything you don't have — the ⇄ swap-exercise list in a workout ranks compatible variants first.</div>
    ${EQUIP_KEYS.map(k => `<div class="set-row"><span>${esc(EQUIP_LABEL[k])}</span>${toggleBtn(ST.settings.equip[k], `ST.settings.equip['${k}']=!ST.settings.equip['${k}'];save();render()`)}</div>`).join('')}
    <div class="section-label">Mode</div>
    ${ST.maintenance.active
      ? `<div class="dim small" style="margin-bottom:8px">Maintenance mode is on${ST.maintenance.startedOn ? ' (since ' + fmtDate(ST.maintenance.startedOn) + ')' : ''}: 3 flexible gym workouts a week, no calendar, no race clock.</div>
         <button class="btn big" onclick="if(confirm('Back to the calendar? Today\\'s plan takes over from the flexible workouts.')){ST.maintenance={active:false,startedOn:null,program:'balanced',mesoStart:null};save();render();}">Back to the calendar</button>`
      : `<div class="dim small" style="margin-bottom:8px">The calendar runs the Geelong race block, then one continuous hypertrophy block (${fmtDate(HYPER_START)} → ${fmtDate(dadd(HYPER_START, BLOCK_WEEKS * 7 - 1))}). Today: ${esc(phaseLabel(today()))}.</div>
         <button class="btn big" onclick="if(confirm('Switch to maintenance mode? The calendar is replaced by 3 flexible workouts a week. You can switch back here any time.'))startMaintenance('balanced')">Switch to 3 flexible workouts (no calendar)</button>`}
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
  // cardio (v75): exercise carries the machine and minutes/HR, rpe column = RPE
  for (const d of Object.keys(ST.cardio || {}).sort()) {
    const c = ST.cardio[d], day = dayFor(d), cd = (day && day.cardio) || {};
    const what = cd.machine ? `${cd.machine} — ${cd.main}` : 'Cardio';
    if (c.skipped) { rows.push([d, 'Cardio', `${what} (skipped)`, 1, '', '', '', '', '']); continue; }
    rows.push([d, 'Cardio', `${what} (${c.min} min${c.hr ? ', ' + c.hr + ' bpm' : ''})`.replace(/"/g, '""'), 1, '', '', c.rpe ?? '', '', (c.note || '').replace(/"/g, '""')]);
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
/* Keyboard activation for the handful of tap targets that are <div onclick>
   rather than <button> (v51, clearing the last of the audit's accessibility
   batch). They stay divs deliberately: two of them are cards that contain
   their own nested control, and a <button> inside a <button> is invalid HTML
   that browsers recover from unpredictably. role="button" + tabindex makes
   them reachable and announced correctly; this makes Enter and Space actually
   fire them, which is the half that assistive tech users would otherwise be
   missing. Space is prevented from scrolling the page, as a real button does. */
document.addEventListener('keydown', e => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const el = e.target;
  if (!el || !el.getAttribute || el.getAttribute('role') !== 'button') return;
  if (e.key === ' ') e.preventDefault();
  el.click();
});

if ('serviceWorker' in navigator) {
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('sw.js').then(r => { swReg = r; r.update().catch(() => {}); scheduleReminder(); scheduleBlockNotice(); }).catch(() => {});
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) return; // first install, not an update
    if (document.getElementById('updatebar')) return;
    /* Apply the update ourselves when nothing is in flight (v59). The banner
       was the whole mechanism before, and an update that needs a tap is one
       plenty of people never take — an installed PWA can sit on a months-old
       version indefinitely while its owner assumes it is current.
       "Nothing in flight" is meant strictly: never during an active workout,
       never with a sheet open, never while a field has focus. Reloading out
       from under someone mid-set reads as data loss even though every set is
       already saved. In any of those cases the banner appears exactly as
       before and they choose the moment.
       The sessionStorage flag makes this at most one reload per tab, so a
       misbehaving update can never put the app in a reload loop. */
    const s = ST.activeSessionId && ST.sessions[ST.activeSessionId];
    const modal = document.getElementById('modal');
    const el = document.activeElement;
    const busy = (s && s.status === 'active')
      || (modal && modal.classList.contains('open'))
      || (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
    let reloadedAlready = false;
    try { reloadedAlready = !!sessionStorage.getItem('rs-swreload'); } catch (e) {}
    if (!busy && !reloadedAlready) {
      try { sessionStorage.setItem('rs-swreload', '1'); } catch (e) {}
      location.reload();
      return;
    }
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
/* Launch used to begin by handling a Strava OAuth callback and kicking off a
   background sync. With the integration gone there is nothing to await, so
   this runs directly. */
if (!maybeWeeklySummary()) {       // Sunday-evening (or later) week in review takes the stage first
  if (checkInDue()) openCheckIn(); // morning HRV check-in is the only thing that still opens on launch
}
