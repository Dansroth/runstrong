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
  const weeks = buildProgram().weeks.map(w => ({
    num: w.num, phase: w.phase,
    sets: w.days.filter(d => d.kind === 'lift').reduce((a, d) => a + setsOf(d.tpl), 0),
  }));
  const peak = Math.max(...weeks.map(w => w.sets));
  const cutOf = w => Math.round(100 * (1 - w.sets / peak));
  const program = buildProgram();
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
group('program ends on Geelong with an 8-day taper (GEELONG TAPER header)');
{
  const { RACES } = P;
  const prog = buildProgram();
  const last = prog.weeks[prog.weeks.length - 1];
  const lastDay = last.days[last.days.length - 1];
  eq('exactly one race is on the calendar', RACES.length, 1);
  eq('and it is the A race', RACES[0].tag, 'A race');
  eq('the program has 6 weeks', prog.weeks.length, 6);
  eq('the last day of the program is race day', lastDay.date, RACES[0].date);
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
  ok('every day in HYPER_ORDER is a real template', HYPER_ORDER.every(tp => !!TEMPLATES[tp]));
  eq('HYPER_ORDER runs 5 days — one per hypertrophy-phase session/week', HYPER_ORDER.length, 5);
  eq('legs (maintLower) appears exactly once in the weekly rotation', HYPER_ORDER.filter(tp => tp === 'maintLower').length, 1);
  for (const pool of Object.values(HYPER_POOLS)) {
    ok(`rotation pool [${pool}] has at least 2 members (or rotation is a no-op)`, pool.length >= 2);
    ok(`every member of [${pool}] is a real exercise`, pool.every(id => !!EXERCISES[id]));
  }

  const REF_MESO_START = '2026-10-11';
  const REF_DATE = '2026-11-01';
  for (const tp of ['hyperChestTri', 'hyperBackBi', 'hyperShoulderArms', 'hyperChestBack']) {
    const mat = materializeTemplate(tp, REF_DATE, REF_MESO_START);
    eq(`${tp}: materialized item count matches the template`, mat.items.length, TEMPLATES[tp].items.length);
    ok(`${tp}: no ROTATE sentinel survives materialization`, mat.items.every(([id]) => !String(id).startsWith('ROTATE:')));
    ok(`${tp}: every resolved exId is a real exercise`, mat.items.every(([id]) => !!EXERCISES[id]));
    eq(`${tp}: title/est pass through unchanged`, mat.title + '|' + mat.est, TEMPLATES[tp].title + '|' + TEMPLATES[tp].est);
  }
  // anchor lifts must never be behind a ROTATE sentinel — they're what the
  // app's e1RM trajectory tracks across the whole phase
  const anchors = { hyperChestTri: 'bench', hyperBackBi: 'pullup', hyperShoulderArms: 'ohp' };
  for (const [tp, anchor] of Object.entries(anchors)) {
    ok(`${tp}: anchor lift "${anchor}" is a literal exId in the raw template, not a pool`, TEMPLATES[tp].items.some(([id]) => id === anchor));
  }

  // a template with no ROTATE sentinel must resolve identically to the raw template
  const plain = materializeTemplate('lowerA', REF_DATE, REF_MESO_START);
  eq('a non-hypertrophy template passes through materializeTemplate unchanged', JSON.stringify(plain.items), JSON.stringify(TEMPLATES.lowerA.items));
  eq('an unknown template id returns null', materializeTemplate('nope', REF_DATE, REF_MESO_START), null);
}

/* =================================================================== */
console.log('\n' + '-'.repeat(60));
if (fail) {
  console.log(`FAILED — ${pass} passed, ${fail} failed:\n`);
  for (const f of fails) console.log('  ✗ ' + f);
  process.exit(1);
}
console.log(`OK — ${pass} assertions passed.`);
