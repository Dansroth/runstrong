/* RunStrong — unit tests for the pre-session movement prep builder.
   Run: node tools/test-warmup.js      (no dependencies, no build step)

   The regression these exist to prevent, in priority order:

   1. A static stretch leaking into a warm-up. STRETCHES is right there, already
      muscle-tagged, and reusing it is the obvious shortcut — but long static
      holds before a session measurably cut force and power output. Assertion 1
      below is the whole reason this file exists.

   2. All mobilising and no activating. One mobilise item per trained muscle will
      cheerfully eat the entire budget, leaving a routine that is a stretch
      session wearing a warm-up's clothes.

   3. Runner essentials squeezed out — the same failure the post-session routine
      was fixed for. On an upper-body day, calves and hips still take their load
      from running and still need a look.

   4. A warm-up that prescribes running. The product decision is that no jog,
      stride or running drill appears before a run; the first easy kilometre of
      the run is the temperature raise.

   Matrix: every lift template, every run type, across the budgets the app uses. */
'use strict';

const P = require('../js/program.js');
const { TEMPLATES, EXERCISES, MUSCLE_MAP, STRETCHES, STRETCH_ESSENTIALS, TRAINED_SHARE,
        PREPS, PREP_SETUP_SECS, PREP_TIER_ORDER, RUN_LOADS, RUN_PREP_MINS,
        prepRoutine, plannedLoads, runLoads, runType, runPrepMins, stretchDur } = P;

const BUDGETS = [4, 6, 8];
let pass = 0, fail = 0; const fails = [];
const ok = (name, cond, detail) => { if (cond) { pass++; return; } fail++; fails.push(name + (detail ? '\n      ' + detail : '')); };
const eq = (name, got, want) => ok(name, got === want, `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
const group = n => console.log('\n' + n);
const names = list => list.map(x => x.name).join(' / ');

const STRETCH_IDS = new Set(STRETCHES.map(s => s.id));
/* Anything that would have you covering ground. Nothing in PREPS may match. */
const LOCOMOTION = /\b(jog|jogging|run|running|stride|strides|sprint|skip|skips|bound|bounding|lap|laps|treadmill)\b/i;

/* ---------------- library shape ---------------- */
group('Prep library');
{
  const ids = PREPS.map(p => p.id);
  eq('prep ids are unique', ids.length, new Set(ids).size);
  eq('no prep id collides with a stretch id', ids.filter(i => STRETCH_IDS.has(i)).length, 0);

  for (const p of PREPS) {
    ok(`${p.id} is well formed`, !!p.name && !!p.instr && p.work > 0 && Array.isArray(p.muscles) && p.muscles.length > 0);
    ok(`${p.id} has a known tier`, PREP_TIER_ORDER[p.tier] !== undefined, `tier=${p.tier}`);
    ok(`${p.id} instruction stays short and plain`, p.instr.length <= 190, `${p.instr.length} chars`);
    ok(`${p.id} is not held long enough to blunt the session`, p.work <= 45, `${p.work}s`);
    ok(`${p.id} does not prescribe running`, !LOCOMOTION.test(p.name + ' ' + p.instr),
       LOCOMOTION.test(p.name + ' ' + p.instr) ? `matched: ${(p.name + ' ' + p.instr).match(LOCOMOTION)[0]}` : '');
  }

  // Every muscle the app can train needs 2+ prep options, for the same reason
  // stretches do: with one, the leftover pass can never give it a second look.
  const tagged = {};
  for (const p of PREPS) for (const m of p.muscles) tagged[m] = (tagged[m] || 0) + 1;
  const trainedTags = new Set();
  for (const ms of Object.values(MUSCLE_MAP)) for (const m of ms) trainedTags.add(m);
  for (const m of trainedTags) ok(`muscle "${m}" has at least 2 prep movements`, (tagged[m] || 0) >= 2, `${tagged[m] || 0} found`);
  // Both tiers must be able to serve the runner essentials, or a run warm-up
  // can only ever mobilise.
  for (const m of STRETCH_ESSENTIALS) {
    for (const tier of ['mobilise', 'activate']) {
      ok(`essential "${m}" has a ${tier} option`, PREPS.some(p => p.muscles.includes(m) && p.tier === tier));
    }
  }
}

/* ---------------- planned loads ---------------- */
group('Planned loads (lift templates)');
for (const tplId of Object.keys(TEMPLATES)) {
  const loads = plannedLoads(tplId);
  const tpl = TEMPLATES[tplId];
  ok(`${tplId}: produces loads`, Object.keys(loads).length > 0);
  // every muscle the template touches must appear, with the prescribed set count
  const expect = {};
  for (const [exId, sets] of tpl.items) for (const m of (MUSCLE_MAP[exId] || [])) expect[m] = (expect[m] || 0) + sets;
  eq(`${tplId}: loads match the template's prescribed sets`, JSON.stringify(loads), JSON.stringify(expect));
}
eq('an unknown template yields no loads', JSON.stringify(plannedLoads('nope')), '{}');

/* ---------------- run typing ---------------- */
group('Run typing and loads');
{
  eq('easy run types as easy', runType({ kind: 'run', title: 'Easy Run' }), 'easy');
  eq('hard run types as hard', runType({ kind: 'run', title: 'Hard Run' }), 'hard');
  eq('long run types as long', runType({ kind: 'run', title: 'Long Run' }), 'long');
  eq('a race types as race', runType({ kind: 'race', title: '🏁 Melbourne Half' }), 'race');
  eq('an unknown run falls back to easy', runType({ kind: 'run', title: 'Shakeout' }), 'easy');
  eq('a missing day falls back to easy', runType(null), 'easy');

  for (const t of Object.keys(RUN_LOADS)) {
    const l = RUN_LOADS[t];
    ok(`${t}: loads the calves`, l.calves > 0);
    ok(`${t}: loads the posterior chain`, l.hams > 0 && l.glutes > 0);
    ok(`${t}: has a prep budget`, RUN_PREP_MINS[t] > 0);
  }
  ok('an easy run gets less prep than a race', RUN_PREP_MINS.easy < RUN_PREP_MINS.race);
  ok('a long run loads hamstrings at least as hard as an easy one', RUN_LOADS.long.hams >= RUN_LOADS.easy.hams);
  eq('runLoads returns a copy, not the shared object', runLoads({ kind: 'run', title: 'Easy Run' }) === RUN_LOADS.easy, false);
}

/* ---------------- the routines ---------------- */
function checkRoutine(label, loads, mins, opts) {
  const r = prepRoutine(loads, mins, opts || {});
  const list = r.list;
  const budget = mins * 60;

  ok(`${label}: produces a routine`, list.length > 0);

  // 1. THE HEADLINE — no static stretch may ever appear in a warm-up.
  const leaked = list.filter(i => STRETCH_IDS.has(i.id));
  eq(`${label}: no static stretch leaked in`, leaked.map(i => i.id).join(',') || 'none', 'none');
  // and nothing that sends you out for a run
  const loco = list.filter(i => LOCOMOTION.test(i.name + ' ' + i.instr));
  eq(`${label}: prescribes no running`, loco.map(i => i.name).join(',') || 'none', 'none');

  // 2. both tiers present — mobilise AND activate
  const mob = list.filter(i => i.tier === 'mobilise').length;
  const act = list.filter(i => i.tier === 'activate').length;
  ok(`${label}: mobilises something`, mob > 0, names(list));
  ok(`${label}: activates something`, act > 0, `mob ${mob} / act ${act} — ${names(list)}`);

  // RAMP order: every mobilise item comes before every activate item
  const firstAct = list.findIndex(i => i.tier === 'activate');
  const lastMob = list.map(i => i.tier).lastIndexOf('mobilise');
  ok(`${label}: mobilising all precedes activating`, firstAct === -1 || lastMob < firstAct, names(list));

  // 3. runner essentials get a look in
  const essHit = list.filter(i => i.muscles.some(m => STRETCH_ESSENTIALS.includes(m))).length;
  ok(`${label}: covers at least one runner essential`, essHit > 0, names(list));

  // 4. budget honoured, setup gaps included
  const summed = list.reduce((a, i) => a + stretchDur(i), 0);
  eq(`${label}: reported total matches the items`, summed, r.total);
  ok(`${label}: stays inside its budget`, r.total <= budget + 20, `${r.total}s vs ${budget}s`);
  // and isn't so short it's a token gesture
  ok(`${label}: uses at least half the budget`, r.total >= budget * 0.5, `${r.total}s vs ${budget}s`);

  // no duplicates
  const ids = list.map(i => i.id);
  eq(`${label}: no repeated movement`, ids.length, new Set(ids).size);
  // every emitted item is engine-ready
  for (const i of list) {
    ok(`${label}: "${i.name}" carries a hold for the timer`, i.hold > 0);
    eq(`${label}: "${i.name}" uses the short prep setup gap`, i.setup, PREP_SETUP_SECS);
  }
  return r;
}

group('Lift prep — every template × budget');
for (const tplId of Object.keys(TEMPLATES)) {
  for (const mins of BUDGETS) checkRoutine(`${tplId} @${mins}m`, plannedLoads(tplId), mins);
}

group('Lift prep — targets what the session will train');
for (const tplId of Object.keys(TEMPLATES)) {
  const loads = plannedLoads(tplId);
  const r = prepRoutine(loads, 6, {});
  // the single hardest-loaded muscle must be addressed
  const top = Object.keys(loads).sort((a, b) => loads[b] - loads[a])[0];
  ok(`${tplId}: prepares its hardest-loaded muscle (${top})`, r.list.some(i => i.muscles.includes(top)), names(r.list));
  // and a majority of the routine should serve muscles the session actually uses
  const onTarget = r.list.filter(i => i.muscles.some(m => loads[m] > 0)).length;
  ok(`${tplId}: most of the routine serves today's muscles`, onTarget >= Math.ceil(r.list.length / 2),
     `${onTarget}/${r.list.length} — ${names(r.list)}`);
}

group('Run prep — every run type at its own budget');
for (const t of Object.keys(RUN_LOADS)) {
  const day = t === 'race' ? { kind: 'race', title: '🏁 Race' } : { kind: 'run', title: `${t[0].toUpperCase()}${t.slice(1)} Run` };
  const mins = runPrepMins(day);
  const r = checkRoutine(`run:${t} @${mins}m`, runLoads(day), mins);
  ok(`run:${t}: prepares the calves`, r.list.some(i => i.muscles.includes('calves')), names(r.list));
}

group('Taper and race weeks are not truncated');
{
  // The session shrinks in a taper; the warm-up must not. Compare the peak-build
  // lower day against the taper one at the same budget.
  const build = prepRoutine(plannedLoads('lowerB'), 6, {});
  const taper = prepRoutine(plannedLoads('lowerTaperB'), 6, {});
  ok('taper lower prep is as substantial as the build one',
     taper.total >= build.total * 0.9, `taper ${taper.total}s vs build ${build.total}s`);
  const race = prepRoutine(runLoads({ kind: 'race', title: '🏁 Race' }), runPrepMins({ kind: 'race' }), {});
  ok('race-day prep is the longest run prep of all',
     race.total >= prepRoutine(runLoads({ kind: 'run', title: 'Long Run' }), runPrepMins({ kind: 'run', title: 'Long Run' }), {}).total,
     `${race.total}s`);
  eq('race-day prep contains no static stretch', race.list.filter(i => STRETCH_IDS.has(i.id)).length, 0);
}

group('Sore-day bias');
for (const tplId of ['lowerA', 'lowerB', 'upperA']) {
  const normal = prepRoutine(plannedLoads(tplId), 6, {});
  const sore = prepRoutine(plannedLoads(tplId), 6, { soreBias: true });
  const mobN = normal.list.filter(i => i.tier === 'mobilise').length;
  const mobS = sore.list.filter(i => i.tier === 'mobilise').length;
  ok(`${tplId}: a sore day mobilises at least as much`, mobS >= mobN, `sore ${mobS} vs normal ${mobN}`);
  checkRoutine(`${tplId} @6m sore`, plannedLoads(tplId), 6, { soreBias: true });
}

group('Degenerate input');
{
  const bare = prepRoutine({}, 6, {});
  ok('no loads at all still produces a routine', bare.list.length > 0, names(bare.list));
  eq('no loads leaks no stretches', bare.list.filter(i => STRETCH_IDS.has(i.id)).length, 0);
  const tiny = prepRoutine(plannedLoads('lowerA'), 1, {});
  ok('a 1-minute budget produces something small rather than nothing', tiny.list.length >= 1);
  ok('a 1-minute budget is respected', tiny.total <= 60 + 20, `${tiny.total}s`);
  const zero = prepRoutine(plannedLoads('lowerA'), 0, {});
  ok('a zero budget does not throw', Array.isArray(zero.list));
  ok('null loads does not throw', Array.isArray(prepRoutine(null, 6, {}).list));
  ok('undefined opts does not throw', Array.isArray(prepRoutine(plannedLoads('lowerA'), 6).list));
}

/* =================================================================== */
console.log('\n' + '-'.repeat(60));
if (fail) {
  console.log(`FAILED — ${pass} passed, ${fail} failed:\n`);
  for (const f of fails) console.log('  ✗ ' + f);
  process.exit(1);
}
console.log(`OK — ${pass} assertions passed.`);
