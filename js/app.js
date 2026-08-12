/* RunStrong — app logic */
'use strict';

/* ================= state & storage ================= */
const DB_KEY = 'runstrong.db';
const SCHEMA_VERSION = 3;

function defaultState() {
  return {
    schemaVersion: SCHEMA_VERSION,
    settings: { step: 2.5, sound: true, vibrate: true, seenInstall: false, seenWhy: false },
    program: buildProgram(),
    sessions: {},          // sessionId (== date) → session record
    runs: {},              // date → {km, min, feel, note}
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

/* ================= sessions ================= */
function buildSession(date, tplId, downgraded) {
  const tpl = TEMPLATES[tplId];
  const exercises = tpl.items.map(([exId, sets, reps]) => {
    const n = downgraded ? Math.max(1, sets - 1) : sets;
    const presc = nextPrescription(exId, exHistory(exId, date), ST.settings.step);
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
  const presc = nextPrescription(newExId, exHistory(newExId, sess.date), ST.settings.step);
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
  if (!signals.length) return null;
  return 'Fatigue is stacking up: ' + signals.join(', ') + '. Consider the downgraded version of your next session — running comes first.';
}

/* ================= rendering ================= */
const APP = $('#app');
let view = { name: 'home' };

function go(name, params) { view = Object.assign({ name }, params); render(); window.scrollTo(0, 0); }

function render() {
  const views = { home: vHome, schedule: vSchedule, session: vSession, summary: vSummary, history: vHistory, exdetail: vExDetail, settings: vSettings };
  APP.innerHTML = (views[view.name] || vHome)();
  bindNav();
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
    const r = ST.runs[t];
    const logged = r
      ? `<div class="run-logged">✓ ${r.km} km · ${r.min} min · felt ${r.feel}${r.note ? ` · 📝 ${esc(r.note)}` : ''}</div>
         <button class="mini" onclick="openRunLog('${t}')">edit</button>`
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
window.openRunLog = function (date) {
  const day = dayFor(date);
  const r = ST.runs[date] || { km: day && day.title === 'Long Run' ? 20 : day && day.title === 'Hard Run' ? 10 : 8, min: 60, feel: null, note: '' };
  const m = $('#modal');
  m.innerHTML = `<div class="sheet"><h2>${esc(day ? day.title : 'Run')} — ${fmtDate(date)}</h2>
    <div class="stepper"><div class="stepper-lbl">Distance (km)</div><div class="stepper-row">
      <button class="stepbtn" onclick="runStep('km',-0.5)">−</button><div class="stepval" id="rv-km">${r.km}</div><button class="stepbtn" onclick="runStep('km',0.5)">+</button></div></div>
    <div class="stepper"><div class="stepper-lbl">Time (minutes)</div><div class="stepper-row">
      <button class="stepbtn" onclick="runStep('min',-5)">−</button><div class="stepval" id="rv-min">${r.min}</div><button class="stepbtn" onclick="runStep('min',5)">+</button></div></div>
    <div class="stepper"><div class="stepper-lbl">How did it feel?</div><div class="rpes">
      ${['good', 'ok', 'rough'].map(f => `<button class="rpe feel ${r.feel === f ? 'sel' : ''}" data-f="${f}" onclick="pickFeel('${f}')">${f === 'good' ? '😀 good' : f === 'ok' ? '😐 ok' : '😖 rough'}</button>`).join('')}</div></div>
    <input id="runnote" class="notefield" placeholder="Notes (optional)" value="${esc(r.note)}">
    <button class="btn primary big" onclick="saveRun('${date}')">Save run</button>
    <button class="linkbtn" onclick="closeModal()">Cancel</button></div>`;
  m.classList.add('open');
  m.dataset.km = r.km; m.dataset.min = r.min; m.dataset.feel = r.feel || '';
};
window.runStep = function (id, d) {
  const m = $('#modal');
  const v = Math.max(0, Math.round((parseFloat(m.dataset[id]) + d) * 10) / 10);
  m.dataset[id] = v;
  $('#rv-' + id).textContent = v;
};
window.pickFeel = function (f) {
  $('#modal').dataset.feel = f;
  document.querySelectorAll('.rpe.feel').forEach(b => b.classList.toggle('sel', b.dataset.f === f));
};
window.saveRun = function (date) {
  const m = $('#modal');
  if (!m.dataset.feel) { alert('Tap how it felt — it feeds the deload radar.'); return; }
  ST.runs[date] = { km: parseFloat(m.dataset.km), min: parseFloat(m.dataset.min), feel: m.dataset.feel, note: $('#runnote').value.trim() };
  save(); closeModal(); render();
};

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
  m.innerHTML = `<div class="sheet">
    <h2>Quick readiness check</h2>
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
      ${ex.rpe !== null ? rpePicker(t.rpe) : ''}
      <input id="setnote" class="notefield" placeholder="Notes — niggles, form cues (optional)" value="${esc(t.note)}">
      <button class="btn primary big" onclick="logSet()">✓ Log set — rest ${fmtSecs(ex.rest)}</button>
      <button class="linkbtn" onclick="failSet()">mark set failed</button>
    </div>`;

  return `<header class="top slim">
      <button class="backbtn" onclick="go('home')">‹</button>
      <div class="prog-wrap"><div class="prog"><div class="prog-fill" style="width:${(100 * doneSets / totalSets).toFixed(0)}%"></div></div>
      <div class="prog-txt">${doneSets}/${totalSets} sets · ~${remainMin} min left</div></div>
    </header>
    <main class="session">
      <div class="ex-head">
        <div class="ex-count">Exercise ${s.curIdx + 1} / ${s.exercises.length}</div>
        <h1>${esc(ex.name)}${ex.perSide ? ' <span class="perside">each side</span>' : ''}</h1>
        <div class="ex-rx">${e.tplSets} × ${e.tplReps}${unit} ${rpeStr} · rest ${fmtSecs(ex.rest)}</div>
        ${e.prescWeight != null && ex.mode !== 'bw' ? `<div class="ex-presc">Prescribed: <b>${e.prescWeight} kg</b></div>` : ''}
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
  if (wasLast && s.curIdx < s.exercises.length - 1) s.curIdx++;
  save();
  render();
};
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
        const runLogged = isRun && ST.runs[d.date];
        const icon = d.kind === 'run' ? '🏃' : d.kind === 'race' ? '🏁' : d.kind === 'lift' ? '🏋️' : d.kind === 'mobility' ? '🧘' : '·';
        let action = '';
        if (done) action = `<button class="mini" onclick="go('summary',{sid:'${d.date}'})">view</button>`;
        else if (isRun && d.date <= t) action = `<button class="mini" onclick="openRunLog('${d.date}')">${runLogged ? 'edit' : 'log'}</button>`;
        return `<div class="wk-day ${d.date === t ? 'today' : ''} ${d.kind}">
          <span class="wk-date">${fmtDate(d.date)}</span>
          <span class="wk-icon">${icon}</span>
          <span class="wk-title">${esc(d.title || 'Rest')}${done || runLogged ? ' <b class="done-tick">✓</b>' : ''}${runLogged ? ` <span class="dim">${ST.runs[d.date].km}km</span>` : ''}</span>
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
  return `<header class="top"><div class="phase">${esc(phaseLabel(today()))}</div></header>
  <main>
    <div class="section-label">Weekly volume (tonnes)</div>
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
    <div class="section-label">Backup</div>
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
  // runs: exercise="Run", reps column = km, rpe column blank, note = feel + note
  for (const d of Object.keys(ST.runs).sort()) {
    const r = ST.runs[d];
    rows.push([d, 'Run', `Run (${r.min} min)`, 1, '', r.km, '', '', (`felt ${r.feel}` + (r.note ? ' — ' + r.note : '')).replace(/"/g, '""')]);
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
