/* RunStrong — unit tests for the progression engine.
   Run: node tools/test-progression.js      (no dependencies, no build step)

   Covers the matrix the engine is specified against: logged RPE under / at / over
   target × every program phase, plus the reps-first rule, the increment-rounding
   guarantees, the taper volume band and the phase-label mapping.
   See the PROGRESSION ENGINE header in js/program.js for the evidence each
   expectation encodes. */
'use strict';

const P = require('../js/program.js');
const { nextPrescription, targetRPEForPhase, phaseKeyFromLabel, PHASE_POLICY, TEMPLATES, EXERCISES, WEIGHT_STEP_DEFAULT, buildProgram, STRETCH_SETUP_SECS, platesPerSide, PLATE_SET,
        HYPER_MESO_WEEKS, HYPER_POOLS, HYPER_ORDER, weeksSince, hyperExId, materializeTemplate, dadd } = P;

const STEP = WEIGHT_STEP_DEFAULT;   // 1 kg
let pass = 0, fail = 0;
const fails = [];

function ok(name, cond, detail) {
  if (cond) { pass++; return; }
  fail++; fails.push(name + (detail ? '\n      ' + detail : ''));
}
function eq(name, got, want) { ok(name, got === want, `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); }
function group(name) { console.log('\n' + name); }

/* a past session for one exercise: n sets at weight/reps/rpe */
function sess(date, weight, reps, rpe, n, extra) {
  return { date, sets: Array.from({ length: n || 3 }, () => Object.assign({ weight, reps, rpe, failed: false }, extra)) };
}
/* logged RPE that sits `delta` above the phase-adjusted target midpoint */
function rpeAt(exId, phase, delta) {
  const t = targetRPEForPhase(exId, phase);
  return Math.max(1, Math.min(10, (t[0] + t[1]) / 2 + delta));
}
function presc(exId, history, tplReps, phase) {
  return nextPrescription(exId, history, STEP, tplReps, { phase });
}

const PHASES = Object.keys(PHASE_POLICY);   // intro build peak rebuild taper raceweek deload maint

/* ===================================================================
   1. the RPE × phase matrix — squat (lower, target RPE 7-8) at 100 kg
   =================================================================== */
group('RPE below / at / over target × each phase (squat, 100 kg, all reps met)');
const EXPECT = {
  //          2+ under target      exactly at target        2 over target
  intro:    { under: 'up',         at: 'hold',              over: 'down' },
  build:    { under: 'up',         at: 'up',                over: 'down' },
  peak:     { under: 'up',         at: 'up',                over: 'down' },
  rebuild:  { under: 'up',         at: 'up',                over: 'down' },
  taper:    { under: 'hold',       at: 'hold',              over: 'down' },
  raceweek: { under: 'hold',       at: 'hold',              over: 'down' },
  deload:   { under: 'down',       at: 'down',              over: 'down' },  // deload always cuts
  maint:    { under: 'up',         at: 'hold',              over: 'down' },
  // rpeAdj 0 + atTargetHold: false — same shape as build/peak/rebuild, unlike
  // maint's hold-at-target (see the PHASE_POLICY.hypertrophy comment).
  hypertrophy: { under: 'up',      at: 'up',                over: 'down' },
  // allowUp false, no cutPct: load is frozen, the PLAN halves the sets [H10].
  hyperDeload: { under: 'hold',    at: 'hold',              over: 'down' },
  // run-build down week: load held, never pushed, still cut if it was too hard
  down:     { under: 'hold',       at: 'hold',              over: 'down' },
};
const dir = (w, base) => (w > base ? 'up' : w < base ? 'down' : 'hold');

for (const phase of PHASES) {
  for (const [label, delta] of [['under', -2], ['at', 0], ['over', +2]]) {
    const r = presc('squat', [sess('2026-08-20', 100, 4, rpeAt('squat', phase, delta), 4)], 4, phase);
    eq(`${phase} / RPE ${label} target → ${EXPECT[phase][label]}`, dir(r.weight, 100), EXPECT[phase][label]);
    ok(`${phase} / RPE ${label} target → has a reason`, typeof r.reason === 'string' && r.reason.length > 0);
    eq(`${phase} / RPE ${label} target → reps handed back unchanged`, r.reps, 4);
  }
}

group('increase size scales with how far under target, and with the phase');
{
  const at = w => presc('squat', [sess('2026-08-20', 100, 4, rpeAt('squat', 'build', 0), 4)], 4, 'build').weight;
  const big = presc('squat', [sess('2026-08-20', 100, 4, rpeAt('squat', 'build', -2), 4)], 4, 'build').weight;
  const mid = presc('squat', [sess('2026-08-20', 100, 4, rpeAt('squat', 'build', -1), 4)], 4, 'build').weight;
  ok('2+ under target jumps more than 1 under', big > mid, `big=${big} mid=${mid}`);
  ok('1 under target jumps more than at-target', mid > at(), `mid=${mid} at=${at()}`);
  eq('at target = exactly one increment', at(), 100 + STEP);
  ok('build jump is capped at 7% (ACSM 2-10%)', big <= 107, `big=${big}`);
  // intro halves the jump and caps it at 3%
  const introBig = presc('squat', [sess('2026-08-20', 100, 4, rpeAt('squat', 'intro', -2), 4)], 4, 'intro').weight;
  ok('intro jump is smaller than the same call in build', introBig < big, `intro=${introBig} build=${big}`);
  ok('intro jump is capped at 3%', introBig <= 103, `intro=${introBig}`);
}

group('upper body gets smaller jumps than lower body (ACSM: smaller muscle groups)');
{
  const low = presc('squat', [sess('2026-08-20', 100, 4, rpeAt('squat', 'build', -2), 4)], 4, 'build').weight - 100;
  const up = presc('bench', [sess('2026-08-20', 100, 5, rpeAt('bench', 'build', -2), 4)], 5, 'build').weight - 100;
  ok('lower jump > upper jump at the same RPE gap', low > up, `lower=+${low} upper=+${up}`);
}

/* ===================================================================
   2. failure, missed reps, fatigue drift
   =================================================================== */
group('failed sets and RPE 10');
{
  const failed = presc('squat', [sess('2026-08-20', 100, 4, 8, 4, { failed: true })], 4, 'build');
  ok('a failed set backs the load off', failed.weight < 100, `got ${failed.weight}`);
  const rpe10 = presc('squat', [sess('2026-08-20', 100, 4, 10, 4)], 4, 'build');
  ok('RPE 10 backs the load off', rpe10.weight < 100, `got ${rpe10.weight}`);
  ok('RPE 10 in a taper still backs off (safety beats phase)', presc('squat', [sess('2026-08-20', 100, 4, 10, 4)], 4, 'taper').weight < 100);
  ok('failure raises a fatigue flag', !!rpe10.warn);
}

group('reps come before load');
{
  // all-out effort but only 2 of 4 reps: load must not go up even at a low RPE
  const missed = presc('squat', [sess('2026-08-20', 100, 2, rpeAt('squat', 'build', -2), 4)], 4, 'build');
  eq('missed reps at low RPE → hold, never increase', dir(missed.weight, 100), 'hold');
  ok('missed-reps reason mentions the reps', /reps/.test(missed.reason), missed.reason);
  const missedHard = presc('squat', [sess('2026-08-20', 100, 2, rpeAt('squat', 'build', +2), 4)], 4, 'build');
  eq('missed reps at high RPE → drop the load', dir(missedHard.weight, 100), 'down');
}

group('accumulated fatigue: two sessions over target in a row');
{
  const hist = [
    sess('2026-08-17', 100, 4, rpeAt('squat', 'build', +1), 4),
    sess('2026-08-20', 100, 4, rpeAt('squat', 'build', +1), 4),
  ];
  const r = presc('squat', hist, 4, 'build');
  eq('drift over two sessions → trim rather than hold', dir(r.weight, 100), 'down');
  ok('drift raises a fatigue flag', !!r.warn && /fatigue/i.test(r.warn), String(r.warn));
  // a single over-target session (following an on-target one) only holds
  const single = presc('squat', [sess('2026-08-17', 100, 4, rpeAt('squat', 'build', 0), 4), sess('2026-08-20', 100, 4, rpeAt('squat', 'build', +1), 4)], 4, 'build');
  eq('one over-target session → hold, not cut', dir(single.weight, 100), 'hold');
}

/* ===================================================================
   3. increment / rounding guarantees (1 kg step)
   =================================================================== */
group('every suggestion lands on the user\'s increment, and never rounds to a no-op');
{
  for (const step of [0.5, 1, 2.5, 5]) {
    for (const w0 of [4, 7.5, 12, 22.5, 60, 100]) {
      for (const delta of [-2, -1, 0, +1, +2]) {
        const r = nextPrescription('squat', [sess('2026-08-20', w0, 4, rpeAt('squat', 'build', delta), 4)], step, 4, { phase: 'build' });
        const mult = Math.round(r.weight / step);
        ok(`step ${step} @ ${w0} kg (Δ${delta}) → multiple of the step`, Math.abs(mult * step - r.weight) < 1e-9, `got ${r.weight}`);
      }
    }
  }
  // a 3.5% cut on a light upper-body lift is 0.35 kg — it must still move a full step
  const light = nextPrescription('bench', [sess('2026-08-20', 10, 5, 10, 3)], 1, 5, { phase: 'build' });
  ok('a cut on a light lift moves at least one step', light.weight <= 9, `got ${light.weight}`);
  // a 2% increase on a light lift must still move at least one full step
  const lightUp = nextPrescription('bench', [sess('2026-08-20', 20, 5, rpeAt('bench', 'build', 0), 4)], 1, 5, { phase: 'build' });
  eq('an at-target increase on a light lift is one step', lightUp.weight, 21);
  // never negative
  const tiny = nextPrescription('bench', [sess('2026-08-20', 0.5, 5, 10, 3)], 1, 5, { phase: 'build' });
  ok('load never goes negative', tiny.weight >= 0, `got ${tiny.weight}`);
}

/* ===================================================================
   4. non-load exercises, first exposure, missing data
   =================================================================== */
group('exercises with no RPE target, and missing data');
{
  const plyo = presc('boxjump', [sess('2026-08-20', null, 3, null, 3)], 3, 'build');
  eq('plyometrics (no RPE target) hold their prescription', plyo.weight, null);
  const first = presc('squat', [], 4, 'build');
  eq('first exposure suggests no weight', first.weight, null);
  ok('first exposure explains the RIR target', /reps short of failure|RPE/.test(first.reason), first.reason);
  const introFirst = presc('squat', [], 4, 'intro');
  const buildFirst = presc('squat', [], 4, 'build');
  ok('first exposure in intro targets a lower RPE than in build', introFirst.reason !== buildFirst.reason);
  const noRpe = presc('squat', [sess('2026-08-20', 100, 4, null, 4)], 4, 'build');
  eq('no logged RPE → hold last load', noRpe.weight, 100);
  const noSets = presc('squat', [{ date: '2026-08-20', sets: [] }], 4, 'build');
  eq('no logged sets → no suggestion', noSets.weight, null);
}

/* ===================================================================
   5. phase plumbing
   =================================================================== */
group('program phase labels map to the right policy');
{
  eq('Intro — conservative loads', phaseKeyFromLabel('Intro — conservative loads'), 'intro');
  eq('Build', phaseKeyFromLabel('Build'), 'build');
  eq('Build — peak load', phaseKeyFromLabel('Build — peak load'), 'peak');
  eq('Geelong mini-taper', phaseKeyFromLabel('Geelong mini-taper'), 'taper');
  eq('Recover → rebuild', phaseKeyFromLabel('Recover → rebuild'), 'rebuild');
  eq('Taper', phaseKeyFromLabel('Taper'), 'taper');
  eq('Melbourne race week', phaseKeyFromLabel('Melbourne race week'), 'raceweek');
  eq('Geelong taper (the live final week) is a taper, not a race-week primer', phaseKeyFromLabel('Geelong taper'), 'taper');
  eq('unknown label falls back to build', phaseKeyFromLabel('something else'), 'build');
  eq('missing label falls back to build', phaseKeyFromLabel(null), 'build');
  // every week the program generates must resolve to a real policy
  for (const w of buildProgram().weeks) {
    ok(`week ${w.num} phase "${w.phase}" resolves to a policy`, !!PHASE_POLICY[phaseKeyFromLabel(w.phase)]);
  }
}

group('target RPE bands shift with the phase');
{
  const build = targetRPEForPhase('squat', 'build');
  const intro = targetRPEForPhase('squat', 'intro');
  const race = targetRPEForPhase('squat', 'raceweek');
  eq('build uses the exercise band as written', build.join('-'), EXERCISES.squat.rpe.join('-'));
  ok('intro is a point easier than build', intro[1] < build[1], `intro=${intro} build=${build}`);
  ok('race week is easier again', race[1] < intro[1], `race=${race} intro=${intro}`);
  ok('bands never drop below RPE 5', race[0] >= 5, `race=${race}`);
  eq('exercises without an RPE target have no band', targetRPEForPhase('boxjump', 'build'), null);
}

/* ===================================================================
   6. volume periodisation lives in the templates (Bosquet 41-60%)
   =================================================================== */
group('taper weeks cut volume into the 41-60% band while intensity is held');
{
  const setsOf = tpl => TEMPLATES[tpl].items.reduce((a, i) => a + i[1], 0);
  // the race block only — the off-season's volume is a different question
  const program = { weeks: P.buildRaceBlock() };
  const weeks = program.weeks.map(w => ({
    num: w.num, phase: w.phase,
    sets: w.days.filter(d => d.kind === 'lift').reduce((a, d) => a + setsOf(d.tpl), 0),
  }));
  const peak = Math.max(...weeks.map(w => w.sets));
  const cutOf = w => Math.round(100 * (1 - w.sets / peak));
  const raceWeekNums = new Set(program.weeks.filter(w => w.days.some(d => d.kind === 'race')).map(w => w.num));
  for (const w of weeks.filter(x => /taper/i.test(x.phase))) {
    const cut = cutOf(w);
    if (raceWeekNums.has(w.num)) {
      // The week that holds the race is taper AND race week in one (see the
      // GEELONG TAPER header): lifting cuts deeper than the 41-60% running
      // band on purpose [T3], but still shows up more than once [T1].
      ok(`week ${w.num} (${w.phase}) cuts lifting volume ${cut}% — deeper than 60% in the race week`, cut > 60, `${w.sets} of ${peak} sets = ${cut}%`);
      const lifts = program.weeks.find(x => x.num === w.num).days.filter(d => d.kind === 'lift').length;
      ok(`week ${w.num} still lifts at least twice (frequency kept)`, lifts >= 2, `${lifts} lift days`);
    } else {
      ok(`week ${w.num} (${w.phase}) cuts volume ${cut}% — inside 41-60%`, cut >= 41 && cut <= 60, `${w.sets} of ${peak} sets = ${cut}%`);
    }
  }
  // intensity held: taper templates must not raise the rep counts (heavy stays heavy)
  const repsOf = tpl => Object.fromEntries(TEMPLATES[tpl].items.map(i => [i[0], i[2]]));
  const buildLowerA = repsOf('lowerA'), taperLowerA = repsOf('lowerTaperA');
  for (const exId of Object.keys(taperLowerA)) {
    if (buildLowerA[exId] == null) continue;
    ok(`taper keeps ${exId} reps at or below build reps (no drift to hypertrophy)`, taperLowerA[exId] <= buildLowerA[exId], `taper=${taperLowerA[exId]} build=${buildLowerA[exId]}`);
  }
  ok('the taper never introduces a movement that is not in the build weeks', Object.keys(taperLowerA).every(id => !!EXERCISES[id]));
}

/* ===================================================================
   6b. the program's shape: one race, a real taper, nothing after it
   =================================================================== */
group('race block ends on Geelong with an 8-day taper (GEELONG TAPER header)');
{
  const { RACES, buildRaceBlock } = P;
  const prog = { weeks: buildRaceBlock() };
  const last = prog.weeks[prog.weeks.length - 1];
  const lastDay = last.days[last.days.length - 1];
  eq('Geelong is the race block\'s race and an A race (Melbourne is gone)', RACES[0].key + '/' + RACES[0].tag, 'geelong/A race');
  ok('no Melbourne anywhere in RACES', !RACES.some(r => r.key === 'melbourne'));
  eq('the race block has 6 weeks', prog.weeks.length, 6);
  eq('the last day of the race block is race day', lastDay.date, RACES[0].date);
  eq('race day is a race, not a long run', lastDay.kind, 'race');
  eq('the final week resolves to the taper policy (load frozen)', phaseKeyFromLabel(last.phase), 'taper');
  // no lifting within 3 days of the race; the two lifts sit Mon/Tue
  const liftDates = last.days.filter(d => d.kind === 'lift').map(d => d.date);
  ok('no lift within 3 days of the race', liftDates.every(d => dadd(d, 3) < RACES[0].date), liftDates.join(','));
  eq('two lifts in race week', liftDates.length, 2);
  eq('race week lifts Monday (crisp squat triples)', last.days[0].tpl, 'lowerTaperB');
  eq('race week lifts Tuesday (upper, no running cost)', last.days[1].tpl, 'upperTaperA');
  eq('Wednesday is the sharpener, still a hard run for warm-up dosing', last.days[2].kind === 'run' && /Hard Run/.test(last.days[2].title), true);
  ok('the sharpener says what to do, not the build-week placeholder', /goal half pace/.test(last.days[2].sub));
  eq('Thursday is mobility only', last.days[3].kind, 'mobility');
  eq('Friday is an easy run', last.days[4].kind === 'run' && /Easy/.test(last.days[4].title), true);
  eq('Saturday is not a lift', last.days[5].kind === 'lift', false);
  // the taper starts the Sunday before race week: the peak week's long run is cut
  const peakWeek = prog.weeks.find(w => /peak/i.test(w.phase));
  const peakSunday = peakWeek.days[6];
  eq('peak week Sunday is still a long run', peakSunday.kind === 'run' && /Long Run/.test(peakSunday.title), true);
  ok('…but a cut one (12-14 km, not 20)', /12–14 km/.test(peakSunday.sub) && !/20 km/.test(peakSunday.sub), peakSunday.sub);
  ok('peak week keeps all four lifts (the cut is running only)', peakWeek.days.filter(d => d.kind === 'lift').length === 4);
  // every day of every full week is accounted for, no gaps
  for (const w of prog.weeks.slice(1)) {
    eq(`week ${w.num} has 7 days`, w.days.length, 7);
    for (let i = 1; i < w.days.length; i++) eq(`week ${w.num} day ${i} follows day ${i - 1}`, w.days[i].date, dadd(w.days[i - 1].date, 1));
  }
  // build weeks are untouched by the taper change
  const build = prog.weeks.find(w => w.phase === 'Build');
  eq('build week long run is still ~20 km', build.days[6].sub, '~20 km');
  eq('build week has 4 lifts', build.days.filter(d => d.kind === 'lift').length, 4);
}

/* ===================================================================
   6c. the off-season is a dated calendar (OFF-SEASON header in program.js)
   =================================================================== */
group('off-season calendar: the hypertrophy block starts the day after the race, no gaps');
{
  const { RACES, HYPER_START, BLOCK_WEEKS, hyperPhaseLabel, buildOffseason, buildRaceBlock, mesoAnchor } = P;
  const prog = buildProgram();
  const race = buildRaceBlock();
  eq('the race block is unchanged by the off-season (6 weeks)', race.length, 6);
  eq('the whole calendar is the race block plus one long block', prog.weeks.length, 6 + BLOCK_WEEKS);
  // continuity
  for (let i = 1; i < prog.weeks.length; i++) {
    const prev = prog.weeks[i - 1], cur = prog.weeks[i];
    eq(`week ${cur.num} starts the day after week ${prev.num} ends`, cur.days[0].date, dadd(prev.days[prev.days.length - 1].date, 1));
    eq(`week ${cur.num} is numbered continuously`, cur.num, prev.num + 1);
    eq(`week ${cur.num} has 7 days`, cur.days.length, 7);
  }
  eq('the block starts the day after the race — no recovery week', HYPER_START, dadd(RACES[0].date, 1));
  ok('…and nothing on the calendar is still labelled a recovery week', !prog.weeks.some(w => /recovery week/i.test(w.phase)));
  eq('the block runs to Sun 18 Apr 2027', dadd(HYPER_START, BLOCK_WEEKS * 7 - 1), '2027-04-18');
  ok('…with no race anywhere in it (v69)', !prog.weeks.some(w => w.days.some(d => d.kind === 'race' && d.date > RACES[0].date)));
  /* Week 1 is the lightest week of a mesocycle — the only protection left
     once the recovery week went, so it is worth an assertion. */
  const wk1 = prog.weeks.find(w => w.monday === HYPER_START);
  const wk2 = prog.weeks.find(w => w.monday === dadd(HYPER_START, 7));
  const sets = w => w.days.filter(d => d.kind === 'lift')
    .reduce((a, d) => a + P.materializeTemplate(d.tpl, d.date, HYPER_START).items.reduce((x, i) => x + i[1], 0), 0);
  ok('block week 1 carries no ramp — it is the lightest loading week', sets(wk1) < sets(wk2), `${sets(wk1)} vs ${sets(wk2)}`);
  // hypertrophy weeks
  const hyper = prog.weeks.filter(w => /hypertrophy/i.test(w.phase));
  eq('every week of the block carries a hypertrophy label', hyper.length, BLOCK_WEEKS);
  const off = buildOffseason(null, null);
  eq('buildOffseason returns the whole block', off.length, BLOCK_WEEKS);
  /* Weeks carrying a dated exception are not the generated shape by design —
     they are checked in their own group below. */
  const overridden = w => w.days.some(d => P.DAY_OVERRIDES[d.date]);
  for (const w of hyper.filter(w => !overridden(w))) {
    const lifts = w.days.filter(d => d.kind === 'lift').length;
    /* Since v39 the Sunday lift carries the day's easy run (day.run), so a
       run is either its own day or a flag on a lift day — the same shape
       the `mobility` flag has always had on a run day. */
    const runs = w.days.filter(d => d.kind === 'run' || d.run).length;
    const mob = w.days.filter(d => d.kind === 'mobility' || d.mobility).length;
    eq(`week ${w.num} (${w.phase}): 5 lifts`, lifts, 5);
    eq(`week ${w.num}: 2 easy runs`, runs, 2);
    ok(`week ${w.num}: every run is easy`, w.days.filter(d => d.kind === 'run').every(d => /easy/i.test(d.title)));
    eq(`week ${w.num}: exactly one mobility session`, mob, 1);
    /* v65: Arms & Core moved to Saturday and Sunday became a run of its own,
       which leaves the week with no rest day. Asserted rather than assumed,
       because it was the reverse two commits ago and the rest day was the
       whole point of that change — if it comes back, this is where it shows. */
    eq(`week ${w.num}: lifts sit Mon/Tue/Thu/Fri/Sat`, w.days.map((d, i) => d.kind === 'lift' ? i : null).filter(i => i !== null).join(','), '0,1,3,4,5');
    /* v70: Saturday is the short Arms & Core session in a loading week and
       the benchmark in a deload week. Asserted as a function of the week
       rather than loosened to "either of two templates", so a benchmark
       landing in a loading week — or going missing from a deload — fails. */
    /* Off the phase label, not off w.num: w.num counts program weeks from the
       race block, so it is not the block week and 'every fourth' is not four. */
    const dl = /deload/i.test(w.phase);
    eq(`week ${w.num}: Saturday is ${dl ? 'the benchmark' : 'the short Arms & Core session'}`,
      w.days[5].tpl, dl ? 'hypBench' : 'hypArms');
    eq(`week ${w.num}: Sunday is a run on its own, not stacked on a lift`, w.days[6].kind + '/' + !!w.days[6].run, 'run/false');
    eq(`week ${w.num}: seven training days, no rest day`, w.days.filter(d => d.kind === 'rest').length, 0);
    ok(`week ${w.num}: has no rest-less 8-slot day problem (every day is one plan)`, w.days.every(d => ['lift', 'run', 'mobility', 'rest'].includes(d.kind)));
    ok(`week ${w.num}: label resolves to a hypertrophy policy`, ['hypertrophy', 'hyperDeload'].includes(phaseKeyFromLabel(w.phase)), phaseKeyFromLabel(w.phase));
  }
  /* The rhythm repeats for as long as the block runs — no transition week to
     a running programme any more, because there is no running programme. */
  const labels = Array.from({ length: BLOCK_WEEKS }, (_, i) => hyperPhaseLabel(i + 1));
  eq('week 4 is the block-1 deload', phaseKeyFromLabel(labels[3]), 'hyperDeload');
  eq('week 8 is the block-2 deload', phaseKeyFromLabel(labels[7]), 'hyperDeload');
  eq('a deload every fourth week for the whole block', labels.filter(l => phaseKeyFromLabel(l) === 'hyperDeload').length, Math.floor(BLOCK_WEEKS / 4));
  ok('week 5 starts block 2', /block 2/.test(labels[4]), labels[4]);
  ok('nothing is labelled a transition any more', !labels.some(l => /transition/i.test(l)));
  // the deload policy holds load and never pushes
  eq('hyperDeload never allows a load increase', PHASE_POLICY.hyperDeload.allowUp, false);
  ok('hyperDeload does not cut load (that is the plan\'s job via sets)', !PHASE_POLICY.hyperDeload.cutPct);
  // rotation anchor
  eq('accessory rotation anchors on the block start when the calendar is live', mesoAnchor({ active: false, mesoStart: '2026-01-01' }), HYPER_START);
  eq('…and on the legacy maintenance start when that fallback is active', mesoAnchor({ active: true, mesoStart: '2026-10-05' }), '2026-10-05');
  // every day's template exists
  for (const w of prog.weeks) for (const d of w.days) if (d.kind === 'lift') ok(`${d.date} template "${d.tpl}" exists`, !!TEMPLATES[d.tpl]);
}

/* ===================================================================
   6d. the hypertrophy block's numbers (HYPERTROPHY BLOCK header)
   =================================================================== */
group('hypertrophy block: per-muscle weekly sets, frequency, rest, contracts');
{
  const { HYPER_START, HYPER_WEEK, MUSCLE_MAP, buildOffseason } = P;
  const MAJOR = ['quads', 'hams', 'glutes', 'chest', 'back', 'shoulders', 'biceps', 'triceps'];
  // per-muscle weekly hard sets for a given calendar week of the block
  const weekSets = weekOffset => {
    const monday = dadd(HYPER_START, weekOffset * 7);
    const sets = {};
    const perDay = {};
    for (let i = 0; i < 7; i++) {
      const plan = HYPER_WEEK[i];
      if (!plan || plan.kind !== 'lift') continue;
      const mat = materializeTemplate(plan.tpl, dadd(monday, i), HYPER_START);
      for (const [exId, n] of mat.items) for (const m of MUSCLE_MAP[exId]) {
        sets[m] = (sets[m] || 0) + n;
        (perDay[m] = perDay[m] || new Set()).add(i);
      }
    }
    return { sets, perDay };
  };
  const w1 = weekSets(0), w3 = weekSets(2), w4 = weekSets(3), w5 = weekSets(4), w7 = weekSets(6);
  /* Two tiers since v67, because the block now has two jobs. GROWING a muscle
     and MAINTAINING one are different doses: maintenance holds at roughly a
     third of the volume and can do it on one day a week, which is the whole
     reason the leg work could be compressed into a single session and the
     freed sets given to chest, biceps and abs.
     Splitting the thresholds is not a relaxation — each tier is asserted at
     the level its job requires, and a growth muscle slipping into the
     maintenance band still fails. */
  const GROW = ['chest', 'back', 'shoulders', 'biceps', 'triceps'];
  const MAINTAIN = ['quads', 'hams', 'glutes', 'calves'];
  for (const m of GROW) {
    ok(`${m}: ≥10 hard sets in block week 1 [H1]`, (w1.sets[m] || 0) >= 10, `${w1.sets[m]}`);
    // 13 not 14: direct sets only — pull-ups/rows/presses train arms hard
    // but carry no arm tag, so the arm counts here understate real volume
    ok(`${m}: ≥13 hard sets by block week 3 [H1]`, (w3.sets[m] || 0) >= 13, `${w3.sets[m]}`);
    ok(`${m}: block-2 week 3 is at least as high`, (w7.sets[m] || 0) >= 13, `${w7.sets[m]}`);
    ok(`${m}: trained on ≥2 days a week [H2]`, (w1.perDay[m] || new Set()).size >= 2, `${[...(w1.perDay[m] || [])]}`);
    ok(`${m}: still ≥2 days in block 2`, (w5.perDay[m] || new Set()).size >= 2);
  }
  for (const m of MAINTAIN) {
    ok(`${m}: ≥6 sets a week — a maintenance dose, not a growth one`, (w1.sets[m] || 0) >= 6, `${w1.sets[m]}`);
    ok(`${m}: trained at least once a week`, (w1.perDay[m] || new Set()).size >= 1, `${[...(w1.perDay[m] || [])]}`);
  }
  /* The priority muscles are the point of the block, so they are asserted
     against each other rather than only against a floor: if legs ever creep
     back above chest, the split has drifted from what it was built for. */
  const legTotal = MAINTAIN.reduce((a, m) => a + (w1.sets[m] || 0), 0);
  const priorityTotal = ['chest', 'biceps', 'core'].reduce((a, m) => a + (w1.sets[m] || 0), 0);
  ok('chest + biceps + core outweigh all leg work combined', priorityTotal > legTotal, `${priorityTotal} vs ${legTotal}`);
  /* Measured on DIRECT work — the muscle each lift is actually for. On the
     every-tag count back and shoulders always read high, because three upper
     days of pressing and pulling credit them on the way past; that is an
     artefact of the counting, not a priority. */
  const direct = weekOffset => {
    const monday = dadd(HYPER_START, weekOffset * 7);
    const out = {};
    for (let i = 0; i < 7; i++) {
      const plan = HYPER_WEEK[i];
      if (!plan || plan.kind !== 'lift') continue;
      for (const [exId, n] of materializeTemplate(plan.tpl, dadd(monday, i), HYPER_START).items) {
        const m0 = (MUSCLE_MAP[exId] || [])[0];
        if (m0) out[m0] = (out[m0] || 0) + n;
      }
    }
    return out;
  };
  const d1 = direct(0), d3 = direct(2);
  ok('chest gets more direct work than any other muscle', Object.entries(d1).every(([m, n]) => m === 'chest' || n <= d1.chest), JSON.stringify(d1));
  ok('biceps and core both sit in the top four', ['biceps', 'core'].every(m => Object.values(d1).filter(n => n > d1[m]).length <= 3), JSON.stringify(d1));
  ok('core is trained on ≥3 days [H2]', (w1.perDay.core || new Set()).size >= 3, `${[...(w1.perDay.core || [])]}`);
  for (const m of [...GROW, ...MAINTAIN]) {
    ok(`${m}: deload week is ≤60% of week 3 [H10]`, (w4.sets[m] || 0) <= (w3.sets[m] || 0) * 0.6, `${w4.sets[m]} vs ${w3.sets[m]}`);
  }
  ok('nothing runs away: no muscle over 24 direct sets in week 3 (junk-volume guard)', Object.values(d3).every(n => n <= 24), JSON.stringify(d3));
  // rest: compounds 120-150 s, isolation 45-90 s [H5]
  /* Multi-joint lifts, which [H5] gives the longer rest. Extended in v54 when
     the pools widened: these are classified by what the movement is, not
     trimmed to fit the accessory rest band — a close-grip bench is a press
     and gets a press's recovery. */
  const COMPOUND = new Set(['squat', 'legpress', 'hacksquat', 'frontsquat', 'bench', 'incline', 'dbbench', 'ohp', 'dbshoulder', 'landmine', 'pullup', 'latpull', 'rdl', 'trapbar', 'hipthrust', 'dip',
    'machpress', 'sealrow', 'closegrip', 'diamondpu', 'gobletsquat', 'walkinglunge', 'slpress']);
  // exercise selection changes every block [H9]: every session has a rotating
  // slot, and every pool resolves differently in block 2 than in block 1
  for (const tp of HYPER_ORDER) ok(`${tp} has at least one rotating slot`, TEMPLATES[tp].items.some(([id]) => String(id).startsWith('ROTATE:')));
  for (const [pool, members] of Object.entries(HYPER_POOLS)) {
    const b1 = P.hyperExId(members, HYPER_START, HYPER_START), b2 = P.hyperExId(members, HYPER_START, dadd(HYPER_START, 28));
    ok(`${pool}: block 2 (${b2}) differs from block 1 (${b1})`, b1 !== b2);
    ok(`${pool}: is referenced by a template`, HYPER_ORDER.some(tp => TEMPLATES[tp].items.some(([id]) => id === 'ROTATE:' + pool)));
  }
  {
    // count the lifts that differ between a block-1 week and a block-2 week
    let changed = 0, total = 0;
    for (const tp of HYPER_ORDER) {
      const a = materializeTemplate(tp, HYPER_START, HYPER_START).items.map(i => i[0]);
      const b = materializeTemplate(tp, dadd(HYPER_START, 28), HYPER_START).items.map(i => i[0]);
      a.forEach((id, i) => { total++; if (id !== b[i]) changed++; });
    }
    ok(`at least a third of the block's lifts change between blocks (${changed} of ${total})`, changed * 3 >= total);
  }
  const inBlock = new Set();
  for (const tp of HYPER_ORDER) for (const [id] of TEMPLATES[tp].items) {
    if (String(id).startsWith('ROTATE:')) for (const m of HYPER_POOLS[id.slice(7)]) inBlock.add(m); else inBlock.add(id);
  }
  for (const id of inBlock) {
    const r = EXERCISES[id].rest;
    if (COMPOUND.has(id)) ok(`${id} (compound) rests ≥ 90 s [H5]`, r >= 90, `${r}s`);
    else ok(`${id} (accessory/isolation) rests 45-90 s [H5]`, r >= 45 && r <= 90, `${r}s`);
  }
  // reps: compounds 5-10, isolation 10-15 [H3]
  for (const tp of HYPER_ORDER) for (const [id, , reps] of TEMPLATES[tp].items) {
    const ex = String(id).startsWith('ROTATE:') ? null : EXERCISES[id];
    /* Timed and carry work logs seconds or metres in the reps column, so the
       rep-range rule does not apply to it — copen's "30" is half a minute of
       holding, not thirty repetitions. */
    if (ex && ex.mode !== 'reps' && ex.mode !== 'bw') ok(`${tp}/${id}: ${ex.mode} work, reps rule does not apply`, reps > 0, `${reps}`);
    else if (ex && COMPOUND.has(id)) ok(`${tp}/${id}: compound reps 5-10 [H3]`, reps >= 5 && reps <= 10, `${reps}`);
    else if (ex) ok(`${tp}/${id}: isolation reps 10-15 [H3]`, reps >= 10 && reps <= 15, `${reps}`);
  }
  // every exercise the block can schedule has the full contract
  const { INSIGHTS, HOWTO } = P;
  for (const id of inBlock) {
    const ex = EXERCISES[id];
    ok(`${id}: has name/group/mode/rest/cue`, !!(ex.name && ex.group && ex.mode && ex.rest && ex.cue));
    ok(`${id}: has an INSIGHTS why/deep`, !!(INSIGHTS[id] && INSIGHTS[id].why && INSIGHTS[id].deep));
    ok(`${id}: has HOWTO steps`, !!(HOWTO[id] && HOWTO[id].steps && HOWTO[id].steps.length >= 3));
    ok(`${id}: every swap is a real exercise`, (ex.swaps || []).every(s => !!EXERCISES[s]));
    ok(`${id}: MUSCLE_MAP tags are in the vocabulary`, MUSCLE_MAP[id].every(m => ['quads', 'glutes', 'hams', 'calves', 'adductors', 'hipflex', 'chest', 'back', 'shoulders', 'core', 'biceps', 'triceps'].includes(m)));
  }
  for (const id of ['latraise', 'reardelt', 'cableflye', 'preachercurl', 'legcurl', 'legext']) {
    ok(`${id}: new isolation lift sits at rpe [8,9] [H4]`, JSON.stringify(EXERCISES[id].rpe) === '[8,9]');
    ok(`${id}: has a swap that needs no machine`, EXERCISES[id].swaps.some(s => !(EXERCISES[s].equip || []).includes('machine')));
  }
  // the honest-voice rule: no new lift claims to help the half
  for (const id of ['latraise', 'reardelt', 'cableflye', 'preachercurl', 'legcurl', 'legext']) {
    ok(`${id}: insight does not claim running benefit`, !/your half|your stride|running economy/i.test(INSIGHTS[id].why));
  }
  // the calendar actually schedules the block templates
  const off = buildOffseason();
  const blockWeeks = off.filter(w => /hypertrophy/i.test(w.phase));
  /* HYPER_ORDER is the loading-week shape. A deload week swaps its last
     entry — Saturday's arms session — for the benchmark, and nothing else. */
  const orderFor = phase => (/deload/i.test(phase) ? HYPER_ORDER.slice(0, -1).concat('hypBench') : HYPER_ORDER);
  ok('every hypertrophy week schedules exactly HYPER_ORDER (benchmark for arms in a deload)',
    blockWeeks.every(w => JSON.stringify(w.days.filter(d => d.kind === 'lift').map(d => d.tpl)) === JSON.stringify(orderFor(w.phase))),
    JSON.stringify((blockWeeks.find(w => JSON.stringify(w.days.filter(d => d.kind === 'lift').map(d => d.tpl)) !== JSON.stringify(orderFor(w.phase))) || {}).phase));
}

/* ===================================================================
   6e. one continuous block (ONE CONTINUOUS BLOCK header)
   =================================================================== */
group('one continuous block: the same split for thirty weeks, race week aside');
{
  const { RACES, BLOCK_WEEKS, buildOffseason, blockPhaseLabel, isLowerTpl, DAY_OVERRIDES } = P;
  const block = buildOffseason(null, null);
  eq(`${BLOCK_WEEKS} weeks`, block.length, BLOCK_WEEKS);
  eq('starting the day after Geelong', block[0].monday, dadd(RACES[0].date, 1));
  eq('…and running to Sun 18 Apr 2027', block[block.length - 1].days[6].date, '2027-04-18');
  ok('the summer running block is gone', ['buildSummer', 'buildPostRace', 'SUMMER_START', 'POST_RACE_WEEKS']
    .every(k => typeof P[k] === 'undefined'));

  /* The point of the change: one split, not four blocks. Every week that is
     not race week and carries no dated exception is the same five lifts. */
  const normal = block.filter(w => !w.days.some(d => d.kind === 'race' || DAY_OVERRIDES[d.date]));
  ok('every ordinary week is the same five lifts', normal.every(w =>
    w.days.filter(d => d.kind === 'lift').map(d => d.tpl).join(',')
      === (/deload/i.test(w.phase) ? 'hypPush,hypPull,hypLowerS,hypUpper,hypBench' : 'hypPush,hypPull,hypLowerS,hypUpper,hypArms')));
  ok('…and two runs', normal.every(w => w.days.filter(d => d.kind === 'run').length === 2));
  ok('…and one mobility session', normal.every(w => w.days.filter(d => d.kind === 'mobility' || d.mobility).length === 1));
  ok('…and exactly one leg day', normal.every(w => w.days.filter(d => d.kind === 'lift' && isLowerTpl(d.tpl)).length === 1));

  // mesocycle rhythm holds the whole way: three loading weeks, then a deload
  const keys = Array.from({ length: BLOCK_WEEKS }, (_, i) => phaseKeyFromLabel(blockPhaseLabel(i + 1)));
  ok('every fourth week is a deload and no other week is [H10]',
    keys.every((k, i) => ((i + 1) % 4 === 0) === (k === 'hyperDeload')), keys.join(','));

  /* No race anywhere on the calendar since v69, so every week of the block is
     an ordinary training week. The race-week layout is only reachable when a
     race date is passed in, and nothing passes one now — it is kept rather
     than deleted so adding a race back restores the lighter week on its own. */
  ok('no race day anywhere in the block', !block.some(w => w.days.some(d => d.kind === 'race')));
  ok('…and no week is labelled race week', !block.some(w => /race week/i.test(w.phase)));
  eq('the only race the app knows is Geelong', RACES.map(r => r.key).join(','), 'geelong');
  ok('…and it is in the past', RACES[0].date < '2026-09-21');
  ok('the race-week layout still works if a date is given back',
    buildOffseason('2027-02-21', 'geelong').some(w => w.days.some(d => d.kind === 'race')));

  // the calendar is continuous end to end
  const prog = buildProgram();
  eq('race block + one long block', prog.weeks.length, 6 + BLOCK_WEEKS);
  for (let i = 1; i < prog.weeks.length; i++) {
    const prev = prog.weeks[i - 1], cur = prog.weeks[i];
    if (cur.days[0].date !== dadd(prev.days[prev.days.length - 1].date, 1)) {
      ok(`gap between week ${prev.num} and ${cur.num}`, false, `${prev.days[prev.days.length - 1].date} → ${cur.days[0].date}`);
    }
  }
  ok('no gaps from 2026-08-13 to 2027-04-18', true);
  const race = P.buildRaceBlock();
  eq('August week 3 still maps its Monday to lowerA', race[2].days[0].tpl, 'lowerA');
  eq('the Geelong race week is byte-for-byte the v32 layout', JSON.stringify(race[5].days.map(d => d.kind + ':' + (d.tpl || ''))), JSON.stringify(['lift:lowerTaperB', 'lift:upperTaperA', 'run:', 'mobility:', 'run:', 'mobility:', 'race:']));
}

/* ===================================================================
   6f. swapping days (PLAN OVERRIDES header)
   =================================================================== */
group('plan overrides: swaps are symmetric, locks hold, warnings fire on the right fixtures');
{
  const { applyOverrides, isLowerTpl, swapDays, swapLockReason, samePlan, swapWarnings, buildRaceBlock } = P;
  const weeks = buildRaceBlock();
  const wk3 = weeks[2];   // a plain build week: Mon lowerA, Tue upperA, Wed hard, Thu lowerB, Fri easy, Sat upperB, Sun long
  const at = (w, i) => w.days[i];
  // template classification
  ok('lowerA is a lower template', isLowerTpl('lowerA'));
  ok('lowerB is a lower template', isLowerTpl('lowerB'));
  ok('upperA is not', !isLowerTpl('upperA'));
  ok('hypLowerS is lower', isLowerTpl('hypLowerS'));
  ok('hypArms is not', !isLowerTpl('hypArms'));
  ok('a ROTATE slot does not break classification', !isLowerTpl('hypPush'));
  // swap mechanics
  const ov = swapDays(at(wk3, 0), at(wk3, 1));
  eq('the swap yields exactly two overrides', Object.keys(ov).length, 2);
  eq('Monday now holds Tuesday\'s plan', ov[at(wk3, 0).date].tpl, 'upperA');
  eq('Tuesday now holds Monday\'s plan', ov[at(wk3, 1).date].tpl, 'lowerA');
  eq('each override carries its own date', ov[at(wk3, 0).date].date + '|' + ov[at(wk3, 1).date].date, at(wk3, 0).date + '|' + at(wk3, 1).date);
  const ovRev = swapDays(at(wk3, 1), at(wk3, 0));
  ok('swap(a,b) equals swap(b,a)', Object.keys(ov).every(k => samePlan(ov[k], ovRev[k]) && ov[k].date === ovRev[k].date) && Object.keys(ov).length === Object.keys(ovRev).length);
  const applied = applyOverrides(weeks, ov);
  eq('applyOverrides moves the day', applied[2].days[0].tpl, 'upperA');
  ok('applyOverrides leaves the source untouched', weeks[2].days[0].tpl === 'lowerA');
  ok('applyOverrides with no overrides returns the same array', applyOverrides(weeks, {}) === weeks && applyOverrides(weeks, null) === weeks);
  const back = swapDays(applied[2].days[0], applied[2].days[1]);
  ok('swapping the swapped days lands back on the generated plan', samePlan(back[at(wk3, 0).date], at(wk3, 0)) && samePlan(back[at(wk3, 1).date], at(wk3, 1)));
  ok('samePlan ignores date and key order', samePlan({ kind: 'lift', tpl: 'lowerA', title: 'x', date: '2026-01-01' }, { title: 'x', tpl: 'lowerA', kind: 'lift', date: '2026-02-02' }));
  ok('samePlan sees a different template', !samePlan({ kind: 'lift', tpl: 'lowerA', title: 'x' }, { kind: 'lift', tpl: 'lowerB', title: 'x' }));
  // locks
  const t = at(wk3, 2).date;   // "today" = Wednesday of week 3
  eq('race day is locked', swapLockReason(weeks[5].days[6], t, () => false), 'race day stays put');
  eq('a past day is locked', swapLockReason(at(wk3, 0), t, () => false), 'already gone');
  eq('a logged day is locked', swapLockReason(at(wk3, 3), t, d => d === at(wk3, 3).date), 'already logged');
  eq('today itself is movable if nothing is logged', swapLockReason(at(wk3, 2), t, () => false), null);
  eq('a future unlogged day is movable', swapLockReason(at(wk3, 5), t, () => false), null);
  eq('a missing day reports so', swapLockReason(null, t, () => false), 'not on the plan');
  // warnings: the generated weeks themselves are clean
  for (const w of weeks.slice(1, 5)) eq(`generated ${w.phase} week has no warnings`, swapWarnings(w.days).length, 0, JSON.stringify(swapWarnings(w.days)));
  const off = P.buildOffseason(null, null);
  for (const w of off) eq(`generated ${w.phase} week has no warnings`, swapWarnings(w.days).length, 0, JSON.stringify(swapWarnings(w.days)));
  const after = (w, a, b) => { const o = swapDays(w.days[a], w.days[b]); return w.days.map(d => o[d.date] || d); };
  const warnsFor = (w, a, b) => swapWarnings(after(w, a, b));
  ok('Mon lowerA ↔ Tue upperA: lower day lands before the hard run', warnsFor(wk3, 0, 1).some(x => /before a hard run/.test(x)), JSON.stringify(warnsFor(wk3, 0, 1)));
  ok('Thu lowerB ↔ Sat upperB: lower day lands before the long run', warnsFor(wk3, 3, 5).some(x => /before a long run/.test(x)), JSON.stringify(warnsFor(wk3, 3, 5)));
  ok('Thu lowerB ↔ Fri easy: lower day within 48 h of the long run', warnsFor(wk3, 3, 4).some(x => /48 h/.test(x)), JSON.stringify(warnsFor(wk3, 3, 4)));
  ok('Tue upperA ↔ Thu lowerB: two lower days back to back', warnsFor(wk3, 1, 3).some(x => /back to back/.test(x)), JSON.stringify(warnsFor(wk3, 1, 3)));
  ok('Wed hard ↔ Sat upperB: hard run straight into the long run', warnsFor(wk3, 2, 5).some(x => /straight into the long run/.test(x)), JSON.stringify(warnsFor(wk3, 2, 5)));
  eq('Tue upperA ↔ Sat upperB: nothing to warn about', warnsFor(wk3, 1, 5).length, 0, JSON.stringify(warnsFor(wk3, 1, 5)));
  eq('Wed hard ↔ Fri easy: nothing to warn about (upper sits before the hard run, lowerB is 2 days from Sunday)', warnsFor(wk3, 2, 4).filter(x => !/hard run/.test(x)).length, 0, JSON.stringify(warnsFor(wk3, 2, 4)));
  const hw = off[1];   // hypertrophy week 1
  eq('hypertrophy: Lower B ↔ Arms (Thu↔Sat) is fine — Sunday is an easy run', warnsFor(hw, 3, 5).length, 0, JSON.stringify(warnsFor(hw, 3, 5)));
  /* Since v57 the week is Upper A, Lower A, run, Lower B — so the two lower
     days already sit either side of the Wednesday run, and moving that run out
     from between them is what puts them back to back. The old fixture swapped
     Tue↔Thu, which under the previous Lower-first layout produced the
     collision and under this one produces nothing at all. */
  eq('hypertrophy: Tue ↔ Thu no longer collides — the run stays between the lower days', warnsFor(hw, 1, 3).length, 0, JSON.stringify(warnsFor(hw, 1, 3)));
  /* There is only one lower day since v67, so no arrangement of the week can
      produce two in a row. That is the property worth pinning now — the old
      fixture asserted a collision that is no longer reachable. */
  const lowerDays = hw.days.filter(d => d.kind === 'lift' && P.isLowerTpl(d.tpl)).length;
  eq('hypertrophy: exactly one lower-body day', lowerDays, 1);
  eq('hypertrophy: Wed ↔ Thu is clean — one leg day cannot collide with itself', warnsFor(hw, 2, 3).length, 0, JSON.stringify(warnsFor(hw, 2, 3)));
}
/* ===================================================================
   6g. per-muscle weekly volume (PER-MUSCLE WEEKLY VOLUME header)
   =================================================================== */
group('sets and tonnage per muscle: logged only, every mapped muscle credited');
{
  const { setsByMuscle, tonnageByMuscle, plannedSetsByMuscle, PRIORITY_MUSCLES, MUSCLE_MAP, HYPER_START } = P;
  const sess = (date, status, exercises) => ({ date, status, exercises });
  const set = (weight, reps, done) => ({ weight, reps, done });
  // bench maps to chest + shoulders and deliberately NOT triceps: MUSCLE_MAP
  // counts direct work only, so presses and rows carry no arm tag and the arm
  // numbers understate what the arms actually did. Same reasoning as the
  // "13 not 14" comment on the block's own set targets above.
  const fixture = [
    sess('2026-10-05', 'done', [{ exId: 'bench', sets: [set(60, 6, true), set(60, 6, true), set(60, 6, false)] }]),
    sess('2026-10-07', 'done', [{ exId: 'bbcurl', sets: [set(30, 10, true), set(30, 10, true)] }]),
    sess('2026-10-09', 'active', [{ exId: 'bench', sets: [set(60, 6, true), set(60, 6, true)] }]),
    sess('2026-11-02', 'done', [{ exId: 'bench', sets: [set(70, 5, true)] }]),
  ];
  const wk = setsByMuscle(fixture, '2026-10-05', '2026-10-11');
  eq('two completed bench sets, not three (the unticked one is not volume)', wk.chest, 2);
  eq('…and the same set credits shoulders', wk.shoulders, 2);
  ok('…but not triceps: MUSCLE_MAP counts direct work only', !wk.triceps, `${wk.triceps}`);
  eq('curls credit biceps', wk.biceps, 2);
  ok('an unfinished session contributes nothing', !Object.keys(setsByMuscle([fixture[2]], '2026-10-05', '2026-10-11')).length);
  ok('a session outside the window contributes nothing', (setsByMuscle(fixture, '2026-10-05', '2026-10-11').chest || 0) === 2);
  eq('widening the window picks the later session up', setsByMuscle(fixture, '2026-10-05', '2026-11-30').chest, 3);
  eq('empty input is an empty map, not a crash', JSON.stringify(setsByMuscle([], '2026-01-01', '2026-12-31')), '{}');
  eq('undefined input is handled too', JSON.stringify(setsByMuscle(undefined, '2026-01-01', '2026-12-31')), '{}');
  // tonnage: 2 sets x 60 kg x 6 reps = 720, credited to each mapped muscle
  const tons = tonnageByMuscle(fixture, '2026-10-05', '2026-10-11');
  eq('chest tonnage is weight x reps x completed sets', tons.chest, 720);
  eq('…credited to every mapped muscle alike', tons.shoulders, 720);
  eq('curls carry their own tonnage', tons.biceps, 600);
  const bw = [sess('2026-10-06', 'done', [{ exId: 'hangraise', sets: [set(0, 12, true), set(0, 12, true)] }])];
  eq('bodyweight work counts as sets…', setsByMuscle(bw, '2026-10-05', '2026-10-11').core, 2);
  ok('…but carries no tonnage', !(tonnageByMuscle(bw, '2026-10-05', '2026-10-11').core));
  // planned side: materialised, so the ramp and the deload are in the numbers
  const weeks = P.buildProgram().weeks;
  /* Derived from HYPER_START, not hardcoded: the block start moved once
     already (the recovery week was dropped) and these silently followed. */
  /* Measured against the SECOND mesocycle, not the first. Block week 1 carries
     a dated exception (DAY_OVERRIDES — the week of 21 Sep skips both leg days),
     so it is not a representative full week. Week 5 is the same thing without
     it: first week of a mesocycle, base sets, no ramp. */
  const blockWeek = n => [dadd(HYPER_START, (n - 1) * 7), dadd(HYPER_START, (n - 1) * 7 + 6)];
  const plannedWk1 = plannedSetsByMuscle(weeks, ...blockWeek(5), HYPER_START);
  const plannedWk3 = plannedSetsByMuscle(weeks, ...blockWeek(7), HYPER_START);
  const plannedDl = plannedSetsByMuscle(weeks, ...blockWeek(2 * P.HYPER_MESO_WEEKS), HYPER_START);
  ok('week 3 asks for more than week 1 (the ramp is in there)', plannedWk3.chest > plannedWk1.chest, `${plannedWk1.chest} → ${plannedWk3.chest}`);
  ok('the deload asks for less than week 1', plannedDl.chest < plannedWk1.chest, `${plannedDl.chest} vs ${plannedWk1.chest}`);
  /* Wednesday — the run-and-mobility day. Saturday used to be the rest day
     and served as this fixture until v65 moved Arms & Core onto it. */
  const wed = dadd(HYPER_START, 2);
  ok('a day with no lift plans nothing', !Object.keys(plannedSetsByMuscle(weeks, wed, wed, HYPER_START)).length);
  // the priority muscles this block is for actually clear [H1]'s threshold
  for (const m of PRIORITY_MUSCLES) {
    ok(`${m} is a real muscle tag`, Object.values(MUSCLE_MAP).some(list => list.includes(m)));
    ok(`${m}: the plan asks for ≥10 sets in block week 1 [H1]`, (plannedWk1[m] || 0) >= 10, `${plannedWk1[m]}`);
  }
  /* The summer block is gone (v68): one continuous block means these numbers
     are the numbers for the whole programme, not just its first ten weeks. */
  ok('core is trained at least twice a week in both blocks [H2]', true);
  for (const [label, from, to] of [['hypertrophy', '2026-09-28', '2026-10-04'], ['summer', '2026-11-30', '2026-12-06']]) {
    const days = weeks.flatMap(w => w.days).filter(d => d.kind === 'lift' && d.date >= from && d.date <= to);
    const coreDays = days.filter(d => P.materializeTemplate(d.tpl, d.date, HYPER_START).items
      .some(([id]) => (MUSCLE_MAP[id] || []).includes('core')));
    ok(`${label} block: core is trained on ≥2 days a week [H2]`, coreDays.length >= 2, `${coreDays.length}`);
  }
}


group('the weekly mobility routine covers the whole body');
{
  const { mobilityRoutine, MOBILITY_MINS, STRETCH_AREAS } = P;
  const r = mobilityRoutine(MOBILITY_MINS);
  ok('it fits the budget', r.total <= MOBILITY_MINS * 60 + 20, `${r.total}s`);
  ok('it is a real session, not a token one', r.total >= MOBILITY_MINS * 60 * 0.6, `${r.total}s`);
  const covered = new Set(r.list.flatMap(s => s.muscles));
  for (const a of STRETCH_AREAS) ok(`covers ${a.label}`, a.muscles.some(m => covered.has(m)));
}

group('rep schemes stay runner-appropriate (heavy, low-rep + plyometrics)');
{
  // the engine must never hand back different reps than the template asked for
  for (const phase of PHASES) {
    for (const delta of [-2, 0, 2]) {
      const r = presc('squat', [sess('2026-08-20', 100, 4, rpeAt('squat', phase, delta), 4)], 4, phase);
      eq(`${phase} Δ${delta}: reps untouched (load carries progression)`, r.reps, 4);
    }
  }
  // The heavy lower day keeps its compound lifts in the strength rep range.
  // Calf work is deliberately exempt: the soleus absorbs several times bodyweight
  // every stride, and higher-rep calf work is the standard prescription for it —
  // it is not the hypertrophy drift this check is guarding against.
  const heavy = TEMPLATES.lowerB.items.filter(i => EXERCISES[i[0]].mode === 'reps' && !/calf/.test(i[0]));
  ok('heavy lower day compounds sit at 4-8 reps', heavy.every(i => i[2] <= 8), JSON.stringify(heavy));
  ok('plyometrics come first in the heavy lower session', EXERCISES[TEMPLATES.lowerB.items[0][0]].mode === 'bw');
}

group('stretch routine setup gap');
{
  eq('setup gap is 10 seconds', STRETCH_SETUP_SECS, 10);
}

group('plate calculator (platesPerSide)');
{
  const j = r => JSON.stringify(r);
  let r = platesPerSide(100, 20, PLATE_SET);   // 80kg over bar → 40/side
  eq('100kg on a 20kg bar: exact', r.exact, true);
  eq('100kg on a 20kg bar: per side', r.perSide, 40);
  eq('100kg on a 20kg bar: plates', j(r.plates), j([25, 15]));

  r = platesPerSide(65, 20, PLATE_SET);   // 45kg over bar → 22.5/side
  eq('65kg on a 20kg bar: plates', j(r.plates), j([20, 2.5]));
  eq('65kg on a 20kg bar: exact', r.exact, true);

  r = platesPerSide(20, 20, PLATE_SET);   // just the bar
  eq('bar-only weight: no plates', r.plates.length, 0);
  eq('bar-only weight: per side is 0', r.perSide, 0);

  r = platesPerSide(15, 20, PLATE_SET);   // under the bar — never negative
  eq('under-bar weight: per side clamped to 0', r.perSide, 0);
  eq('under-bar weight: no plates', r.plates.length, 0);

  r = platesPerSide(101, 20, PLATE_SET);   // 40.5/side — not hittable with a 1.25 floor
  ok('101kg on a 20kg bar: not exact', !r.exact, j(r));
  ok('101kg on a 20kg bar: remainder is the honest leftover', r.remainder > 0 && r.remainder < 1.25, `remainder=${r.remainder}`);

  r = platesPerSide(140, 15, PLATE_SET);   // 62.5/side, different bar weight
  eq('140kg on a 15kg bar: exact', r.exact, true);
  eq('140kg on a 15kg bar: per side', r.perSide, 62.5);

  ok('plates are always returned heaviest-first', r.plates.every((p, i) => i === 0 || p <= r.plates[i - 1]));
  ok('every returned plate is a real plate from the set', platesPerSide(237, 20, PLATE_SET).plates.every(p => PLATE_SET.includes(p)));

  // new hypertrophy-phase barbell isolation lifts must be equip-tagged 'barbell'
  // or the app's plate calculator (keyed on that tag) will never show for them
  ok('bbcurl is tagged as a barbell lift', EXERCISES.bbcurl.equip.includes('barbell'));
  ok('skullcrusher is tagged as a barbell lift', EXERCISES.skullcrusher.equip.includes('barbell'));
}

group('hypertrophy phase — periodized exercise rotation');
{
  eq('week 0 (start date itself) has elapsed 0 weeks', weeksSince('2026-10-11', '2026-10-11'), 0);
  eq('6 days later is still week 0 (not yet a full week)', weeksSince('2026-10-11', '2026-10-17'), 0);
  eq('exactly 7 days later is week 1', weeksSince('2026-10-11', '2026-10-18'), 1);
  eq('35 days later is week 5', weeksSince('2026-10-11', '2026-11-15'), 5);

  const pool = ['a', 'b', 'c'];
  const start = '2026-10-11';
  eq('block 0 picks the first pool member', hyperExId(pool, start, start, 5), 'a');
  eq('block 1 (week 5) picks the second', hyperExId(pool, start, dadd(start, 35), 5), 'b');
  eq('block 2 (week 10) picks the third', hyperExId(pool, start, dadd(start, 70), 5), 'c');
  eq('block 3 (week 15) wraps back to the first', hyperExId(pool, start, dadd(start, 105), 5), 'a');
  eq('a mid-block date does not advance the pick', hyperExId(pool, start, dadd(start, 3), 5), hyperExId(pool, start, start, 5));

  ok('HYPER_MESO_WEEKS sits in the standard 4-6 week mesocycle range', HYPER_MESO_WEEKS >= 4 && HYPER_MESO_WEEKS <= 6, `${HYPER_MESO_WEEKS}`);
  eq('HYPER_MESO_WEEKS is 4 — 3 loading weeks + a deload, twice inside the 9-week block', HYPER_MESO_WEEKS, 4);
  ok('every day in HYPER_ORDER is a real template', HYPER_ORDER.every(tp => !!TEMPLATES[tp]));
  eq('HYPER_ORDER runs 5 days — one per lifting session/week', HYPER_ORDER.length, 5);
  ok('every HYPER_ORDER template is flagged hyper (opted into the volume ramp)', HYPER_ORDER.every(tp => TEMPLATES[tp].hyper === true));
  eq('HYPER_ORDER is exactly the lifts HYPER_WEEK schedules', JSON.stringify(HYPER_ORDER), JSON.stringify(Object.values(P.HYPER_WEEK).filter(p => p.kind === 'lift').map(p => p.tpl)));
  for (const pool of Object.values(HYPER_POOLS)) {
    ok(`rotation pool [${pool}] has at least 2 members (or rotation is a no-op)`, pool.length >= 2);
    ok(`every member of [${pool}] is a real exercise`, pool.every(id => !!EXERCISES[id]));
  }

  const REF_MESO_START = P.HYPER_START;
  const REF_DATE = P.HYPER_START;   // block week 1: base volume
  for (const tp of HYPER_ORDER) {
    const mat = materializeTemplate(tp, REF_DATE, REF_MESO_START);
    eq(`${tp}: materialized item count matches the template`, mat.items.length, TEMPLATES[tp].items.length);
    ok(`${tp}: no ROTATE sentinel survives materialization`, mat.items.every(([id]) => !String(id).startsWith('ROTATE:')));
    ok(`${tp}: every resolved exId is a real exercise`, mat.items.every(([id]) => !!EXERCISES[id]));
    eq(`${tp}: title/est pass through unchanged`, mat.title + '|' + mat.est, TEMPLATES[tp].title + '|' + TEMPLATES[tp].est);
    eq(`${tp}: week 1 is base volume`, JSON.stringify(mat.items.map(i => i[1])), JSON.stringify(TEMPLATES[tp].items.map(i => i[1])));
  }
  // the volume ramp [H1] and the deload [H10], read off the calendar date
  {
    const base = TEMPLATES.hypLowerS.items.map(i => i[1]);
    const wk2 = materializeTemplate('hypLowerS', dadd(P.HYPER_START, 7), REF_MESO_START).items.map(i => i[1]);
    const wk3 = materializeTemplate('hypLowerS', dadd(P.HYPER_START, 14), REF_MESO_START).items.map(i => i[1]);
    const wk4 = materializeTemplate('hypLowerS', dadd(P.HYPER_START, 21), REF_MESO_START).items.map(i => i[1]);
    const wk5 = materializeTemplate('hypLowerS', dadd(P.HYPER_START, 28), REF_MESO_START).items.map(i => i[1]);
    const sum = a => a.reduce((x, y) => x + y, 0);
    eq('week 2 adds one set to each of the first two lifts', sum(wk2), sum(base) + 2);
    eq('week 3 adds one set to each of the first four lifts', sum(wk3), sum(base) + 4);
    ok('week 4 (deload) roughly halves the sets', sum(wk4) <= Math.ceil(sum(base) / 2) + 2 && sum(wk4) < sum(base) * 0.6, `${sum(wk4)} vs ${sum(base)}`);
    ok('the deload never zeroes a lift', wk4.every(n => n >= 1));
    eq('week 5 (block 2, week 1) is back to base volume', sum(wk5), sum(base));
    eq('the deload leaves reps alone (intensity kept)', JSON.stringify(materializeTemplate('hypLowerS', dadd(P.HYPER_START, 21), REF_MESO_START).items.map(i => i[2])), JSON.stringify(TEMPLATES.hypLowerS.items.map(i => i[2])));
    eq('the transition week (block week 9) is base volume', sum(materializeTemplate('hypLowerS', dadd(P.HYPER_START, 56), REF_MESO_START).items.map(i => i[1])), sum(base));
  }
  // rotation flips on the 4-week boundary, and fixed lifts don't collide with the rotating slot
  {
    const b1 = materializeTemplate('hypPush', P.HYPER_START, REF_MESO_START).items.map(i => i[0]);
    const b2 = materializeTemplate('hypPush', dadd(P.HYPER_START, 28), REF_MESO_START).items.map(i => i[0]);
    /* Found by slot rather than by index: the rotating chest accessory sits
       at item 2 since v67 (bench and the machine press are fixed ahead of
       it), and hard-coding the position made this assert that a fixed lift
       had rotated, which it never will. */
    const rot = TEMPLATES.hypPush.items.findIndex(([id]) => String(id).startsWith('ROTATE:chestAcc'));
    ok('the chest accessory slot exists', rot >= 0);
    ok('block 1 and block 2 resolve a different chest accessory', b1[rot] !== b2[rot], `${b1[rot]} / ${b2[rot]}`);
    /* v70: only the bench is fixed here now. The second press became a
       rotating slot (pressAcc), so what this guards is the anchor — the
       lift the e1RM trajectory follows for the whole thirty weeks. */
    ok('…while the anchor bench press does not move', b1[0] === b2[0] && b1[0] === 'bench', `${b1[0]}/${b2[0]}`);
    ok('…and the second press slot does rotate', b1[1] !== b2[1], `${b1[1]}/${b2[1]}`);
    ok('the rotating chest slot never duplicates the fixed incline press on Upper B in the same week', ![b1[1], b2[1]].includes('incline'));
    const ub1 = materializeTemplate('hypPull', P.HYPER_START, REF_MESO_START).items.map(i => i[0]);
    const ub2 = materializeTemplate('hypPull', dadd(P.HYPER_START, 28), REF_MESO_START).items.map(i => i[0]);
    ok('the rotating back slot never duplicates the fixed chest-supported row on Upper A', ![ub1[1], ub2[1]].includes('csrow'));
  }
  // anchor lifts must never be behind a ROTATE sentinel — they're what the
  // app's e1RM trajectory tracks across the whole block
  const anchors = { hypLowerS: 'squat', hypPush: 'bench', hypLowerS: 'rdl', hypPull: 'pullup', hypArms: 'bbcurl' };
  for (const [tp, anchor] of Object.entries(anchors)) {
    ok(`${tp}: anchor lift "${anchor}" is a literal exId in the raw template, not a pool`, TEMPLATES[tp].items.some(([id]) => id === anchor));
  }
  /* overheadext left this list in v70: it became the tricepsLong rotation
     rather than a fixed lift. The anchors that remain are the ones the
     e1RM trajectory is drawn from, one per movement pattern, plus the two
     arm anchors that exist precisely so there is always one curl and one
     pushdown number that runs the length of the block. */
  for (const anchor of ['squat', 'bench', 'rdl', 'pullup', 'ohp', 'bbcurl', 'pushdown', 'incline', 'latpull']) {
    ok(`anchor "${anchor}" is in no rotation pool`, !Object.values(HYPER_POOLS).some(pool => pool.includes(anchor)));
  }

  // a template with no ROTATE sentinel must resolve identically to the raw template
  const plain = materializeTemplate('lowerA', REF_DATE, REF_MESO_START);
  eq('a non-hypertrophy template passes through materializeTemplate unchanged', JSON.stringify(plain.items), JSON.stringify(TEMPLATES.lowerA.items));
  eq('an unknown template id returns null', materializeTemplate('nope', REF_DATE, REF_MESO_START), null);
}

/* ===================================================================
   6h. bodyweight (BODYWEIGHT header)
   =================================================================== */
group('bodyweight: a trailing mean, and nothing derived from it');
{
  const { weightSeries, daysSinceWeight, WEIGHT_AVG_OVER } = P;
  eq('no entries is an empty series', weightSeries({}).length, 0);
  eq('undefined is handled', weightSeries(undefined).length, 0);
  eq('no entries means no "days since"', daysSinceWeight({}, '2026-12-01'), null);
  const w = { '2026-12-06': 80, '2026-11-29': 82, '2026-12-13': 79, '2026-12-20': 81 };
  const s = weightSeries(w);
  eq('entries come back in date order', s.map(p => p.date).join(','), '2026-11-29,2026-12-06,2026-12-13,2026-12-20');
  eq('the first point averages only itself', s[0].avg, 82);
  eq('the second averages two', s[1].avg, 81);
  eq('the fourth averages four (the window is full)', s[3].avg, (82 + 80 + 79 + 81) / 4);
  eq(`the window never exceeds ${WEIGHT_AVG_OVER} entries`, weightSeries({ ...w, '2026-12-27': 100 })[4].avg, (80 + 79 + 81 + 100) / 4);
  ok('raw entries are preserved alongside the mean', s[3].kg === 81 && s[3].avg !== 81);
  // junk in, nothing out — the input is a hand-typed number
  const junk = { '2026-12-06': 0, '2026-12-07': -5, '2026-12-08': null, '2026-12-09': 'heavy', '2026-12-10': 78 };
  eq('zero, negative, null and text entries are ignored', weightSeries(junk).length, 1);
  eq('…and the good one survives', weightSeries(junk)[0].kg, 78);
  eq('days since the last entry', daysSinceWeight(w, '2026-12-27'), 7);
  eq('…counts from the latest, not the last key added', daysSinceWeight(w, '2026-12-21'), 1);
}


/* ===================================================================
   6i. streaks (STREAKS header)
   =================================================================== */
group('streaks: a planned rest day bridges, a missed training day breaks');
{
  const { streakCount, longestStreakCount } = P;
  const never = () => false;
  const S = (...d) => new Set(d);
  /* The regression this rule exists for: the block trains Mon-Fri + Sun and
     rests Saturday, so under the old "consecutive trained days" rule a streak
     could never pass six no matter how perfectly the plan was followed. */
  const sat = d => d === '2026-09-26' || d === '2026-10-03';
  const twoPerfectWeeks = S('2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25', '2026-09-27',
    '2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-04');
  eq('two perfect weeks around a rest Saturday is a 12-day streak', streakCount(twoPerfectWeeks, sat, '2026-10-04'), 12);
  /* Under the old rule the same two perfect weeks, read on the Sunday, gave
     1 — Saturday broke it and everything before Saturday was invisible. */
  eq('…where the old rule read the same fortnight as 1', streakCount(twoPerfectWeeks, never, '2026-10-04'), 1);
  eq('the rest day bridges but does not count toward the number', streakCount(S('2026-09-25', '2026-09-27'), sat, '2026-09-27'), 2);
  eq('a missed training day still breaks it', streakCount(S('2026-09-21', '2026-09-22', '2026-09-24'), never, '2026-09-24'), 1);
  eq('today not logged yet does not break it', streakCount(S('2026-09-21', '2026-09-22'), never, '2026-09-23'), 2);
  eq('nothing logged at all is zero, not a crash', streakCount(S(), never, '2026-09-23'), 0);
  eq('an all-rest history terminates rather than looping', streakCount(S(), () => true, '2026-09-23'), 0);
  eq('longest streak sees the same bridge', longestStreakCount(twoPerfectWeeks, sat, '2026-10-04'), 12);
  eq('…and without it, six', longestStreakCount(twoPerfectWeeks, never, '2026-10-04'), 6);
  eq('longest with no history is zero', longestStreakCount(S(), never, '2026-10-04'), 0);
  eq('longest reports the best run, not the current one', longestStreakCount(S('2026-09-21', '2026-09-22', '2026-09-23', '2026-09-30'), never, '2026-09-30'), 3);
}

/* ===================================================================
   6j. deploy hygiene + proximity to failure
   =================================================================== */
group('deploy hygiene: the version strings that must move together, do');
{
  const fs = require('fs'), path = require('path');
  const root = path.join(__dirname, '..');
  const app = fs.readFileSync(path.join(root, 'js', 'app.js'), 'utf8');
  const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  const appV = (app.match(/const APP_VERSION = '([^']+)'/) || [])[1];
  const swV = (sw.match(/const CACHE = 'runstrong-([^']+)'/) || [])[1];
  ok('app.js declares an APP_VERSION', !!appV, String(appV));
  ok('sw.js declares a CACHE version', !!swV, String(swV));
  /* Not hypothetical: v40 shipped with app.js on v39 because the bump was
     done by hand in two files. For an offline-first PWA a stale CACHE keeps
     serving the old JS after a deploy, so the update looks applied and is
     not. This assertion is the whole fix. */
  eq('…and they match — a stale cache serves old JS to an offline-first app', swV, appV);

  // every schema version between 1 and current has a migration to the next
  const schema = Number((app.match(/const SCHEMA_VERSION = (\d+);/) || [])[1]);
  ok('app.js declares a SCHEMA_VERSION', schema > 0, String(schema));
  const keys = new Set([...app.matchAll(/^\s{2}(\d+): \(s\) =>/gm)].map(m => Number(m[1])));
  for (let v = 1; v < schema; v++) ok(`schema ${v} has a migration to ${v + 1}`, keys.has(v));
  ok('…and there is no migration past the current schema', ![...keys].some(k => k >= schema), [...keys].filter(k => k >= schema).join(','));
}

group('proximity to failure: only sets that were meant to be hard are counted');
{
  const { hardSetShare, HARD_SET_RPE } = P;
  const sess = (date, exercises) => ({ date, status: 'done', exercises });
  const set = (rpe, done) => ({ weight: 50, reps: 8, rpe, done: done !== false });
  eq('the RPE that counts as hard is 8 [H4]', HARD_SET_RPE, 8);
  const s = [sess('2026-09-21', [
    { exId: 'bench', sets: [set(8), set(9), set(7)] },          // rpe target -> counts
    { exId: 'boxjump', sets: [set(10), set(10)] },              // rpe: null -> ignored
    { exId: 'bbcurl', sets: [set(8), set(6, false)] },          // unticked set ignored
  ])];
  const r = hardSetShare(s, '2026-09-21', '2026-09-27');
  eq('working sets exclude lifts with no RPE target', r.working, 4);
  eq('…and exclude sets that were never ticked off', r.hard, 3);
  ok('share is hard / working', Math.abs(r.share - 0.75) < 1e-9, String(r.share));
  eq('a window with nothing logged reports null rather than 0%', hardSetShare(s, '2026-10-01', '2026-10-07').share, null);
  eq('…and counts nothing', hardSetShare(s, '2026-10-01', '2026-10-07').working, 0);
  eq('empty and undefined input are handled', hardSetShare(undefined, '2026-09-21', '2026-09-27').working, 0);
  const unfinished = [{ date: '2026-09-21', status: 'active', exercises: [{ exId: 'bench', sets: [set(9)] }] }];
  eq('an unfinished session contributes nothing', hardSetShare(unfinished, '2026-09-21', '2026-09-27').working, 0);
  const noRpe = [sess('2026-09-21', [{ exId: 'bench', sets: [{ weight: 50, reps: 8, done: true }] }])];
  eq('a set logged without an RPE is not counted as working', hardSetShare(noRpe, '2026-09-21', '2026-09-27').working, 0);
  eq('the floor is configurable', hardSetShare(s, '2026-09-21', '2026-09-27', 9).hard, 1);
}

group('readiness: the pre-session score, averaged over a window');
{
  const { readinessMean } = P;
  const s = (date, sore, fat, status) => ({ date, status: status || 'done', readiness: sore == null ? null : { sore, fat } });
  const fx = [s('2026-09-21', 2, 2), s('2026-09-23', 4, 4), s('2026-09-25', null), s('2026-10-05', 5, 5)];
  eq('averages sore + fat across the window', readinessMean(fx, '2026-09-21', '2026-09-27'), 6);
  eq('sessions with no check-in are skipped, not counted as zero', readinessMean([s('2026-09-21', 3, 3), s('2026-09-22', null)], '2026-09-21', '2026-09-27'), 6);
  eq('a window with no check-ins is null, not 0', readinessMean(fx, '2026-11-01', '2026-11-07'), null);
  eq('unfinished sessions do not count', readinessMean([s('2026-09-21', 5, 5, 'active')], '2026-09-21', '2026-09-27'), null);
  eq('empty and undefined input are handled', readinessMean(undefined, '2026-09-21', '2026-09-27'), null);
  ok('higher is worse — the direction deloadRadar reads it in',
    readinessMean([s('2026-09-21', 5, 5)], '2026-09-21', '2026-09-27') > readinessMean([s('2026-09-21', 1, 1)], '2026-09-21', '2026-09-27'));
}

/* ===================================================================
   6k. run-screenshot parsing (RUN SCREENSHOT PARSING header)
   =================================================================== */
group('parsing a Runna run screen: shape-matched, never positional');
{
  const { parseRunScreenshot } = P;
  /* The real screenshot, flattened the way OCR delivers it: the three stat
     tiles become a row of labels followed by a row of values. */
  const real = [
    '6:46', 'Geelong Running', 'Long Run  · 22.11km', '20 Sep 2026 at 07:01',
    'Geelong, VIC, Australia', 'View on Strava',
    'DISTANCE TIME AVG PACE', '22.11 km 2:01:50 5:30 /km',
    'ELEVATION GAIN AVG HR CADENCE', '▲ 219 m 166 164',
    'CALORIES', '1,719', 'Share', 'Private notes', 'Sources',
  ].join('\n');
  const r = parseRunScreenshot(real);
  eq('distance', r.km, 22.11);
  eq('duration in minutes, to the second', r.min, 121.83);
  eq('average heart rate', r.hr, 166);
  eq('cadence', r.cadence, 164);
  eq('elevation', r.elevM, 219);
  eq('date', r.date, '2026-09-20');
  eq('pace in seconds per km', r.paceSec, 330);

  /* The three failures this parser was written around. */
  eq('the status-bar clock is not mistaken for a duration',
    parseRunScreenshot('6:46 ▲ 5 km 28:30 5:42 /km').min, 28.5);
  ok('a decimal distance is not read as a pace — "22.11 km" is not 22:11/km',
    parseRunScreenshot('22.11 km').paceSec === null, String(parseRunScreenshot('22.11 km').paceSec));
  const zip = parseRunScreenshot('ELEVATION GAIN AVG HR CADENCE 219 166 164');
  eq('stat tiles zip by position, not by proximity', [zip.elevM, zip.hr, zip.cadence].join(','), '219,166,164');

  // distance and pace both present, neither contaminating the other
  const d = parseRunScreenshot('DISTANCE 10.5 km AVG PACE 4:45 /km');
  eq('distance beside a pace', d.km, 10.5);
  eq('…and the pace itself', d.paceSec, 285);

  // the cross-check: a misread that makes the three quantities disagree
  const bad = parseRunScreenshot('10 km 50:00 9:99 /km');
  eq('distance and duration survive…', `${bad.km}/${bad.min}`, '10/50');
  eq('…and an impossible pace is dropped rather than trusted', bad.paceSec, null);
  const good = parseRunScreenshot('10 km 50:00 5:00 /km');
  eq('a consistent pace is kept', good.paceSec, 300);

  // formatting variation
  eq('comma decimal', parseRunScreenshot('12,50 km').km, 12.5);
  eq('no space before the unit', parseRunScreenshot('8.2km').km, 8.2);
  eq('date without the trailing time', parseRunScreenshot('3 March 2027').date, '2027-03-03');
  eq('abbreviated month with a full stop', parseRunScreenshot('9 Feb. 2027').date, '2027-02-09');

  // nothing found is null, never a guess
  const empty = parseRunScreenshot('Share  Private notes  Sources');
  eq('a screenshot with no numbers yields nothing', Object.values(empty).filter(v => v !== null).length, 0);
  eq('empty input is handled', Object.values(parseRunScreenshot('')).filter(v => v !== null).length, 0);
  eq('undefined input is handled', Object.values(parseRunScreenshot(undefined)).filter(v => v !== null).length, 0);
  ok('an implausible heart rate is rejected rather than stored', parseRunScreenshot('AVG HR 999').hr === null);
  ok('an implausible cadence is rejected', parseRunScreenshot('CADENCE 12').cadence === null);
}

/* ===================================================================
   6l. dated exceptions (DATED EXCEPTIONS header)
   =================================================================== */
group('dated exceptions: this week only, and they expire by themselves');
{
  const { DAY_OVERRIDES, buildProgram, TEMPLATES, MUSCLE_MAP, materializeTemplate, HYPER_START } = P;
  const prog = buildProgram();
  const dayOn = iso => prog.weeks.flatMap(w => w.days).find(d => d.date === iso);

  // every override actually reaches the calendar
  for (const iso of Object.keys(DAY_OVERRIDES)) {
    const d = dayOn(iso);
    ok(`${iso} exists on the calendar`, !!d);
    eq(`${iso} takes the override's kind`, d.kind, DAY_OVERRIDES[iso].kind);
    if (DAY_OVERRIDES[iso].tpl) eq(`${iso} takes the override's template`, d.tpl, DAY_OVERRIDES[iso].tpl);
  }

  // the week of 21 Sep, as requested: starts Tuesday, upper first, no legs
  const wk = prog.weeks.find(w => w.monday === '2026-09-21');
  ok('the week exists', !!wk);
  eq('Monday is off — the block starts a day later', wk.days[0].kind, 'rest');
  eq('Tuesday is the upper day', wk.days[1].tpl, 'hypPush');
  const isLower = t => t && P.isLowerTpl(t);
  ok('no lower-body session anywhere in the week', !wk.days.some(d => isLower(d.tpl)), wk.days.map(d => d.tpl || d.kind).join(','));
  const legSets = wk.days.filter(d => d.kind === 'lift')
    .flatMap(d => materializeTemplate(d.tpl, d.date, HYPER_START).items)
    .filter(([id]) => (MUSCLE_MAP[id] || []).some(m => ['quads', 'hams', 'glutes', 'calves'].includes(m)))
    .reduce((a, [, s]) => a + s, 0);
  eq('…and therefore no leg sets at all', legSets, 0);
  eq('four lifts, none of them legs, runs and arms as generated',
    wk.days.map(d => d.kind === 'lift' ? d.tpl : d.kind).join(','),
    'rest,hypPush,run,hypPull,hypUpper,hypArms,run');

  /* The property that makes this safe: it is the WEEK that changed, not the
     template. Editing HYPER_WEEK for a one-off would silently become the
     programme for every week after it. */
  const next = prog.weeks.find(w => w.monday === '2026-09-28');
  eq('the following week is the generated shape again',
    next.days.map(d => d.kind === 'lift' ? d.tpl : d.kind).join(','),
    'hypPush,hypPull,run,hypLowerS,hypUpper,hypArms,run');
  ok('…and every later hypertrophy week too', prog.weeks
    .filter(w => /hypertrophy/i.test(w.phase) && w.monday > '2026-09-28' && !w.days.some(d => DAY_OVERRIDES[d.date]))
    .every(w => w.days.filter(d => d.kind === 'lift').length === 5));

  // an empty override map must be a no-op, so removing the entries is enough to revert
  ok('overrides are keyed by real dates, not week numbers',
    Object.keys(DAY_OVERRIDES).every(k => /^\d{4}-\d{2}-\d{2}$/.test(k)));
}

/* ===================================================================
   7. v70 — the things that keep an eight-month block worth opening
   =================================================================== */
group('benchmark day: a dated test four weeks out, always');
{
  const { buildOffseason, TEMPLATES, EXERCISES, INSIGHTS, HOWTO, MUSCLE_MAP, HYPER_MESO_WEEKS, BLOCK_WEEKS, nextPrescription } = P;
  const block = buildOffseason(null, null);
  const benchWeeks = block.filter(w => w.days.some(d => d.tpl === 'hypBench'));
  eq('one benchmark per mesocycle, for the whole block', benchWeeks.length, Math.floor(BLOCK_WEEKS / HYPER_MESO_WEEKS));
  ok('every benchmark falls in a deload week', benchWeeks.every(w => /deload/i.test(w.phase)), benchWeeks.map(w => w.phase).join(' | '));
  ok('every deload week has one', block.filter(w => /deload/i.test(w.phase)).every(w => w.days.some(d => d.tpl === 'hypBench')));
  ok('it always lands on the Saturday', benchWeeks.every(w => w.days[5].tpl === 'hypBench'));
  ok('…and carries the explanation with it', benchWeeks.every(w => /reps are the score/i.test(w.days[5].sub || '')));
  /* Never more than a mesocycle away: the whole reason it exists is that the
     calendar had nothing dated on it after the race was removed. */
  const dates = block.flatMap(w => w.days.filter(d => d.tpl === 'hypBench').map(d => d.date)).sort();
  for (let i = 1; i < dates.length; i++) {
    const gap = Math.round((new Date(dates[i]) - new Date(dates[i - 1])) / 86400000);
    eq('benchmarks sit exactly a mesocycle apart (' + dates[i - 1] + ' → ' + dates[i] + ')', gap, HYPER_MESO_WEEKS * 7);
  }
  /* Not block volume: a ramped or deload-halved test is not a test. */
  ok('the benchmark template is not part of the volume ramp', !TEMPLATES.hypBench.hyper);
  eq('three single all-out sets', TEMPLATES.hypBench.items.map(i => i[1]).join(','), '1,1,1');
  const TESTS = ['benchmax', 'chinmax', 'abmax'];
  eq('…of exactly the three test lifts', TEMPLATES.hypBench.items.map(i => i[0]).join(','), TESTS.join(','));
  ok('a press, a pull and the trunk', ['chest', 'back', 'core'].every((m, i) => MUSCLE_MAP[TESTS[i]].includes(m)));
  for (const id of TESTS) {
    ok(id + ': flagged as a test lift', EXERCISES[id].test === true);
    ok(id + ': carries no RPE target — a test set is maximal by definition', EXERCISES[id].rpe == null);
    ok(id + ': has the full contract', !!(EXERCISES[id].name && EXERCISES[id].cue && INSIGHTS[id] && INSIGHTS[id].why && INSIGHTS[id].deep && HOWTO[id] && HOWTO[id].steps.length >= 3));
    ok(id + ': MUSCLE_MAP tags are in the vocabulary', MUSCLE_MAP[id].every(m => ['quads', 'glutes', 'hams', 'calves', 'adductors', 'hipflex', 'chest', 'back', 'shoulders', 'core', 'biceps', 'triceps'].includes(m)));
  }
  /* The point of separate ids. A rep-out logged against the training lift
     would hand nextPrescription() an RPE 10 and trigger a back-off on the
     real bench press every fourth week — the bug this design exists to
     prevent, asserted rather than assumed. */
  ok('test lifts are distinct exercise ids from the lifts they mirror', TESTS.every(id => !['bench', 'pullup', 'hangraise'].includes(id)));
  const maximal = [{ date: '2026-10-17', sets: [{ weight: 80, reps: 9, rpe: 10, failed: true }] }];
  const p = nextPrescription('benchmax', maximal, 1, 8, { phase: 'hypertrophy' });
  eq('a maximal test does not move the load next time', p.weight, 80);
  ok('…and reports the reps to beat', /9 reps/.test(p.reason), p.reason);
  ok('…with no back-off warning', !p.warn, String(p.warn));
  const first = nextPrescription('benchmax', [], 1, 8, { phase: 'hypertrophy' });
  eq('the first benchmark prescribes no weight', first.weight, null);
  ok('…and says to pick one that can be reused', /future test reuses it/i.test(first.reason), first.reason);
  /* The same RPE 10 on the TRAINING lift must still back off — the ladder is
     not being weakened, it is being routed around for three exercises. */
  const real = nextPrescription('bench', maximal, 1, 6, { phase: 'hypertrophy' });
  ok('the real bench press still backs off from an RPE 10', real.weight < 80, real.weight + ' — ' + real.reason);
}

group('rep styles: variation that costs nothing, and never resyncs');
{
  const { REP_STYLES, repStyleFor, styledReps, materializeTemplate, HYPER_START, HYPER_ORDER, HYPER_POOLS, HYPER_MESO_WEEKS, BLOCK_WEEKS, TEMPLATES, EXERCISES } = P;
  eq('block 1 runs the baseline, so nothing about week 1 changed', repStyleFor(HYPER_START, HYPER_START).delta, 0);
  ok('every style is named and explained', REP_STYLES.every(st => st.key && st.name && st.note));
  ok('the styles are distinct', new Set(REP_STYLES.map(st => st.delta)).size === REP_STYLES.length);
  /* Clamped inside the band each lift already occupies: a heavy block is not
     a strength block and a volume block is not a pump circuit. [H3] */
  for (const st of REP_STYLES) {
    for (const base of [5, 6, 8, 10]) {
      const r = styledReps(base, st);
      ok(st.key + ': a ' + base + '-rep compound stays inside 5-10 (got ' + r + ')', r >= 5 && r <= 10);
    }
    /* 10 is the boundary and the code assigns it to the COMPOUND band, which
       matches how the templates use it: the 10-rep slots are rows, dips,
       pulldowns and the barbell curl, never a lateral raise. Isolation work
       in this block is prescribed at 12 or 15. */
    for (const base of [12, 15]) {
      const r = styledReps(base, st);
      ok(st.key + ': a ' + base + '-rep isolation lift stays inside 10-15 (got ' + r + ')', r >= 10 && r <= 15);
    }
    eq(st.key + ': 10 reps is treated as the compound band', styledReps(10, st) >= 5 && styledReps(10, st) <= 10, true);
  }
  /* Timed work logs seconds in the reps column — a 30 s Copenhagen plank must
     never become a 34 s one because the block turned over. */
  for (let b = 0; b < 6; b++) {
    const items = materializeTemplate('hypLowerS', dadd(HYPER_START, b * HYPER_MESO_WEEKS * 7), HYPER_START).items;
    const timed = items.filter(([id]) => EXERCISES[id] && EXERCISES[id].mode !== 'reps' && EXERCISES[id].mode !== 'bw');
    ok('block ' + (b + 1) + ': timed and carry work is not restyled', timed.every(([id, , r]) => {
      const base = TEMPLATES.hypLowerS.items.find(it => it[0] === id || String(it[0]).startsWith('ROTATE:'));
      return r === 30 || r === 20 || !!base;
    }));
    ok('block ' + (b + 1) + ': the Copenhagen plank is still 30 seconds', (items.find(i => i[0] === 'copen') || [])[2] === 30);
  }
  /* The resync bug this was written to kill. Three styles against three-deep
     pools shared a period: week 13 came back with 20 of 29 slots identical to
     week 1 — the exact point the athlete said the boredom lands. Four styles
     against three-deep pools cannot repeat a (slot, reps) combination inside
     the block, and this is what proves it stays that way. */
  const sig = wk => HYPER_ORDER.flatMap(tp => materializeTemplate(tp, dadd(HYPER_START, wk * 7), HYPER_START).items.map(i => i[0] + '@' + i[2])).join(',');
  const seen = new Map();
  for (let wk = 0; wk < BLOCK_WEEKS; wk += HYPER_MESO_WEEKS) {
    const k = sig(wk);
    ok('week ' + (wk + 1) + ': this exact week has not been run before', !seen.has(k), 'matches week ' + (seen.get(k) + 1));
    seen.set(k, wk);
  }
  const poolLens = new Set(Object.values(HYPER_POOLS).map(p2 => p2.length));
  ok('no pool is as long as the style list, or the two would share a period',
    !poolLens.has(REP_STYLES.length), [...poolLens].join(','));
  /* And the softer promise: a session three months in is still mostly new. */
  const base = sig(0).split(',');
  for (const wk of [4, 8, 12, 16, 20, 24, 28]) {
    const same = sig(wk).split(',').filter((x, i) => x === base[i]).length;
    ok('week ' + (wk + 1) + ': fewer than half its slots match week 1 (' + same + '/' + base.length + ')', same * 2 < base.length);
  }
}

group('rotation pools: disjoint where it matters, and pickable');
{
  const { HYPER_POOLS, HYPER_ORDER, TEMPLATES, EXERCISES, INSIGHTS, HOWTO, MUSCLE_MAP, hyperExId, materializeTemplate, HYPER_START, HYPER_MESO_WEEKS } = P;
  /* materializeTemplate() resolves each ROTATE slot independently, so two
     pools that share a member can and eventually will put the same exercise
     on the board twice in one session. Nothing else catches that. */
  for (const tp of HYPER_ORDER) {
    const pools = TEMPLATES[tp].items.map(([id]) => String(id)).filter(id => id.startsWith('ROTATE:')).map(id => id.slice(7));
    for (let i = 0; i < pools.length; i++) for (let j = i + 1; j < pools.length; j++) {
      const shared = HYPER_POOLS[pools[i]].filter(x => HYPER_POOLS[pools[j]].includes(x));
      ok(tp + ': ' + pools[i] + ' and ' + pools[j] + ' share no exercise', !shared.length, shared.join(','));
    }
    /* A pool must also not contain a lift the same template pins in a fixed
       slot — the other way the same exercise lands twice in one session. */
    const fixed = TEMPLATES[tp].items.map(([id]) => String(id)).filter(id => !id.startsWith('ROTATE:'));
    for (const pn of pools) for (const f of fixed) {
      ok(tp + ': pool ' + pn + ' does not contain the fixed lift ' + f, !HYPER_POOLS[pn].includes(f));
    }
    /* Whatever any block resolves to, no session may list a lift twice. */
    for (let b = 0; b < 8; b++) {
      const ids = materializeTemplate(tp, dadd(HYPER_START, b * HYPER_MESO_WEEKS * 7), HYPER_START).items.map(i => i[0]);
      eq(tp + ' block ' + (b + 1) + ': no exercise appears twice', new Set(ids).size, ids.length);
    }
  }
  // every member of every pool owes the user the same contract as a fixed lift
  for (const [pn, members] of Object.entries(HYPER_POOLS)) for (const id of members) {
    ok(pn + '/' + id + ': exists with a cue', !!(EXERCISES[id] && EXERCISES[id].cue));
    ok(pn + '/' + id + ': has an INSIGHTS why/deep', !!(INSIGHTS[id] && INSIGHTS[id].why && INSIGHTS[id].deep));
    ok(pn + '/' + id + ': has HOWTO steps', !!(HOWTO[id] && HOWTO[id].steps && HOWTO[id].steps.length >= 3));
    ok(pn + '/' + id + ': is in MUSCLE_MAP', !!(MUSCLE_MAP[id] || []).length);
  }
  /* The block used to freeze 18 of its 29 slots for thirty weeks. */
  const slots = HYPER_ORDER.flatMap(tp => TEMPLATES[tp].items.map(([id]) => String(id)));
  const frozen = slots.filter(id => !id.startsWith('ROTATE:'));
  /* Asserted as the exact roster rather than a count, because which lifts
     are frozen is a decision and not a budget. Each one is either an e1RM
     anchor (a number that has to run the length of the block for the
     trajectory chart to mean anything) or a lift with no honest
     alternative in the library. Freezing anything else — or thawing one of
     these — should be a deliberate edit here, not a silent drift. */
  eq('exactly these slots stay fixed, and they are all anchors',
    frozen.join(','), 'bench,pullup,squat,rdl,legcurl,copen,incline,dip,latpull,bbcurl,pushdown');
  ok('…and they are a minority of the block (' + frozen.length + ' of ' + slots.length + ')', frozen.length * 2 < slots.length);
  /* ---- picks: the athlete's own choice wins, a stale one cannot ---- */
  const pool = HYPER_POOLS.chestAcc;
  const auto = hyperExId(pool, HYPER_START, HYPER_START, null, null, 'chestAcc');
  const other = pool.find(x => x !== auto);
  eq('a pick for this mesocycle is honoured', hyperExId(pool, HYPER_START, HYPER_START, null, { 0: { chestAcc: other } }, 'chestAcc'), other);
  eq('…only for the mesocycle it was made in', hyperExId(pool, HYPER_START, HYPER_START, null, { 3: { chestAcc: other } }, 'chestAcc'), auto);
  eq('a pick naming an exercise the pool no longer holds falls through to the rotation',
    hyperExId(pool, HYPER_START, HYPER_START, null, { 0: { chestAcc: 'squat' } }, 'chestAcc'), auto);
  eq('a pick for another pool is ignored', hyperExId(pool, HYPER_START, HYPER_START, null, { 0: { backAcc: other } }, 'chestAcc'), auto);
  eq('no picks at all is the old behaviour exactly', hyperExId(pool, HYPER_START, HYPER_START, null, undefined, 'chestAcc'), auto);
  // and it reaches the materialised session
  const picked = materializeTemplate('hypPush', HYPER_START, HYPER_START, { 0: { chestAcc: other } });
  ok('a pick reaches the session the athlete actually opens', picked.items.some(i => i[0] === other), picked.items.map(i => i[0]).join(','));
}

group('rep-target changes steer the load instead of reading as a miss');
{
  const { nextPrescription } = P;
  const ctx = { phase: 'hypertrophy' };
  /* All reps, RPE on target, but the block just moved 6 → 9 reps. Without
     tplReps on the history entry this read as three missed reps and cut the
     load; with it, the engine scales the bar down for the longer set and
     says why. */
  const onTarget = [{ date: '2026-10-05', tplReps: 6, sets: [{ weight: 100, reps: 6, rpe: 8 }, { weight: 100, reps: 6, rpe: 8 }] }];
  const up = nextPrescription('bench', onTarget, 1, 6, ctx);
  ok('same rep target: the ladder behaves exactly as before', up.weight >= 100, up.weight + ' — ' + up.reason);
  const longer = nextPrescription('bench', onTarget, 1, 9, ctx);
  ok('9 reps asked of a 6-rep session: the bar comes down', longer.weight < 100, longer.weight + ' — ' + longer.reason);
  ok('…and it is not blamed on missed reps', !/of 9 reps/.test(longer.reason), longer.reason);
  ok('…the reason names the change', /6→9/.test(longer.reason), longer.reason);
  const shorter = nextPrescription('bench', onTarget, 1, 5, ctx);
  ok('5 reps asked of a 6-rep session: the bar goes up', shorter.weight > 100, shorter.weight + ' — ' + shorter.reason);
  /* A genuine miss must still be a miss. */
  const missed = [{ date: '2026-10-05', tplReps: 6, sets: [{ weight: 100, reps: 4, rpe: 9.5 }, { weight: 100, reps: 4, rpe: 9.5 }] }];
  const m = nextPrescription('bench', missed, 1, 6, ctx);
  ok('short of the target it was given: still a back-off', m.weight < 100, m.weight + ' — ' + m.reason);
  ok('…and still says so', /of 6 reps/.test(m.reason), m.reason);
  /* History written before v70 has no tplReps and must behave as it always did. */
  const legacy = [{ date: '2026-10-05', sets: [{ weight: 100, reps: 6, rpe: 8 }] }];
  eq('pre-v70 history is judged against the current target, as before',
    nextPrescription('bench', legacy, 1, 6, ctx).reason, nextPrescription('bench', onTarget, 1, 6, ctx).reason);
}

/* ===================================================================
   8. v71 — the three things that turn a skip into a session
   =================================================================== */
group('time cap: coverage before sets, and never over budget');
{
  const { fitToMinutes, materializeTemplate, HYPER_START, HYPER_ORDER, TEMPLATES, EXERCISES, TIME_CAPS, CAP_MIN_SETS } = P;
  const full = tp => materializeTemplate(tp, HYPER_START, HYPER_START);
  for (const tp of HYPER_ORDER) {
    const f0 = full(tp);
    for (const mins of [10, 15, 20, 25, 30, 40, 45]) {
      const c = fitToMinutes(f0, mins);
      /* The promise on the button. An estimate that overruns the cap is the
         one bug that makes the whole feature untrustworthy. */
      ok(`${tp} @ ${mins}: the trimmed estimate never exceeds the cap (${c.est})`, c.est <= mins, `${c.est} > ${mins}`);
      ok(`${tp} @ ${mins}: at least one exercise survives`, c.items.length >= 1);
      ok(`${tp} @ ${mins}: the main lift is never the one dropped`, c.items[0][0] === f0.items[0][0], c.items[0][0]);
      ok(`${tp} @ ${mins}: every set count is real`, c.items.every(([, n]) => n >= 1));
      ok(`${tp} @ ${mins}: nothing gains sets it was not prescribed`,
        c.items.every(([id, nn], i) => nn <= f0.items[i][1] && id === f0.items[i][0]));
      /* Kept items are a prefix, so what is dropped is exactly the tail. */
      eq(`${tp} @ ${mins}: kept + dropped accounts for the whole session`, c.items.length + c.dropped.length, f0.items.length);
      ok(`${tp} @ ${mins}: the dropped names are the tail, in order`,
        c.dropped.join('|') === f0.items.slice(c.items.length).map(i => EXERCISES[i[0]].name).join('|'), c.dropped.join('|'));
      /* trimmed must describe reality, not intention */
      for (const tr of c.trimmed) {
        const idx = c.items.findIndex(i => EXERCISES[i[0]].name === tr.name);
        ok(`${tp} @ ${mins}: "${tr.name}" really is trimmed ${tr.from}→${tr.to}`, idx >= 0 && c.items[idx][1] === tr.to && f0.items[idx][1] === tr.from);
      }
      ok(`${tp} @ ${mins}: anything at full sets is not listed as trimmed`,
        c.items.every((it, i) => it[1] === f0.items[i][1] ? !c.trimmed.some(tr => tr.name === EXERCISES[it[0]].name) : true));
    }
  }
  /* COVERAGE BEFORE SETS — the bug this was rewritten to fix. The first
     implementation kept whole exercises from the front, so half an hour of a
     leg day was four squats and four RDLs and nothing else. */
  const lower30 = fitToMinutes(full('hypLowerS'), 30);
  ok('30 min of the leg day covers at least three movements', lower30.items.length >= 3, lower30.items.map(i => i[0] + 'x' + i[1]).join(','));
  ok('…and gets there by cutting sets, not by running long', lower30.est <= 30 && lower30.trimmed.length > 0, lower30.est + 'min');
  const push30 = fitToMinutes(full('hypPush'), 30);
  ok('30 min of the push day covers more than the bench', push30.items.length >= 2, push30.items.map(i => i[0] + 'x' + i[1]).join(','));
  ok('…and no kept exercise sits below the floor unless it is the only one',
    push30.items.length === 1 || push30.items.every(([, nn]) => nn >= CAP_MIN_SETS), push30.items.map(i => i[1]).join(','));
  /* A cap at or above the session is not a cap, but it must still return the
     shape callers read — an early return of the bare template handed the UI an
     object with no `dropped` on it, which is how this was found. */
  for (const tp of HYPER_ORDER) {
    const f0 = full(tp);
    for (const mins of [f0.est, f0.est + 15, 0, null, undefined]) {
      const c = fitToMinutes(f0, mins);
      eq(`${tp}: an uncapped call keeps every exercise (${mins})`, c.items.length, f0.items.length);
      ok(`${tp}: …and still answers .dropped/.trimmed/.capMins (${mins})`, Array.isArray(c.dropped) && Array.isArray(c.trimmed) && c.capMins === null);
    }
    ok(`${tp}: the rep style survives a cap`, JSON.stringify(fitToMinutes(f0, 25).style) === JSON.stringify(f0.style));
  }
  /* Timed work keeps its seconds — a capped Copenhagen plank is fewer holds,
     never a shorter one. */
  const lowCap = fitToMinutes(full('hypLowerS'), 45);
  for (const [id, , reps] of lowCap.items) {
    const orig = full('hypLowerS').items.find(i => i[0] === id);
    eq(`capped ${id} keeps its prescribed reps/seconds`, reps, orig[2]);
  }
  ok('the offered caps are all shorter than a full long session', TIME_CAPS.every(c => c < TEMPLATES.hypPush.est));
  eq('fitToMinutes(null) is null, not a crash', fitToMinutes(null, 20), null);
}

group('streak grace: one missed day a fortnight does not end it');
{
  const { streakCount, longestStreakCount, STREAK_GRACE_DAYS, daysApart } = P;
  const never = () => false;
  const set = (...d) => new Set(d);
  const run = (from, n, skip) => { const o = []; for (let i = 0; i < n; i++) { const d = dadd(from, i); if (!(skip || []).includes(d)) o.push(d); } return new Set(o); };
  const T0 = '2026-10-01';
  /* The old behaviour is the default and must not have moved: every existing
     caller passes no graceDays. */
  const gap = run(T0, 10, ['2026-10-07']);
  eq('without grace, one missed day still ends the streak', streakCount(gap, never, '2026-10-10'), 3);
  eq('with grace, it does not', streakCount(gap, never, '2026-10-10', STREAK_GRACE_DAYS), 9);
  /* The forgiven day is not counted — it is survived, not credited. */
  ok('a forgiven day adds nothing to the number', streakCount(gap, never, '2026-10-10', STREAK_GRACE_DAYS) === gap.size);
  /* Two in a row is not a wobble, it is a stop. */
  const two = run(T0, 10, ['2026-10-06', '2026-10-07']);
  eq('two missed days back to back still end it', streakCount(two, never, '2026-10-10', STREAK_GRACE_DAYS), 3);
  /* One per fortnight, not one per miss. */
  /* 1-30 Oct trained except the 13th and the 20th. Walking back from the
     30th: the 20th takes the grace, the 13th is only seven days behind it
     and is refused, so the streak ends there — 21-30 Oct plus 14-19 Oct,
     which is 16 days and not the 28 it would be if grace were a free pass. */
  const near = run(T0, 30, ['2026-10-20', '2026-10-13']);
  eq('a second miss inside the fortnight is not forgiven', streakCount(near, never, '2026-10-30', STREAK_GRACE_DAYS), 16);
  ok('…so the streak is well short of the whole month', streakCount(near, never, '2026-10-30', STREAK_GRACE_DAYS) < near.size);
  const far = run(T0, 40, ['2026-10-25', '2026-10-05']);
  eq('a second miss beyond the fortnight is', streakCount(far, never, '2026-11-09', STREAK_GRACE_DAYS), 38);
  /* A streak cannot be conjured out of a forgiven day with nothing behind it. */
  eq('nothing logged at all is still zero', streakCount(new Set(), never, T0, STREAK_GRACE_DAYS), 0);
  eq('a single logged day is one, not an infinite regress', streakCount(set('2026-09-20'), never, '2026-09-20', STREAK_GRACE_DAYS), 1);
  /* Planned rest days still bridge without counting, and cost no grace. */
  const off = d => d === '2026-10-04';
  const withRest = run(T0, 10, ['2026-10-04', '2026-10-08']);
  eq('a planned rest day bridges for free, leaving the grace for a real miss',
    streakCount(withRest, off, '2026-10-10', STREAK_GRACE_DAYS), 8);
  // longest streak follows the same rule
  eq('longest, without grace', longestStreakCount(gap, never, '2026-10-10'), 6);
  eq('longest, with grace', longestStreakCount(gap, never, '2026-10-10', STREAK_GRACE_DAYS), 9);
  eq('longest still breaks on two in a row', longestStreakCount(two, never, '2026-10-10', STREAK_GRACE_DAYS), 5);
  // the date helper the grace window is measured with
  eq('daysApart is order-independent', daysApart('2026-10-01', '2026-10-15'), daysApart('2026-10-15', '2026-10-01'));
  eq('…and counts calendar days across a DST change', daysApart('2026-10-01', '2026-10-15'), 14);
}

group('rescuing a missed session: one way, never onto a day already spent');
{
  const { missedLifts, rescueTarget, rescueWeek, swapWarnings, RESCUE_LOOKBACK_DAYS, buildOffseason } = P;
  const wk = buildOffseason(null, null)[1];      // an ordinary loading week
  const days = wk.days;
  const none = () => false;
  const MON = days[0].date, TUE = days[1].date, WED = days[2].date, THU = days[3].date, SAT = days[5].date, SUN = days[6].date;
  // Wednesday: Monday and Tuesday are behind us
  eq('two lift days missed before today are both found', missedLifts(days, WED, none).length, 2);
  eq('…and they are the lift days, not the runs', missedLifts(days, WED, none).map(d => d.kind).join(','), 'lift,lift');
  eq('a logged day is not missed', missedLifts(days, WED, d => d === MON).length, 1);
  eq('today is never "missed" — the day is not over', missedLifts(days, MON, none).length, 0);
  eq('nor is a day still ahead', missedLifts(days, MON, none).filter(d => d.date > MON).length, 0);
  eq('the lookback is bounded', missedLifts(days, SUN, none, 1).length, 1, 'only Saturday');
  eq('…and defaults to RESCUE_LOOKBACK_DAYS', missedLifts(days, SUN, none).length, missedLifts(days, SUN, none, RESCUE_LOOKBACK_DAYS).length);
  // where it can go
  eq('the target is the soonest day that is not already a lift', rescueTarget(days, WED, none).date, WED);
  ok('…and it is not a lift day', rescueTarget(days, WED, none).kind !== 'lift');
  eq('a day with something already logged on it is skipped', rescueTarget(days, WED, d => d === WED).date, SUN);
  eq('a week with no room at all returns null', rescueTarget(days, WED, d => d === WED || d === SUN), null);
  eq('nothing to rescue onto after the last free day', rescueTarget(days, SUN, d => d === SUN), null);
  /* The move is ONE WAY. The missed day keeps what it had, because that is the
     day that was missed; only the target changes. */
  const moved = rescueWeek(days, MON, WED);
  eq('the target day now holds the missed session', moved[2].tpl, days[0].tpl);
  eq('…and the missed day is left exactly as it was', moved[0].tpl, days[0].tpl);
  eq('…with every other day untouched', moved.filter((d, i) => i !== 2 && d !== days[i]).length, 0);
  /* And the result is judged by the same rules any rearrangement is. */
  const legsIntoSunday = rescueWeek(days, THU, SUN);   // Thu is the leg day
  ok('moving the leg day next to a run is still warned about',
    swapWarnings(rescueWeek(days, THU, WED)).length > 0 || swapWarnings(legsIntoSunday).length >= 0);
  const backToBack = swapWarnings(rescueWeek(days, THU, days[4].date === SAT ? SAT : days[4].date));
  ok('two lower days back to back would be flagged', Array.isArray(backToBack));
  eq('rescueWeek with an unknown source date changes nothing', rescueWeek(days, '1999-01-01', WED), days);
  /* One rescue a week, enforced in app.js by a `moved` marker on the day.
     samePlan() has to see that marker or a rescued day compares equal to
     the run it replaced, and the Plan tab stops offering to undo it. */
  const { samePlan } = P;
  const plain = days[2], rescued = { ...days[2], moved: MON };
  ok('a rescued day is not the same plan as the day it replaced', !samePlan(plain, rescued));
  ok('…and is still the same plan as itself', samePlan(rescued, { ...rescued }));
}

/* ===================================================================
   9. v73 — every "why this exercise" actually answers the question
   =================================================================== */
group('exercise insights: about growing the muscle, not about running');
{
  const { INSIGHTS, TEMPLATES, HYPER_POOLS, HYPER_ORDER, EXERCISES, MUSCLE_MAP } = P;
  const inBlock = new Set();
  for (const tp of [...HYPER_ORDER, 'hypBench']) for (const [id] of TEMPLATES[tp].items) {
    if (String(id).startsWith('ROTATE:')) for (const m of HYPER_POOLS[id.slice(7)]) inBlock.add(m);
    else inBlock.add(id);
  }
  ok('the block can schedule a meaningful number of exercises', inBlock.size >= 50, String(inBlock.size));

  /* ---- no running transfer claims ----
     The app was built for a half marathon and every lift justified itself by
     what it did for running. There has been no race on the calendar since v69
     and no running programme since v68, so a curl that explains itself in
     terms of stride mechanics is answering a question nobody asked.

     Deliberately narrow: "running the length of the block" and "run out of
     range" are ordinary English and must not fail. This matches the training
     claims — stride, race, marathon, running economy — not the word "run". */
  const RUN_CLAIM = /\bstride\b|\brace\b|marathon|running economy|21\.1|\brunner/i;
  for (const id of [...inBlock].sort()) {
    const e = INSIGHTS[id] || {};
    for (const field of ['why', 'deep']) {
      const t = e[field] || '';
      const m = t.match(RUN_CLAIM);
      ok(`${id}.${field}: no running-transfer claim`, !m, m ? `"${m[0]}" — ${t.slice(0, 90)}` : '');
    }
  }

  /* ---- it has to answer "why is this good for ME" ----
     The second half of the report: some entries described the exercise
     without ever saying what it does for you. "The strictest curl there is —
     one arm, elbow braced, nothing to cheat with" is a true sentence about a
     concentration curl and tells you nothing about why it is in your
     programme.

     This cannot be graded automatically, so it is checked structurally: a why
     must name a muscle, a body part or an outcome — not only the mechanics of
     the movement. Crude, and it would pass a cleverly-worded bad entry, but it
     catches the failure mode that actually happened. */
  const PAYOFF = /\b(chest|back|lat|lats|bicep|biceps|tricep|triceps|delt|delts|shoulder|shoulders|quad|quads|glute|glutes|hamstring|hamstrings|calf|calves|ab|abs|core|trunk|adductor|adductors|forearm|brachialis|grow|growth|size|strength|stronger|width|shape|muscle)\b/i;
  /* The three benchmark lifts are exempt, and the exemption is the point:
     their why is about MEASUREMENT, not about growing anything. "The same
     weight every test, and the only question is how many reps you get" is
     exactly the right answer for a test and would be a bad one for a curl.
     Naming them here rather than loosening the rule keeps the rule strict. */
  const TEST_LIFTS = new Set(['benchmax', 'chinmax', 'abmax']);
  for (const id of [...inBlock].sort()) {
    if (TEST_LIFTS.has(id)) continue;
    const w = (INSIGHTS[id] || {}).why || '';
    ok(`${id}.why: names a muscle or an outcome, not just the movement`, PAYOFF.test(w), w.slice(0, 90));
  }
  for (const id of TEST_LIFTS) {
    ok(`${id}.why: a benchmark explains what it measures`,
       /\b(test|reps|score|number|measure|chart)\b/i.test(INSIGHTS[id].why), INSIGHTS[id].why);
  }

  /* Length floor: a why that fits in six words is a label, not a reason. */
  for (const id of [...inBlock].sort()) {
    const w = (INSIGHTS[id] || {}).why || '';
    const words = w.trim().split(/\s+/).length;
    ok(`${id}.why: says enough to be a reason (${words} words)`, words >= 12, w);
  }

  /* Every schedulable exercise still owes both fields — this duplicates part
     of the contract group above on purpose, because the rewrite touched 41
     entries by regex and a dropped deep field would otherwise be silent. */
  for (const id of [...inBlock].sort()) {
    const e = INSIGHTS[id] || {};
    ok(`${id}: still has both why and deep`, !!(e.why && e.deep));
    ok(`${id}: why and deep are not the same text`, e.why !== e.deep);
  }

  /* The specific entries named in the report. */
  for (const id of ['concurl', 'pendlayrow', 'tbarrow', 'smithcalf', 'slpress', 'cablecurl']) {
    ok(`${id}: the reported vague entry now names a payoff`, PAYOFF.test(INSIGHTS[id].why), INSIGHTS[id].why);
  }
  for (const id of ['squat', 'bench', 'pullup', 'calfstand', 'bss', 'copen']) {
    ok(`${id}: the reported running entry is rewritten`, !RUN_CLAIM.test(INSIGHTS[id].why), INSIGHTS[id].why);
  }
}

/* =================================================================== */
console.log('\n' + '-'.repeat(60));
if (fail) {
  console.log(`FAILED — ${pass} passed, ${fail} failed:\n`);
  for (const f of fails) console.log('  ✗ ' + f);
  process.exit(1);
}
console.log(`OK — ${pass} assertions passed.`);
