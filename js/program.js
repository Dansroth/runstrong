/* RunStrong — program data: exercise library, 8-week plan, progression engine */
'use strict';

const RACES = [
  { key: 'geelong', name: 'Geelong Half', tag: 'B race', date: '2026-09-20' },
  { key: 'melbourne', name: 'Melbourne Half', tag: 'A race', date: '2026-10-11' },
];

const PROGRAM_START = '2026-08-13'; // Thursday — partial intro week 1
const WEEK2_MONDAY = '2026-08-17';  // full Mon–Sun weeks from here, anchored to race Sundays

/*
 mode: 'reps' (weight x reps), 'time' (seconds per side/set), 'carry' (weight x metres), 'bw' (bodyweight reps)
 group: 'lower' | 'upper'  → progression aggressiveness
 perSide: logged per leg/side (informational)
*/
const EXERCISES = {
  // ---- Lower A ----
  boxjump:   { name: 'Low Box Jump', group: 'lower', mode: 'bw', rest: 60, rpe: null, swaps: ['broadjump', 'depthdrop'], cue: 'Stick the landing quietly. Step down, never jump down.' },
  bss:       { name: 'Bulgarian Split Squat', group: 'lower', mode: 'reps', perSide: true, rest: 90, rpe: [7, 8], swaps: ['revlunge', 'stepup'], cue: 'Front shin vertical, drive through mid-foot.' },
  slrdl:     { name: 'Single-Leg RDL', group: 'lower', mode: 'reps', perSide: true, rest: 75, rpe: [7, 7], swaps: ['bstance', 'cableslrdl'], cue: 'Square hips, soft knee, long spine.' },
  calfstand: { name: 'Standing Calf Raise', group: 'lower', mode: 'reps', rest: 75, rpe: [8, 8], swaps: ['slcalf', 'lpcalf'], cue: 'Straight knee (gastroc). Full stretch at bottom, pause at top.' },
  copen:     { name: 'Copenhagen Plank', group: 'lower', mode: 'time', perSide: true, rest: 45, rpe: null, swaps: ['sideplank', 'adductor'], cue: 'Top leg on bench, body in one line. Seconds per side.' },
  // ---- Lower B ----
  squat:     { name: 'Back Squat', group: 'lower', mode: 'reps', rest: 150, rpe: [7, 8], wu: 'bar', swaps: ['frontsquat', 'hacksquat', 'legpress'], cue: 'Heavy but crisp — no grinding reps.' },
  rdl:       { name: 'Romanian Deadlift', group: 'lower', mode: 'reps', rest: 120, rpe: [8, 8], wu: 'bar', swaps: ['trapbar', 'goodmorning'], cue: 'Hinge back, bar close, stretch the hamstrings.' },
  hipthrust: { name: 'Hip Thrust', group: 'lower', mode: 'reps', rest: 90, rpe: [8, 8], wu: 'bar', swaps: ['slhipthrust', 'glutebridge'], cue: 'Full lockout, ribs down, 1s squeeze.' },
  calfseat:  { name: 'Seated Calf Raise', group: 'lower', mode: 'reps', rest: 60, rpe: [8, 8], swaps: ['bkcalfpress'], cue: 'Bent knee (soleus) — the engine of running. Slow tempo.' },
  // ---- Upper A ----
  bench:     { name: 'Bench Press', group: 'upper', mode: 'reps', rest: 120, rpe: [8, 8], wu: 'bar', swaps: ['dbbench', 'machpress'], cue: 'Feet planted, controlled descent.' },
  pullup:    { name: 'Weighted Pull-Up', group: 'upper', mode: 'reps', rest: 120, rpe: [8, 8], wu: 'bw', swaps: ['latpull', 'assistpull'], cue: 'Full hang to chin over. Weight = added load (0 = bodyweight).' },
  dbrow:     { name: 'DB Row', group: 'upper', mode: 'reps', perSide: true, rest: 60, rpe: [8, 8], swaps: ['csrow', 'cablerow'], cue: 'Pull to hip, no torso twist.' },
  pallof:    { name: 'Pallof Press', group: 'upper', mode: 'reps', perSide: true, rest: 45, rpe: null, swaps: ['cablechop', 'bandpallof'], cue: 'Anti-rotation: press out, resist the pull, slow.' },
  carry:     { name: 'Suitcase Carry', group: 'upper', mode: 'carry', perSide: true, rest: 60, rpe: null, swaps: ['safarmer', 'sideplank'], cue: 'Heavy DB one hand, walk tall, level hips. Metres per side.' },
  // ---- Upper B ----
  ohp:       { name: 'Overhead Press', group: 'upper', mode: 'reps', rest: 120, rpe: [8, 8], wu: 'bar', swaps: ['landmine', 'dbshoulder'], cue: 'Glutes tight, ribs down, full lockout.' },
  csrow:     { name: 'Chest-Supported Row', group: 'upper', mode: 'reps', rest: 90, rpe: [8, 8], swaps: ['sealrow', 'cablerow'], cue: 'Chest glued to pad, squeeze shoulder blades.' },
  incline:   { name: 'Incline DB Press', group: 'upper', mode: 'reps', rest: 75, rpe: [8, 8], swaps: ['incmach', 'pushup'], cue: '30–45° bench, elbows ~45°.' },
  facepull:  { name: 'Face Pull', group: 'upper', mode: 'reps', rest: 45, rpe: null, swaps: ['revpec', 'bandpull'], cue: 'Rope to eyebrows, thumbs back, pause.' },
  abwheel:   { name: 'Ab Wheel', group: 'upper', mode: 'bw', rest: 60, rpe: null, swaps: ['hangraise', 'cablecrunch'], cue: 'Hips locked — no sag. Shorten range if lower back talks.' },
  // ---- Swap variants (own history each) ----
  broadjump:  { name: 'Broad Jump', group: 'lower', mode: 'bw', rest: 60, rpe: null, swaps: [], cue: 'Max intent, soft landing.' },
  depthdrop:  { name: 'Depth Drop', group: 'lower', mode: 'bw', rest: 60, rpe: null, swaps: [], cue: 'Low box, absorb quietly.' },
  revlunge:   { name: 'Reverse Lunge', group: 'lower', mode: 'reps', perSide: true, rest: 90, rpe: [7, 8], swaps: [], cue: 'Long step back, vertical torso.' },
  stepup:     { name: 'Step-Up', group: 'lower', mode: 'reps', perSide: true, rest: 90, rpe: [7, 8], swaps: [], cue: 'Knee-height box, no push-off from back leg.' },
  bstance:    { name: 'B-Stance RDL', group: 'lower', mode: 'reps', perSide: true, rest: 75, rpe: [7, 7], swaps: [], cue: 'Back foot = kickstand only.' },
  cableslrdl: { name: 'Cable Single-Leg RDL', group: 'lower', mode: 'reps', perSide: true, rest: 75, rpe: [7, 7], swaps: [], cue: 'Cable gives balance assist.' },
  slcalf:     { name: 'Single-Leg Calf Raise', group: 'lower', mode: 'reps', perSide: true, rest: 75, rpe: [8, 8], swaps: [], cue: 'DB in hand, full range.' },
  lpcalf:     { name: 'Leg Press Calf Raise', group: 'lower', mode: 'reps', rest: 75, rpe: [8, 8], swaps: [], cue: 'Straight knee, deep stretch.' },
  sideplank:  { name: 'Side Plank + Abduction', group: 'lower', mode: 'time', perSide: true, rest: 45, rpe: null, swaps: [], cue: 'Lift top leg, hold. Seconds per side.' },
  adductor:   { name: 'Adductor Machine', group: 'lower', mode: 'reps', rest: 45, rpe: [8, 8], swaps: [], cue: 'Slow negatives.' },
  frontsquat: { name: 'Front Squat', group: 'lower', mode: 'reps', rest: 150, rpe: [7, 8], wu: 'bar', swaps: [], cue: 'Elbows high, upright torso.' },
  hacksquat:  { name: 'Hack Squat', group: 'lower', mode: 'reps', rest: 150, rpe: [7, 8], wu: 'machine', swaps: [], cue: 'Full depth, controlled.' },
  legpress:   { name: 'Leg Press', group: 'lower', mode: 'reps', rest: 150, rpe: [7, 8], wu: 'machine', swaps: [], cue: 'Deep, knees track over toes.' },
  trapbar:    { name: 'Trap-Bar RDL', group: 'lower', mode: 'reps', rest: 120, rpe: [8, 8], wu: 'bar', swaps: [], cue: 'Hinge, neutral grip.' },
  goodmorning:{ name: 'Good Morning', group: 'lower', mode: 'reps', rest: 120, rpe: [8, 8], wu: 'bar', swaps: [], cue: 'Light bar, big hamstring stretch.' },
  slhipthrust:{ name: 'Single-Leg Hip Thrust', group: 'lower', mode: 'reps', perSide: true, rest: 90, rpe: [8, 8], swaps: [], cue: 'Hips level throughout.' },
  glutebridge:{ name: 'Barbell Glute Bridge', group: 'lower', mode: 'reps', rest: 90, rpe: [8, 8], wu: 'bar', swaps: [], cue: 'From floor, hard squeeze.' },
  bkcalfpress:{ name: 'Bent-Knee Calf Press', group: 'lower', mode: 'reps', rest: 60, rpe: [8, 8], swaps: [], cue: 'Leg press, knees bent ~30°.' },
  dbbench:    { name: 'DB Bench Press', group: 'upper', mode: 'reps', rest: 120, rpe: [8, 8], wu: 'machine', swaps: [], cue: 'Weight = per dumbbell.' },
  machpress:  { name: 'Machine Chest Press', group: 'upper', mode: 'reps', rest: 120, rpe: [8, 8], wu: 'machine', swaps: [], cue: 'Full range, controlled.' },
  latpull:    { name: 'Lat Pulldown', group: 'upper', mode: 'reps', rest: 120, rpe: [8, 8], wu: 'machine', swaps: [], cue: 'To upper chest, no lean-back heave.' },
  assistpull: { name: 'Assisted Pull-Up', group: 'upper', mode: 'reps', rest: 120, rpe: [8, 8], swaps: [], cue: 'Weight = assistance (less = harder).' },
  cablerow:   { name: 'Seated Cable Row', group: 'upper', mode: 'reps', rest: 75, rpe: [8, 8], swaps: [], cue: 'Chest up, elbows to hips.' },
  cablechop:  { name: 'Cable Chop', group: 'upper', mode: 'reps', perSide: true, rest: 45, rpe: null, swaps: [], cue: 'Rotate through hips, arms straight.' },
  bandpallof: { name: 'Band Pallof Press', group: 'upper', mode: 'reps', perSide: true, rest: 45, rpe: null, swaps: [], cue: 'Weight = band tension guess.' },
  safarmer:   { name: 'Single-Arm Farmer Hold', group: 'upper', mode: 'time', perSide: true, rest: 60, rpe: null, swaps: [], cue: 'Stand tall, seconds per side.' },
  landmine:   { name: 'Landmine Press', group: 'upper', mode: 'reps', perSide: true, rest: 120, rpe: [8, 8], wu: 'machine', swaps: [], cue: 'Slight lean-in, press up and away.' },
  dbshoulder: { name: 'DB Shoulder Press', group: 'upper', mode: 'reps', rest: 120, rpe: [8, 8], wu: 'machine', swaps: [], cue: 'Weight = per dumbbell.' },
  sealrow:    { name: 'Seal Row', group: 'upper', mode: 'reps', rest: 90, rpe: [8, 8], swaps: [], cue: 'Dead stop each rep.' },
  incmach:    { name: 'Incline Machine Press', group: 'upper', mode: 'reps', rest: 75, rpe: [8, 8], swaps: [], cue: 'Controlled negatives.' },
  pushup:     { name: 'Deficit Push-Up', group: 'upper', mode: 'bw', rest: 75, rpe: [8, 8], swaps: [], cue: 'Hands on DBs, chest below hands.' },
  revpec:     { name: 'Reverse Pec-Deck', group: 'upper', mode: 'reps', rest: 45, rpe: null, swaps: [], cue: 'Squeeze rear delts, pause.' },
  bandpull:   { name: 'Band Pull-Apart', group: 'upper', mode: 'reps', rest: 45, rpe: null, swaps: [], cue: 'To chest, control return.' },
  hangraise:  { name: 'Hanging Leg Raise', group: 'upper', mode: 'bw', rest: 60, rpe: null, swaps: [], cue: 'No swing, curl pelvis up.' },
  cablecrunch:{ name: 'Cable Crunch', group: 'upper', mode: 'reps', rest: 60, rpe: null, swaps: [], cue: 'Flex spine, hips still.' },
};

/* Session templates. items: [exId, sets, reps] — reps is per side for perSide, seconds for 'time', metres for 'carry'. */
const TEMPLATES = {
  lowerA:        { title: 'Lower A · Light', est: 37, items: [['boxjump', 3, 3], ['bss', 3, 8], ['slrdl', 3, 8], ['calfstand', 3, 10], ['copen', 3, 25]] },
  lowerA_noplyo: { title: 'Lower A · Light', est: 33, items: [['bss', 3, 8], ['slrdl', 3, 8], ['calfstand', 3, 10], ['copen', 3, 25]] },
  lowerB:        { title: 'Lower B · Heavy', est: 40, items: [['boxjump', 3, 3], ['squat', 4, 4], ['rdl', 3, 6], ['hipthrust', 3, 8], ['calfseat', 3, 12]] },
  upperA:        { title: 'Upper A', est: 35, items: [['bench', 4, 5], ['pullup', 4, 6], ['dbrow', 3, 8], ['pallof', 3, 10], ['carry', 3, 30]] },
  upperB:        { title: 'Upper B', est: 35, items: [['ohp', 4, 5], ['csrow', 4, 8], ['incline', 3, 8], ['facepull', 3, 15], ['abwheel', 3, 10]] },
  // Week 5 — Geelong mini-taper (~40% lower volume, no plyo, nothing heavy after Tue)
  lowerTaperG:   { title: 'Lower · Geelong taper', est: 25, items: [['bss', 2, 6], ['slrdl', 2, 6], ['calfstand', 2, 8], ['copen', 2, 20]] },
  upperLight:    { title: 'Upper · Light', est: 25, items: [['bench', 3, 5], ['pullup', 3, 5], ['pallof', 2, 10]] },
  upperLightB:   { title: 'Upper · Light', est: 25, items: [['ohp', 3, 5], ['csrow', 3, 8], ['facepull', 2, 15]] },
  // Week 6 — rebuild
  lowerFinal:    { title: 'Lower · Final stimulus', est: 35, items: [['squat', 3, 5], ['rdl', 2, 6], ['hipthrust', 2, 8], ['calfseat', 2, 12]] },
  upperMod:      { title: 'Upper · Moderate', est: 30, items: [['ohp', 3, 5], ['csrow', 3, 8], ['incline', 2, 8], ['abwheel', 2, 10]] },
  // Week 7 — taper (−40–50% volume, touch of intensity, no plyo)
  lowerTaperA:   { title: 'Lower · Taper', est: 25, items: [['bss', 2, 6], ['slrdl', 2, 6], ['calfstand', 2, 8]] },
  lowerTaperB:   { title: 'Lower · Taper (crisp)', est: 22, items: [['squat', 2, 3], ['calfseat', 2, 10]] },
  upperTaperA:   { title: 'Upper · Taper', est: 22, items: [['bench', 3, 4], ['pullup', 3, 5], ['pallof', 2, 10]] },
  upperTaperB:   { title: 'Upper · Taper (optional)', est: 20, items: [['ohp', 2, 5], ['csrow', 2, 8], ['facepull', 2, 15]] },
  // Week 8 — race week primer
  primer:        { title: 'Full-Body Primer · Very light', est: 25, items: [['squat', 2, 5], ['bench', 2, 8], ['csrow', 2, 10], ['calfstand', 2, 10]] },
};

const WHY_SCHEDULE = `**Why this schedule?**

Your runs are fixed: Wed hard, Fri easy, Sun long. Lifting fills Mon/Tue/Thu/Sat around them:

• **Thursday is the heavy lower day** — it's the only slot with no run in the 24h before or after that matters (Wed is done, Friday is easy). The real strength stimulus lives here, clear of your key runs.

• **Monday is the light lower day** — it follows the Sunday long run, so it's single-leg, calf and stability work at modest loads. Heavy lower here would compromise recovery.

• **Tue & Sat are upper days** — they sit directly before the Wed hard run and Sun long run, so no fresh leg fatigue is carried into either key run.

Week 1 is a short intro (Thu–Sun) so the program starts right away without waiting for Monday — two conservative sessions to groove the movements. Plyometrics (box jumps) run through the build weeks only (1–5), first in the session while fresh. Week 6 mini-tapers into Geelong (B race). Week 7 recovers, then one final lower session Thursday — the last real leg stimulus. Weeks 8–9 taper into Melbourne (A race): volume drops 40–50%, a touch of intensity stays so you don't feel flat.`;

/* ---- date helpers (local time) ---- */
function dstr(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function dadd(iso, days) { const [y, m, dd] = iso.split('-').map(Number); const d = new Date(y, m - 1, dd + days); return dstr(d); }
function today() { return dstr(new Date()); }
function fmtDate(iso) { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }); }
function daysUntil(iso) { const [y, m, d] = iso.split('-').map(Number); const t = new Date(); const a = new Date(y, m - 1, d); const b = new Date(t.getFullYear(), t.getMonth(), t.getDate()); return Math.round((a - b) / 86400000); }

/* ---- program generation ---- */
function buildProgram() {
  const weeks = [];
  const phases = [
    'Intro — conservative loads', 'Build', 'Build', 'Build — peak load',
    'Geelong mini-taper', 'Recover → rebuild', 'Taper', 'Melbourne race week',
  ];
  // Week 1: partial intro week, Thu Aug 13 – Sun Aug 16 (two conservative sessions)
  weeks.push({
    num: 1, phase: 'Intro — conservative loads', monday: PROGRAM_START,
    days: [
      { date: '2026-08-13', kind: 'lift', tpl: 'lowerA', title: TEMPLATES.lowerA.title },
      { date: '2026-08-14', kind: 'run', title: 'Easy Run', sub: 'Recovery pace' },
      { date: '2026-08-15', kind: 'lift', tpl: 'upperA', title: TEMPLATES.upperA.title },
      { date: '2026-08-16', kind: 'run', title: 'Long Run', sub: '~20 km' },
    ],
  });
  // day plan per week: map dayIndex(0=Mon..6=Sun) → {kind, tpl?, title?}
  const RUN = { 2: { kind: 'run', title: 'Hard Run', sub: 'Intervals / tempo — lifting stays out of the way' }, 4: { kind: 'run', title: 'Easy Run', sub: 'Recovery pace' }, 6: { kind: 'run', title: 'Long Run', sub: '~20 km' } };
  const layouts = [
    /* wk1-4 */ null, null, null, null,
    /* wk5 */ { 0: { kind: 'lift', tpl: 'lowerTaperG' }, 1: { kind: 'lift', tpl: 'upperLight' }, 3: { kind: 'lift', tpl: 'upperLightB' }, 5: { kind: 'mobility', title: 'Mobility only', sub: 'Race tomorrow — easy stretch + rollout' }, 6: { kind: 'race', race: 'geelong' } },
    /* wk6 */ { 0: { kind: 'mobility', title: 'Rest / Mobility', sub: 'Race recovery — no lifting' }, 1: { kind: 'lift', tpl: 'upperLight' }, 3: { kind: 'lift', tpl: 'lowerFinal' }, 5: { kind: 'lift', tpl: 'upperMod' } },
    /* wk7 */ { 0: { kind: 'lift', tpl: 'lowerTaperA' }, 1: { kind: 'lift', tpl: 'upperTaperA' }, 3: { kind: 'lift', tpl: 'lowerTaperB' }, 5: { kind: 'lift', tpl: 'upperTaperB' } },
    /* wk8 */ { 0: { kind: 'lift', tpl: 'primer' }, 1: { kind: 'mobility', title: 'Mobility only', sub: 'Nothing within 3 days of the race' }, 3: { kind: 'mobility', title: 'Mobility only', sub: 'Stay loose, stay fresh' }, 5: { kind: 'rest', title: 'Rest', sub: 'Feet up. Carb up.' }, 6: { kind: 'race', race: 'melbourne' } },
  ];
  for (let w = 0; w < 8; w++) {
    const monday = dadd(WEEK2_MONDAY, w * 7);
    const days = [];
    for (let i = 0; i < 7; i++) {
      const date = dadd(monday, i);
      let plan;
      const layout = layouts[w];
      if (layout) {
        plan = layout[i] || RUN[i] || { kind: 'rest', title: 'Rest' };
        if (layout[i] && RUN[i]) plan = layout[i]; // explicit overrides (race replaces long run)
      } else {
        // normal build weeks 1–4
        const norm = { 0: { kind: 'lift', tpl: 'lowerA' }, 1: { kind: 'lift', tpl: 'upperA' }, 3: { kind: 'lift', tpl: 'lowerB' }, 5: { kind: 'lift', tpl: 'upperB' } };
        plan = norm[i] || RUN[i] || { kind: 'rest', title: 'Rest' };
      }
      const day = { date, kind: plan.kind };
      if (plan.kind === 'lift') {
        day.tpl = plan.tpl;
        day.title = TEMPLATES[plan.tpl].title;
      } else if (plan.kind === 'race') {
        const r = RACES.find(x => x.key === plan.race);
        day.title = '🏁 ' + r.name;
        day.sub = r.tag + (plan.race === 'geelong' ? ' — replaces the long run' : ' — the one it was all for');
      } else {
        day.title = plan.title; day.sub = plan.sub;
      }
      days.push(day);
    }
    weeks.push({ num: w + 2, phase: phases[w], monday, days });
  }
  return { startDate: PROGRAM_START, weeks };
}

/* ---- progression engine ---- */
function roundToStep(w, step) { return Math.max(0, Math.round(w / step) * step); }

/* history: array of {date, sets:[{weight,reps,rpe,failed}]} for one exercise variant, oldest→newest */
function nextPrescription(exId, history, step) {
  const ex = EXERCISES[exId];
  const targetRPE = ex.rpe;
  if (!history.length) return { weight: null, reason: 'First time — start light (you should have 3–4 reps in the tank, RPE 6–7).' };
  const last = history[history.length - 1];
  const worked = last.sets.filter(s => s.weight != null && s.reps > 0);
  if (!worked.length) return { weight: null, reason: 'No logged sets last time — set your weight.' };
  const topW = Math.max(...worked.map(s => s.weight));
  if (!targetRPE) return { weight: topW, reason: 'Same as last time.' };
  const rpes = worked.filter(s => s.rpe != null).map(s => s.rpe);
  if (!rpes.length) return { weight: topW, reason: 'No RPE logged last time — holding.' };
  const avg = rpes.reduce((a, b) => a + b, 0) / rpes.length;
  const tgt = (targetRPE[0] + targetRPE[1]) / 2;
  const lower = ex.group === 'lower';
  const anyFail = worked.some(s => s.failed) || rpes.some(r => r >= 10);
  let w, reason;
  if (anyFail) {
    w = topW * (lower ? 0.93 : 0.95);
    reason = 'RPE 10 / failed set last time — backing off.';
  } else if (avg <= tgt - 1) {
    w = topW * (lower ? 1.075 : 1.0375); // aggressive: +5–10% lower, +2.5–5% upper
    reason = `Last avg RPE ${avg.toFixed(1)} vs target ${tgt} — jumping up.`;
  } else if (avg <= tgt) {
    w = topW + step;
    reason = 'RPE on target — small step up.';
  } else if (avg <= tgt + 1) {
    w = topW;
    reason = `RPE slightly high (${avg.toFixed(1)}) — holding.`;
  } else {
    w = topW * (lower ? 0.95 : 0.965);
    reason = `RPE too high (${avg.toFixed(1)}) — reducing.`;
  }
  return { weight: roundToStep(w, step), reason };
}

/* warm-up ramp for heavy lifts. Returns display string or null. */
function warmupPlan(exId, workWeight, step) {
  const ex = EXERCISES[exId];
  if (!ex.wu) return null;
  if (ex.wu === 'bw') return 'BW × 5 · BW × 3 (slow, full range)';
  if (workWeight == null || workWeight <= 0) return 'Do 2–3 easy ramp sets before your first working set.';
  const r = w => Math.max(0, Math.round(w / step) * step);
  if (workWeight <= 40) return ex.wu === 'bar' ? 'bar × 10' : 'one easy set at half weight';
  const parts = [];
  if (ex.wu === 'bar') parts.push('bar × 10');
  for (const [pct, reps] of [[0.5, 5], [0.7, 3], [0.85, 1]]) {
    const w = r(workWeight * pct);
    if (w >= (ex.wu === 'bar' ? 25 : 10) && w < workWeight) parts.push(`${w} kg × ${reps}`);
  }
  if (!parts.length) return null;
  return parts.join(' · ');
}

function e1rm(weight, reps, rpe) {
  if (!weight || !reps) return 0;
  const rir = rpe != null ? Math.max(0, 10 - rpe) : 0;
  const total = reps + rir;
  if (total > 12) return 0; // not meaningful past ~12 effective reps
  return weight * (1 + total / 30);
}
