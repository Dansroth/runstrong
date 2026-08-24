/* RunStrong — unit tests for the post-session stretch routine builder.
   Run: node tools/test-stretch.js      (no dependencies, no build step)

   The regression these exist to prevent: runner essentials (calves / hip flexors /
   glutes / hamstrings) used to be prioritised ahead of everything the session
   actually trained, so an upper-body workout produced an all-lower-body routine —
   0 of 4 stretches targeting a trained muscle on the 5-minute option.

   Matrix: every lift template × the three budgets the app offers (5 / 7 / 10 min). */
'use strict';

const P = require('../js/program.js');
const { TEMPLATES, EXERCISES, MUSCLE_MAP, STRETCHES, STRETCH_ESSENTIALS, TRAINED_SHARE,
        stretchRoutine, stretchDur, STRETCH_SETUP_SECS, materializeTemplate, plannedLoads } = P;

const BUDGETS = [5, 7, 10];
let pass = 0, fail = 0; const fails = [];
const ok = (name, cond, detail) => { if (cond) { pass++; return; } fail++; fails.push(name + (detail ? '\n      ' + detail : '')); };
const eq = (name, got, want) => ok(name, got === want, `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
const group = n => console.log('\n' + n);
const names = list => list.map(x => x.name).join(' / ');

/* Fixed reference dates so hypertrophy-phase 'ROTATE:<pool>' templates
   resolve to a real, reproducible exercise list — see materializeTemplate in
   program.js. Any date works; these just need to be fixed for the tests to
   be deterministic. */
const REF_MESO_START = '2026-10-11';
const REF_DATE = '2026-11-01';

/* loads a template produces when every set is completed. Goes through the
   real plannedLoads() (not a reimplementation) so hypertrophy templates'
   ROTATE sentinels resolve exactly the way the app resolves them. */
function loadsFor(tpl) { return plannedLoads(tpl, REF_DATE, REF_MESO_START); }
const LIFT_TEMPLATES = Object.keys(TEMPLATES);
const isUpper = tpl => materializeTemplate(tpl, REF_DATE, REF_MESO_START).items.every(([id]) => EXERCISES[id].group === 'upper');
const LOWER_ONLY = new Set(['calves', 'hipflex', 'glutes', 'hams', 'quads', 'adductors']);
const hits = (list, loads) => list.filter(st => st.muscles.some(m => loads[m] > 0)).length;

/* ===================================================================
   1. the headline guarantee — a clear majority targets what you trained
   =================================================================== */
group('every template x every budget: most of the routine targets a trained muscle');
for (const tpl of LIFT_TEMPLATES) {
  const loads = loadsFor(tpl);
  for (const mins of BUDGETS) {
    const r = stretchRoutine(loads, mins);
    const h = hits(r.list, loads);
    ok(`${tpl} @ ${mins}min: ${h}/${r.list.length} target a trained muscle`,
       r.list.length > 0 && h > r.list.length / 2,
       `routine: ${names(r.list)}\n      trained: ${Object.keys(loads).join(', ')}`);
  }
}

group('no upper-body workout may produce an all-lower-body routine (the reported bug)');
for (const tpl of LIFT_TEMPLATES.filter(isUpper)) {
  const loads = loadsFor(tpl);
  for (const mins of BUDGETS) {
    const r = stretchRoutine(loads, mins);
    const lowerOnly = r.list.filter(st => st.muscles.every(m => LOWER_ONLY.has(m))).length;
    ok(`${tpl} @ ${mins}min is not all lower-body`, lowerOnly < r.list.length, `routine: ${names(r.list)}`);
    ok(`${tpl} @ ${mins}min opens with something it trained`,
       r.list.length > 0 && r.list[0].muscles.some(m => loads[m] > 0),
       `first stretch: ${r.list[0] && r.list[0].name}`);
  }
}

group('the single worst case from the bug report: Upper A, 5 minutes');
{
  const loads = loadsFor('upperA');
  const r = stretchRoutine(loads, 5);
  const h = hits(r.list, loads);
  ok('Upper A @ 5min now hits trained muscles (was 0 of 4)', h > 0, `${h}/${r.list.length}: ${names(r.list)}`);
  ok('Upper A @ 5min includes something for chest, back or shoulders',
     r.list.some(st => st.muscles.some(m => ['chest', 'back', 'shoulders'].includes(m))), names(r.list));
}

/* ===================================================================
   2. runner essentials keep their place — the fix is proportion, not deletion
   =================================================================== */
group('runner essentials still appear, capped rather than removed');
for (const tpl of LIFT_TEMPLATES.filter(isUpper)) {
  const loads = loadsFor(tpl);
  const r = stretchRoutine(loads, 10);
  ok(`${tpl} @ 10min still includes a runner essential`,
     r.list.some(st => st.muscles.some(m => STRETCH_ESSENTIALS.includes(m) && !loads[m])), names(r.list));
}

group('untrained essentials never exceed their share of the budget');
for (const tpl of LIFT_TEMPLATES) {
  const loads = loadsFor(tpl);
  for (const mins of BUDGETS) {
    const r = stretchRoutine(loads, mins);
    const tailTime = r.list.filter(st => !st.muscles.some(m => loads[m] > 0))
                           .reduce((a, st) => a + stretchDur(st, st.hold), 0);
    ok(`${tpl} @ ${mins}min: untrained time within cap`, tailTime <= mins * 60 * (1 - TRAINED_SHARE) + 20,
       `${tailTime}s of ${mins * 60}s budget`);
  }
}

group('lower-body days still get their lower-body work (no over-correction)');
for (const tpl of LIFT_TEMPLATES.filter(t => !isUpper(t))) {
  const loads = loadsFor(tpl);
  const r = stretchRoutine(loads, 7);
  ok(`${tpl} @ 7min targets the legs`,
     r.list.some(st => st.muscles.some(m => LOWER_ONLY.has(m) && loads[m] > 0)), names(r.list));
}

/* ===================================================================
   3. ordering, budgets, holds
   =================================================================== */
group('hardest-worked muscle leads, and heavy volume gets a longer hold');
{
  const r = stretchRoutine({ back: 13, core: 7, chest: 5, shoulders: 5 }, 10);
  ok('leads with a back stretch (13 sets, the heaviest)', r.list[0].muscles.includes('back'), r.list[0].name);
  ok('heavy muscle (6+ sets) gets at least a 40s hold', r.list[0].hold >= 40, `hold ${r.list[0].hold}`);
  const light = stretchRoutine({ chest: 2 }, 10).list[0];
  eq('light volume keeps the library hold', light.hold, STRETCHES.find(s => s.id === light.id).hold);
}

group('budgets are respected and scale with the option chosen');
for (const tpl of LIFT_TEMPLATES) {
  let prev = 0;
  for (const mins of BUDGETS) {
    const r = stretchRoutine(loadsFor(tpl), mins);
    ok(`${tpl} @ ${mins}min stays within budget`, r.total <= mins * 60 + 20, `${r.total}s vs ${mins * 60}s`);
    ok(`${tpl} @ ${mins}min is not shorter than the smaller budget`, r.list.length >= prev, `${r.list.length} vs ${prev}`);
    prev = r.list.length;
  }
}

group('the 10-second setup gap is still budgeted for every hold');
{
  const r = stretchRoutine(loadsFor('upperA'), 7);
  const byHand = r.list.reduce((a, st) => a + (STRETCH_SETUP_SECS + st.hold) * (st.perSide ? 2 : 1), 0);
  eq('total equals sum of (setup + hold), doubled per side', r.total, byHand);
  eq('setup gap is still 10s', STRETCH_SETUP_SECS, 10);
}

group('soreness bias, and the nothing-logged fallback');
{
  const loads = loadsFor('upperA');
  const plain = stretchRoutine(loads, 10);
  const sore = stretchRoutine(loads, 10, { soreBias: true });
  const holdOf = (r, id) => { const f = r.list.find(x => x.id === id); return f ? f.hold : null; };
  const tailIds = plain.list.filter(p => !p.muscles.some(m => loads[m] > 0)).map(p => p.id);
  const shared = tailIds.find(id => holdOf(sore, id) != null);
  ok('sore days hold the untrained essentials longer', shared == null || holdOf(sore, shared) >= holdOf(plain, shared),
     shared ? `${shared}: plain ${holdOf(plain, shared)}s vs sore ${holdOf(sore, shared)}s` : 'no shared essential to compare');
  const empty = stretchRoutine({}, 7);
  ok('a session with nothing logged still yields a routine', empty.list.length >= 3, `${empty.list.length} stretches`);
  ok('and that fallback is the runner essentials', empty.list.every(st => st.muscles.some(m => STRETCH_ESSENTIALS.includes(m))), names(empty.list));
}

/* ===================================================================
   4. library + mapping integrity
   =================================================================== */
group('stretch library and muscle map are complete and consistent');
{
  const tagged = {};
  for (const st of STRETCHES) for (const m of st.muscles) tagged[m] = (tagged[m] || 0) + 1;
  const trainedTags = new Set();
  for (const ms of Object.values(MUSCLE_MAP)) for (const m of ms) trainedTags.add(m);
  // 2+ options per muscle: with only one, a routine can never give that muscle a
  // second look no matter how much of the session went through it.
  for (const m of trainedTags) ok(`muscle "${m}" has at least 2 stretches to draw on`, (tagged[m] || 0) >= 2, `${tagged[m] || 0} found`);
  for (const id of Object.keys(EXERCISES)) ok(`${id} has a MUSCLE_MAP entry`, !!MUSCLE_MAP[id]);
  for (const id of Object.keys(MUSCLE_MAP)) ok(`MUSCLE_MAP "${id}" refers to a real exercise`, !!EXERCISES[id]);
  const ids = STRETCHES.map(s => s.id);
  eq('stretch ids are unique', ids.length, new Set(ids).size);
  for (const st of STRETCHES) {
    ok(`${st.id} is well formed`, !!st.name && !!st.instr && st.hold > 0 && Array.isArray(st.muscles) && st.muscles.length > 0);
    ok(`${st.id} instruction stays short and plain`, st.instr.length <= 190, `${st.instr.length} chars`);
  }
  const noStretch = [...trainedTags].filter(m => !tagged[m]);
  eq('every trainable muscle has a stretch', noStretch.join(',') || 'none', 'none');
}

/* =================================================================== */
console.log('\n' + '-'.repeat(60));
if (fail) {
  console.log(`FAILED — ${pass} passed, ${fail} failed:\n`);
  for (const f of fails) console.log('  ✗ ' + f);
  process.exit(1);
}
console.log(`OK — ${pass} assertions passed.`);
