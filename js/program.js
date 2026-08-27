/* RunStrong — program data: exercise library, 8-week plan, progression engine */
'use strict';

const RACES = [
  { key: 'geelong', name: 'Geelong Half', tag: 'B race', date: '2026-09-20' },
  { key: 'melbourne', name: 'Melbourne Half', tag: 'A race', date: '2026-10-11' },
];

const PROGRAM_START = '2026-08-13'; // Thursday — partial intro week 1
const WEEK2_MONDAY = '2026-08-17';  // full Mon–Sun weeks from here, anchored to race Sundays

/* ---- weight increment (single source of truth) ----
   Every stepper, rounding and auto-progression increment in the app derives from
   ST.settings.step, which defaults to WEIGHT_STEP_DEFAULT. 1 kg rather than the
   classic 2.5 kg plate jump: during a running block the aim is the smallest
   overload that still counts, so load creeps up without punching RPE past the
   target band (a 2.5 kg jump on a 40 kg lift is +6%, which reliably overshoots).
   Change the default here and the whole app follows. */
const WEIGHT_STEP_DEFAULT = 1;
const WEIGHT_STEP_CHOICES = [0.5, 1, 2.5, 5];

/*
 mode: 'reps' (weight x reps), 'time' (seconds per side/set), 'carry' (weight x metres), 'bw' (bodyweight reps)
 group: 'lower' | 'upper'  → progression aggressiveness
 perSide: logged per leg/side (informational)
 equip: gear this variant needs, drawn from ST.settings.equip's keys (barbell,
   dumbbell, bench, machine, cable, band, box). Missing/empty = needs nothing
   beyond floor space — used by openSwap() to rank suggestions against what the
   user has marked available in Settings, never to hide an option outright.
*/
const EXERCISES = {
  // ---- Lower A ----
  boxjump:   { name: 'Low Box Jump', group: 'lower', mode: 'bw', rest: 60, rpe: null, swaps: ['broadjump', 'depthdrop'], equip: ['box'], cue: 'Stick the landing quietly. Step down, never jump down.' },
  bss:       { name: 'Bulgarian Split Squat', group: 'lower', mode: 'reps', perSide: true, rest: 90, rpe: [7, 8], swaps: ['revlunge', 'stepup'], equip: ['dumbbell', 'bench'], cue: 'Front shin vertical, drive through mid-foot.' },
  slrdl:     { name: 'Single-Leg RDL', group: 'lower', mode: 'reps', perSide: true, rest: 75, rpe: [7, 7], swaps: ['bstance', 'cableslrdl'], equip: ['dumbbell'], cue: 'Square hips, soft knee, long spine.' },
  calfstand: { name: 'Standing Calf Raise', group: 'lower', mode: 'reps', rest: 75, rpe: [8, 8], swaps: ['slcalf', 'lpcalf'], equip: [], cue: 'Straight knee (gastroc). Full stretch at bottom, pause at top.' },
  copen:     { name: 'Copenhagen Plank', group: 'lower', mode: 'time', perSide: true, rest: 45, rpe: null, swaps: ['sideplank', 'adductor'], equip: ['bench'], cue: 'Top leg on bench, body in one line. Seconds per side.' },
  // ---- Lower B ----
  squat:     { name: 'Back Squat', group: 'lower', mode: 'reps', rest: 150, rpe: [7, 8], wu: 'bar', swaps: ['frontsquat', 'hacksquat', 'legpress'], equip: ['barbell'], cue: 'Heavy but crisp — no grinding reps.' },
  rdl:       { name: 'Romanian Deadlift', group: 'lower', mode: 'reps', rest: 120, rpe: [8, 8], wu: 'bar', swaps: ['trapbar', 'goodmorning'], equip: ['barbell'], cue: 'Hinge back, bar close, stretch the hamstrings.' },
  hipthrust: { name: 'Hip Thrust', group: 'lower', mode: 'reps', rest: 90, rpe: [8, 8], wu: 'bar', swaps: ['slhipthrust', 'glutebridge'], equip: ['barbell', 'bench'], cue: 'Full lockout, ribs down, 1s squeeze.' },
  calfseat:  { name: 'Seated Calf Raise', group: 'lower', mode: 'reps', rest: 60, rpe: [8, 8], swaps: ['bkcalfpress'], equip: ['machine'], cue: 'Bent knee (soleus) — the engine of running. Slow tempo.' },
  // ---- Upper A ----
  bench:     { name: 'Bench Press', group: 'upper', mode: 'reps', rest: 120, rpe: [8, 8], wu: 'bar', swaps: ['dbbench', 'machpress'], equip: ['barbell', 'bench'], cue: 'Feet planted, controlled descent.' },
  pullup:    { name: 'Weighted Pull-Up', group: 'upper', mode: 'reps', rest: 120, rpe: [8, 8], wu: 'bw', swaps: ['latpull', 'assistpull'], equip: [], cue: 'Full hang to chin over. Weight = added load (0 = bodyweight).' },
  dbrow:     { name: 'DB Row', group: 'upper', mode: 'reps', perSide: true, rest: 60, rpe: [8, 8], swaps: ['csrow', 'cablerow'], equip: ['dumbbell'], cue: 'Pull to hip, no torso twist.' },
  pallof:    { name: 'Pallof Press', group: 'upper', mode: 'reps', perSide: true, rest: 45, rpe: null, swaps: ['cablechop', 'bandpallof'], equip: ['cable'], cue: 'Anti-rotation: press out, resist the pull, slow.' },
  carry:     { name: 'Suitcase Carry', group: 'upper', mode: 'carry', perSide: true, rest: 60, rpe: null, swaps: ['safarmer', 'sideplank'], equip: ['dumbbell'], cue: 'Heavy DB one hand, walk tall, level hips. Metres per side.' },
  // ---- Upper B ----
  ohp:       { name: 'Overhead Press', group: 'upper', mode: 'reps', rest: 120, rpe: [8, 8], wu: 'bar', swaps: ['landmine', 'dbshoulder'], equip: ['barbell'], cue: 'Glutes tight, ribs down, full lockout.' },
  csrow:     { name: 'Chest-Supported Row', group: 'upper', mode: 'reps', rest: 90, rpe: [8, 8], swaps: ['sealrow', 'cablerow'], equip: ['machine'], cue: 'Chest glued to pad, squeeze shoulder blades.' },
  incline:   { name: 'Incline DB Press', group: 'upper', mode: 'reps', rest: 75, rpe: [8, 8], swaps: ['incmach', 'pushup'], equip: ['dumbbell', 'bench'], cue: '30–45° bench, elbows ~45°.' },
  facepull:  { name: 'Face Pull', group: 'upper', mode: 'reps', rest: 45, rpe: null, swaps: ['revpec', 'bandpull'], equip: ['cable'], cue: 'Rope to eyebrows, thumbs back, pause.' },
  abwheel:   { name: 'Ab Wheel', group: 'upper', mode: 'bw', rest: 60, rpe: null, swaps: ['hangraise', 'cablecrunch'], equip: [], cue: 'Hips locked — no sag. Shorten range if lower back talks.' },
  // ---- Swap variants (own history each) ----
  broadjump:  { name: 'Broad Jump', group: 'lower', mode: 'bw', rest: 60, rpe: null, swaps: [], equip: [], cue: 'Max intent, soft landing.' },
  depthdrop:  { name: 'Depth Drop', group: 'lower', mode: 'bw', rest: 60, rpe: null, swaps: [], equip: ['box'], cue: 'Low box, absorb quietly.' },
  revlunge:   { name: 'Reverse Lunge', group: 'lower', mode: 'reps', perSide: true, rest: 90, rpe: [7, 8], swaps: [], equip: ['dumbbell'], cue: 'Long step back, vertical torso.' },
  stepup:     { name: 'Step-Up', group: 'lower', mode: 'reps', perSide: true, rest: 90, rpe: [7, 8], swaps: [], equip: ['box', 'dumbbell'], cue: 'Knee-height box, no push-off from back leg.' },
  bstance:    { name: 'B-Stance RDL', group: 'lower', mode: 'reps', perSide: true, rest: 75, rpe: [7, 7], swaps: [], equip: ['dumbbell'], cue: 'Back foot = kickstand only.' },
  cableslrdl: { name: 'Cable Single-Leg RDL', group: 'lower', mode: 'reps', perSide: true, rest: 75, rpe: [7, 7], swaps: [], equip: ['cable'], cue: 'Cable gives balance assist.' },
  slcalf:     { name: 'Single-Leg Calf Raise', group: 'lower', mode: 'reps', perSide: true, rest: 75, rpe: [8, 8], swaps: [], equip: ['dumbbell'], cue: 'DB in hand, full range.' },
  lpcalf:     { name: 'Leg Press Calf Raise', group: 'lower', mode: 'reps', rest: 75, rpe: [8, 8], swaps: [], equip: ['machine'], cue: 'Straight knee, deep stretch.' },
  sideplank:  { name: 'Side Plank + Abduction', group: 'lower', mode: 'time', perSide: true, rest: 45, rpe: null, swaps: [], equip: [], cue: 'Lift top leg, hold. Seconds per side.' },
  adductor:   { name: 'Adductor Machine', group: 'lower', mode: 'reps', rest: 45, rpe: [8, 8], swaps: [], equip: ['machine'], cue: 'Slow negatives.' },
  frontsquat: { name: 'Front Squat', group: 'lower', mode: 'reps', rest: 150, rpe: [7, 8], wu: 'bar', swaps: [], equip: ['barbell'], cue: 'Elbows high, upright torso.' },
  hacksquat:  { name: 'Hack Squat', group: 'lower', mode: 'reps', rest: 150, rpe: [7, 8], wu: 'machine', swaps: [], equip: ['machine'], cue: 'Full depth, controlled.' },
  legpress:   { name: 'Leg Press', group: 'lower', mode: 'reps', rest: 150, rpe: [7, 8], wu: 'machine', swaps: [], equip: ['machine'], cue: 'Deep, knees track over toes.' },
  trapbar:    { name: 'Trap-Bar RDL', group: 'lower', mode: 'reps', rest: 120, rpe: [8, 8], wu: 'bar', swaps: [], equip: ['barbell'], cue: 'Hinge, neutral grip.' },
  goodmorning:{ name: 'Good Morning', group: 'lower', mode: 'reps', rest: 120, rpe: [8, 8], wu: 'bar', swaps: [], equip: ['barbell'], cue: 'Light bar, big hamstring stretch.' },
  slhipthrust:{ name: 'Single-Leg Hip Thrust', group: 'lower', mode: 'reps', perSide: true, rest: 90, rpe: [8, 8], swaps: [], equip: [], cue: 'Hips level throughout.' },
  glutebridge:{ name: 'Barbell Glute Bridge', group: 'lower', mode: 'reps', rest: 90, rpe: [8, 8], wu: 'bar', swaps: [], equip: ['barbell'], cue: 'From floor, hard squeeze.' },
  bkcalfpress:{ name: 'Bent-Knee Calf Press', group: 'lower', mode: 'reps', rest: 60, rpe: [8, 8], swaps: [], equip: ['machine'], cue: 'Leg press, knees bent ~30°.' },
  dbbench:    { name: 'DB Bench Press', group: 'upper', mode: 'reps', rest: 120, rpe: [8, 8], wu: 'machine', swaps: [], equip: ['dumbbell', 'bench'], cue: 'Weight = per dumbbell.' },
  machpress:  { name: 'Machine Chest Press', group: 'upper', mode: 'reps', rest: 120, rpe: [8, 8], wu: 'machine', swaps: [], equip: ['machine'], cue: 'Full range, controlled.' },
  latpull:    { name: 'Lat Pulldown', group: 'upper', mode: 'reps', rest: 120, rpe: [8, 8], wu: 'machine', swaps: [], equip: ['machine'], cue: 'To upper chest, no lean-back heave.' },
  assistpull: { name: 'Assisted Pull-Up', group: 'upper', mode: 'reps', rest: 120, rpe: [8, 8], swaps: [], equip: ['machine'], cue: 'Weight = assistance (less = harder).' },
  cablerow:   { name: 'Seated Cable Row', group: 'upper', mode: 'reps', rest: 75, rpe: [8, 8], swaps: [], equip: ['cable'], cue: 'Chest up, elbows to hips.' },
  cablechop:  { name: 'Cable Chop', group: 'upper', mode: 'reps', perSide: true, rest: 45, rpe: null, swaps: [], equip: ['cable'], cue: 'Rotate through hips, arms straight.' },
  bandpallof: { name: 'Band Pallof Press', group: 'upper', mode: 'reps', perSide: true, rest: 45, rpe: null, swaps: [], equip: ['band'], cue: 'Weight = band tension guess.' },
  safarmer:   { name: 'Single-Arm Farmer Hold', group: 'upper', mode: 'time', perSide: true, rest: 60, rpe: null, swaps: [], equip: ['dumbbell'], cue: 'Stand tall, seconds per side.' },
  landmine:   { name: 'Landmine Press', group: 'upper', mode: 'reps', perSide: true, rest: 120, rpe: [8, 8], wu: 'machine', swaps: [], equip: ['barbell'], cue: 'Slight lean-in, press up and away.' },
  dbshoulder: { name: 'DB Shoulder Press', group: 'upper', mode: 'reps', rest: 120, rpe: [8, 8], wu: 'machine', swaps: [], equip: ['dumbbell'], cue: 'Weight = per dumbbell.' },
  sealrow:    { name: 'Seal Row', group: 'upper', mode: 'reps', rest: 90, rpe: [8, 8], swaps: [], equip: ['dumbbell', 'bench'], cue: 'Dead stop each rep.' },
  incmach:    { name: 'Incline Machine Press', group: 'upper', mode: 'reps', rest: 75, rpe: [8, 8], swaps: [], equip: ['machine'], cue: 'Controlled negatives.' },
  pushup:     { name: 'Deficit Push-Up', group: 'upper', mode: 'bw', rest: 75, rpe: [8, 8], swaps: [], equip: ['dumbbell'], cue: 'Hands on DBs, chest below hands.' },
  revpec:     { name: 'Reverse Pec-Deck', group: 'upper', mode: 'reps', rest: 45, rpe: null, swaps: [], equip: ['machine'], cue: 'Squeeze rear delts, pause.' },
  bandpull:   { name: 'Band Pull-Apart', group: 'upper', mode: 'reps', rest: 45, rpe: null, swaps: [], equip: ['band'], cue: 'To chest, control return.' },
  hangraise:  { name: 'Hanging Leg Raise', group: 'upper', mode: 'bw', rest: 60, rpe: null, swaps: [], equip: [], cue: 'No swing, curl pelvis up.' },
  cablecrunch:{ name: 'Cable Crunch', group: 'upper', mode: 'reps', rest: 60, rpe: null, swaps: [], equip: ['cable'], cue: 'Flex spine, hips still.' },
  // ---- Hypertrophy phase — chest & arms (post-Melbourne) ----
  // rpe: [8,9] rather than this file's usual [7,8]/[8,8] on these — deliberately
  // closer to failure than the running-support lifts above target, matching the
  // phase's own "rep range barely matters if sets are taken close to failure"
  // rationale (see HYPER_POOLS header below for the full citation).
  dbflye:       { name: 'DB Flye', group: 'upper', mode: 'reps', rest: 75, rpe: [8, 8], swaps: ['dip', 'incline'], equip: ['dumbbell', 'bench'], cue: 'Slight elbow bend held constant, arc to a stretch, squeeze at the top.' },
  dip:          { name: 'Chest Dip', group: 'upper', mode: 'bw', rest: 90, rpe: [8, 8], swaps: ['dbflye', 'incline'], equip: [], cue: 'Lean forward, elbows flare slightly, real stretch at the bottom.' },
  bbcurl:       { name: 'Barbell Curl', group: 'upper', mode: 'reps', rest: 75, rpe: [8, 9], swaps: ['hammercurl', 'inclinecurl'], equip: ['barbell'], cue: 'Elbows pinned to your sides — no swing, no leg drive.' },
  hammercurl:   { name: 'Hammer Curl', group: 'upper', mode: 'reps', perSide: true, rest: 60, rpe: [8, 9], swaps: ['bbcurl', 'inclinecurl'], equip: ['dumbbell'], cue: 'Neutral grip, thumbs up, elbows still.' },
  inclinecurl:  { name: 'Incline DB Curl', group: 'upper', mode: 'reps', perSide: true, rest: 60, rpe: [8, 9], swaps: ['bbcurl', 'hammercurl'], equip: ['dumbbell', 'bench'], cue: 'Arms hang behind your torso — deep stretch at the bottom, don\'t let them drift forward.' },
  pushdown:     { name: 'Triceps Pushdown', group: 'upper', mode: 'reps', rest: 60, rpe: [8, 9], swaps: ['overheadext', 'skullcrusher'], equip: ['cable'], cue: 'Elbows pinned to your ribs, full lockout, control the return.' },
  overheadext:  { name: 'Overhead Triceps Extension', group: 'upper', mode: 'reps', rest: 60, rpe: [8, 9], swaps: ['pushdown', 'skullcrusher'], equip: ['dumbbell'], cue: 'Elbows pointed forward and still, deep stretch behind your head.' },
  skullcrusher: { name: 'Lying Triceps Extension', group: 'upper', mode: 'reps', rest: 75, rpe: [8, 9], swaps: ['pushdown', 'overheadext'], equip: ['barbell', 'bench'], cue: 'Elbows stay stacked over your shoulders — lower to your forehead, not your chest.' },
};

/* =====================================================================
   EXERCISE INSIGHTS — "why this helps your half"
   Every exercise MUST have an entry: { why, deep, taperWhy? }
   - why:   1-2 sentences, running-specific, shown in-session (expandable)
   - deep:  learn-more paragraph for the exercise detail view
   - taperWhy: optional override shown during taper/race-week phases
   Merged into EXERCISES at load — add an entry when adding an exercise.
   ===================================================================== */
const INSIGHTS = {
  boxjump:   { why: 'Trains your tendons to store and return energy fast — the literal spring in your stride. Stiffer, springier lower legs cost less energy per kilometre.', deep: 'Running economy improves when your Achilles and foot complex behave like elastic springs rather than shock absorbers. Low-amplitude jumps train that spring: short ground contacts teach your calf-tendon unit to release energy quickly instead of leaking it as heat. The dose matters more than the height — three crisp jumps beat ten sloppy ones.' },
  broadjump: { why: 'Horizontal power in the exact direction you race. Teaches your hips to project you forward, not up.', deep: 'The broad jump biases hip extension power in the horizontal plane — the same force direction as toe-off. It complements vertical work by teaching full-body coordination of a forward drive, and the stick-the-landing requirement trains eccentric control your quads use on downhills.' },
  depthdrop: { why: 'Pure landing practice: absorbing impact quietly is the skill your joints need 21,000 times on race day.', deep: 'Stepping off a low box and absorbing the landing trains eccentric strength and landing mechanics with minimal fatigue cost. Quiet landings mean your muscles are eating the impact instead of your joints — precisely the quality that protects knees and shins late in a half.' },
  bss:       { why: 'Running is single-leg hops in a row — this builds the one-leg strength and hip stability that stops your stride collapsing when fatigue hits in the back half.', deep: 'The Bulgarian split squat loads one leg at near-squat intensity while demanding pelvic control from the glute medius of the standing leg. That is the exact cocktail of the mid-stance phase of running. Stronger single-leg positions delay the form breakdown — dropping hips, inward-collapsing knees — that costs seconds and invites injury after 15km.' },
  revlunge:  { why: 'Single-leg strength with less knee stress — the step back loads your glutes the way hills do.', deep: 'The reverse lunge keeps the shin more vertical than a forward lunge, shifting load toward the glutes and away from the patellar tendon. It builds the same one-leg strength as its cousins with a friendlier joint bill — useful when running volume is high.' },
  stepup:    { why: 'A stair-climb under load — concentric single-leg drive that mirrors the push-off phase of every stride.', deep: 'Step-ups train pure concentric hip and knee extension from a dead start, without a bounce to help. That builds the raw push-off strength behind each stride, and box height lets you scale range honestly — knee-height for strength, lower for power.' },
  slrdl:     { why: 'Builds single-leg hip stability and hamstring strength so your stride doesn\'t wobble or collapse when fatigue hits late.', deep: 'The single-leg RDL is a balance-demanding hinge: hamstrings and glutes work while the foot, ankle and hip stabilisers keep you level. Hamstrings act as stride brakes and energy-transfer straps every step — strengthening them long (in the stretched position) is among the best-evidenced protections against hamstring strains in runners.' },
  bstance:   { why: 'Nearly all the single-leg hamstring benefit, with a kickstand for balance so you can load heavier.', deep: 'The B-stance keeps ~80% of load on the front leg while the rear toe stops balance from limiting the set. You keep the single-leg hinge pattern and heavy hamstring stimulus without turning the lift into a balance drill on tired days.' },
  cableslrdl:{ why: 'The single-leg hinge with a cable assist — same stride-stabilising hamstring work, steadier line.', deep: 'The cable gives constant tension and a slight balance anchor, letting you groove the single-leg hinge with more load and less wobble. A good on-ramp to the free version and a solid overload tool once you have it.' },
  calfstand: { why: 'Your calves absorb up to ~6–8× bodyweight per stride — straight-knee raises armour the gastrocnemius for 21.1km of impacts.', deep: 'The straight-knee raise biases the gastrocnemius, the calf muscle that crosses the knee and powers toe-off at speed. Calf and Achilles issues are among the most common half-marathon injuries, and heavy, full-range calf work is the best-evidenced insurance. Pause at the stretch: the bottom position is where the Achilles adapts.' },
  slcalf:    { why: 'One calf at a time — finds and fixes the side-to-side gap before the road does.', deep: 'Single-leg calf raises expose strength asymmetries that two-leg versions hide. Since running never loads both calves at once, training them one at a time is the honest version of the movement — and asymmetry correction is quiet injury prevention.' },
  lpcalf:    { why: 'Heavy calf loading without balance as the limiter — big, safe doses for stride-impact armour.', deep: 'The leg-press position lets you load the calf complex heavily with zero balance demand, useful for pushing weight beyond what standing raises allow. Depth of stretch is the quality marker — let the heel travel fully down each rep.' },
  calfseat:  { why: 'The soleus takes the highest forces of any muscle when you run — bent-knee raises target exactly it.', deep: 'With the knee bent, the gastrocnemius goes slack and the soleus — the deep, flat endurance workhorse of the calf — does the lifting. Modelling studies put peak soleus forces during running above any other muscle. It responds to high reps and hates being ignored; sore shins and Achilles problems often trace back here.' },
  bkcalfpress:{ why: 'Soleus loading on the leg press — the deep calf endurance muscle, trained heavy and safe.', deep: 'Same logic as the seated raise: bent knee isolates the soleus. The press machine version suits heavier loading with a controlled range — drive through the ball of the foot and pause the stretch.' },
  copen:     { why: 'Adductor strength is groin-injury insurance, and your inner thigh quietly stabilises every crossover step on cambered roads.', deep: 'The Copenhagen plank is the best-evidenced groin-injury prevention exercise in field sports, and runners share the mechanism: the adductors co-stabilise the pelvis in single-leg stance and control side-to-side drift. Cambered roads and late-race fatigue both raise adductor demand — a short isometric dose covers it.' },
  sideplank: { why: 'Lateral hip and trunk endurance — keeps your pelvis level so each stride lands under a stable platform.', deep: 'The side plank with leg lift trains glute medius and the lateral trunk wall together — the anti-drop system that keeps your pelvis level in single-leg stance. Pelvic drop under fatigue is linked to ITB and knee irritation; this is the direct antidote, trained in seconds not sets.' },
  adductor:  { why: 'Machine-loaded groin strength — same injury insurance as the Copenhagen, dialled by pin.', deep: 'The adductor machine trains the same groin musculature as the Copenhagen plank with easier load selection. Slow negatives matter more than the number on the stack — the eccentric portion is where tendon-protective adaptation happens.' },
  squat:     { why: 'Heavy squats make every stride cost a smaller fraction of your maximum — that\'s running economy, bought with barbells.', deep: 'The best-supported reason distance runners lift heavy: maximal strength work improves running economy, meaning the same pace costs less energy. Heavy low-rep squats raise the force ceiling so each stride uses a smaller slice of your capacity, sparing fast-twitch fibres for the final 5km. Neural, not bulky — the low-rep dose builds strength without meaningful mass.' },
  frontsquat:{ why: 'Squat strength with an upright torso — quads and upper back earn their keep for downhill control.', deep: 'The front rack shifts emphasis toward quads and demands an upright trunk, training the posture you want when tired. Quad strength is your downhill brake and your knee\'s best friend; the thoracic demand doubles as posture work for late-race form.' },
  hacksquat: { why: 'Heavy quad strength with the balance removed — force production for economy, dosed safely.', deep: 'The machine constrains the path so you can chase pure quad and glute force output without technique or balance limiting the set. A pragmatic economy-builder in high-mileage weeks when free-bar squatting feels risky.' },
  legpress:  { why: 'Big bilateral leg force, minimal skill or spine demand — the economy stimulus on tired-back days.', deep: 'The leg press isolates leg drive from trunk stability, useful when running fatigue makes barbell work sloppy. Depth and control keep it honest: full range, knees tracking over toes, no bouncing out of the bottom.' },
  rdl:       { why: 'Hamstrings absorb huge braking forces every stride — the RDL strengthens them exactly where strains happen: long and loaded.', deep: 'Late swing phase stretches your hamstrings at speed while they brake the shin — that\'s where hamstrings tear. The RDL trains them heavy in that lengthened position, which is the evidence-backed recipe for strain-proofing. The glutes and lower back get postural strength as interest.' },
  trapbar:   { why: 'Hinge strength with a neutral grip and centred load — posterior-chain power, friendlier setup.', deep: 'The trap bar centres the load through your midfoot and spares grip and lower-back positioning demands. Same hip-hinge engine as the RDL — hamstrings and glutes — with a shape that stays clean under fatigue.' },
  goodmorning:{ why: 'A long-lever hamstring stretch under load — big posterior-chain payoff from a light bar.', deep: 'The good morning loads the hinge with the bar high on your back, creating a long lever that makes light weight feel meaningful through the hamstrings. Treat it as a stretch with load: slow, deep, never heavy enough to round.' },
  hipthrust: { why: 'Glutes are your propulsion engine — thrusts train hip extension directly, horizontal like your stride.', deep: 'The hip thrust loads hip extension in the horizontal force direction, matching the propulsive demand of running better than most lifts. Strong glutes share work the hamstrings would otherwise absorb, and full lockout with a squeeze teaches end-range hip extension — the range tight hip flexors steal from desk-bound runners.' },
  slhipthrust:{ why: 'One-side glute drive with a level-pelvis demand — propulsion and stability in a single move.', deep: 'The single-leg version halves the load but doubles the honesty: the working glute drives while the trunk fights rotation, exposing side-to-side gaps. Level hips throughout is the entire assignment.' },
  glutebridge:{ why: 'Floor-based glute drive — the same propulsion pattern, simplest possible setup.', deep: 'The barbell glute bridge shortens the range slightly versus the thrust, favouring heavy loading of the lockout — the exact position of toe-off. From the floor, hard squeeze, one-second hold.' },
  bench:     { why: 'Efficient upper-body strength: a strong press supports the arm swing that counterbalances every stride.', deep: 'Your arm swing isn\'t decoration — it counter-rotates the trunk and balances the leg cycle, and it degrades when the upper body fatigues. Compound pressing keeps the chest, shoulders and triceps strong enough that 90 minutes of arm swing is trivial, in one time-efficient lift.' },
  dbbench:   { why: 'Pressing strength with each side working alone — balanced arms for a balanced swing.', deep: 'Dumbbells let each side press independently, evening out asymmetries and adding a stability demand to the same time-efficient upper-body strength stimulus.' },
  machpress: { why: 'Press strength with zero setup cost — keeps upper-body maintenance cheap in heavy run weeks.', deep: 'The machine press delivers the pressing stimulus with minimal stabiliser fatigue — a sensible swap when the week\'s running load is high and you want upper-body maintenance, not extra system stress.' },
  pullup:    { why: 'Upper-back strength holds your posture tall when you\'re tired — slouched shoulders shorten your stride.', deep: 'When the upper back fades late in a race, shoulders roll forward, the chest closes, breathing gets shallower and stride mechanics follow. Vertical pulling builds the lats and scapular muscles that keep you stacked and open. It\'s also the best strength-to-time deal in upper-body training.' },
  latpull:   { why: 'Same posture-holding back strength as the pull-up, dosed by pin instead of bodyweight.', deep: 'The pulldown trains the same lats and scapular retractors with an adjustable load, keeping quality reps available on days bodyweight pull-ups would degrade to grinding.' },
  assistpull:{ why: 'Pull-up pattern, subtracted load — building toward the real thing while banking back strength.', deep: 'Band or machine assistance preserves the vertical pull\'s full range while you build. Reduce assistance over weeks — the progression IS the program.' },
  dbrow:     { why: 'Mid-back strength that anchors your arm swing and resists the end-race slump.', deep: 'Rows strengthen the rhomboids, mid-traps and lats that retract your shoulder blades — the muscles that lose the fight when form collapses at kilometre 18. A supported single-arm row adds anti-rotation trunk work for free.' },
  csrow:     { why: 'Pure upper-back strength with the trunk supported — posture insurance without spinal cost.', deep: 'Chest support removes the lower back from the equation, letting you row heavy for the mid-back while the spine rests — a smart pairing in weeks with heavy hinging elsewhere.' },
  cablerow:  { why: 'Constant-tension rowing for the posture muscles that keep you tall at kilometre 18.', deep: 'The cable\'s smooth resistance suits controlled, squeezed reps at the shoulder blades. Chest up, elbows to hips — postural endurance with every set.' },
  sealrow:   { why: 'Strict rowing, zero momentum — honest mid-back strength for an honest arm swing.', deep: 'Lying prone eliminates all body-english: only the upper back moves the load. Dead-stop reps build the scapular strength that holds your frame open through the last 5km.' },
  ohp:       { why: 'Overhead strength builds the shoulder endurance behind ninety minutes of relaxed, rhythmic arm swing.', deep: 'Pressing overhead trains shoulders and triceps plus rib-down trunk control — the anti-arch discipline transfers to running posture under fatigue. Tired shoulders creep toward the ears and waste energy; strong ones stay loose and low.' },
  landmine:  { why: 'An angled press that\'s shoulder-friendly — swing endurance without cranky joints.', deep: 'The landmine\'s arc splits the difference between horizontal and vertical pressing, usually the most comfortable option for stiff shoulders. The half-kneeling version adds hip-flexor stretch on the rear leg — a two-for-one for runners.' },
  dbshoulder:{ why: 'Shoulder strength with independent arms — balanced, durable, swing-ready.', deep: 'Seated or standing, dumbbells let each shoulder work through its own natural path. The stimulus is the same: enough deltoid and tricep strength that your arm swing never becomes the weak link.' },
  incline:   { why: 'Upper-chest and shoulder strength — rounds out pressing so posture muscles stay balanced.', deep: 'The incline angle shares load between chest and shoulders, complementing flat pressing for balanced upper-body strength. For a runner it\'s simple structural upkeep — strong enough everywhere that nothing nags.' },
  incmach:   { why: 'The incline press on rails — balanced pressing upkeep at low fatigue cost.', deep: 'Machine inclines keep the stimulus and drop the stabiliser cost — the right choice when the running week is brutal but you don\'t want to skip upper body.' },
  pushup:    { why: 'Pressing plus a moving plank — chest strength and trunk stiffness in one bodyweight move.', deep: 'The deficit push-up is a press wrapped in a plank: chest and triceps work while the trunk holds a rigid line. That anti-sag stiffness is the same quality that keeps your pelvis level when running form gets ragged.' },
  facepull:  { why: 'Rear-delt and scap health — undoes desk-and-run rounding so breathing stays open.', deep: 'Face pulls strengthen the external rotators and lower traps that counteract the forward-rounding of both desk work and long runs. An open chest is measurably better breathing mechanics — cheap insurance at 3 sets of 15.' },
  revpec:    { why: 'Rear delts on rails — the same de-rounding medicine as the face pull.', deep: 'The reverse pec-deck isolates rear delts and scapular retractors with zero setup. Squeeze and pause — the position is the point.' },
  bandpull:  { why: 'Micro-dose shoulder health — pull-aparts fight the rounded-forward creep between sessions.', deep: 'Band pull-aparts are portable posture maintenance: high reps, light resistance, scapulae doing exactly the retraction that hunched shoulders forget. Do them anywhere, often.' },
  pallof:    { why: 'Running is one long anti-rotation task — the Pallof press trains your trunk to resist twist, stride after stride.', deep: 'Each stride throws rotational force at your trunk: right leg drives, left arm swings, and your core cancels the twist so energy goes forward. The Pallof press is that exact job with a cable — no movement, pure resistance. A stiffer trunk means less energy leaked sideways over 21.1km.' },
  cablechop: { why: 'Controlled rotation under load — teaches your trunk to produce and resist twist on demand.', deep: 'The chop trains rotation through a full arc with the hips leading — the athletic version of the anti-rotation story. For runners it builds the trunk control that keeps the upper and lower body counter-rotating smoothly instead of fighting each other.' },
  bandpallof:{ why: 'The anti-rotation press with a band — same trunk stiffness, zero equipment excuses.', deep: 'Band resistance grows through the press-out, peaking exactly where your leverage is worst. Same anti-twist trunk training as the cable version, doable at home or trackside.' },
  carry:     { why: 'One heavy hand mimics single-leg stance forces — your trunk learns to stay level under lopsided load, like every stride.', deep: 'The suitcase carry loads one side and dares you to stay upright — the lateral trunk and hip fight the same fight as in single-leg stance. Grip, posture and pelvic control all train while you simply walk. It\'s the most running-specific "core exercise" in the gym.' },
  safarmer:  { why: 'The suitcase carry, standing still — lateral trunk endurance by the second.', deep: 'The static single-arm hold isolates the anti-lean component: obliques and QL holding your spine vertical against a one-sided pull. Time under tension replaces steps — same pelvis-level payoff.' },
  abwheel:   { why: 'Anti-extension strength keeps your ribs down and stride tall when fatigue pulls you into an arch.', deep: 'Late-race fatigue drags runners into an arched, ribs-flared position that wastes energy and stresses the lower back. The ab wheel trains the anterior core to resist exactly that extension under a moving load. Short range done strictly beats long range done saggy.' },
  hangraise: { why: 'Hip flexors and abs together — the muscles that lift your knee every single stride.', deep: 'The hanging raise trains hip flexion strength (your knee lift) alongside anterior core control. Under-trained hip flexors are a hidden stride-length limiter late in races; curling the pelvis at the top keeps the abs honest.' },
  cablecrunch:{ why: 'Loaded trunk flexion — direct ab strength to anchor your ribcage over 21.1km.', deep: 'The cable crunch isolates spinal flexion with adjustable load, building the raw abdominal strength that the anti-extension and anti-rotation work leans on. Hips still, spine curls — the cable does not go for a ride.' },
  /* ---- Hypertrophy phase — honestly framed, not stretched to fit "helps your
     half." This phase's actual goal is chest/arm growth, so its rationale is
     the training-science case for that, not a running-transfer story that
     wouldn't be true for a curl. */
  dbflye:      { why: 'Chest volume the pressing lifts don\'t fully cover — a stretch-focused exercise adds range a press can\'t reach.', deep: 'Pressing and flye work overlap but aren\'t redundant: a flye loads the chest through a longer stretch under tension than a press does, and that stretched-position loading is part of what current hypertrophy research points to for growth. This is volume for its own sake, not for your stride — that\'s the honest reason it\'s here this phase.' },
  dip:         { why: 'Bodyweight-loadable chest and triceps volume, deep stretch at the bottom that a press alone won\'t give you.', deep: 'The forward-leaning dip biases chest over triceps and takes the shoulder through a deep stretched position under load. It scales by adding weight once bodyweight gets easy, same principle as the pull-up already in this app.' },
  bbcurl:      { why: 'Biceps get almost no direct work anywhere else in this app — a straight bar, heavy as you can handle with strict elbows.', deep: 'Every pulling exercise in the base program trains biceps incidentally, never as the target. Direct curls close that gap. This is the anchor lift for tracking biceps progress across the phase — the accessory curl slot rotates, this one doesn\'t, so there\'s always one number going up over time.' },
  hammercurl:  { why: 'Neutral-grip curl — hits the brachialis and forearm, the part a regular curl leaves out.', deep: 'Turning the palms to face each other shifts emphasis toward the brachialis, a muscle that sits under the biceps and adds width and elbow-flexion strength a supinated curl undertrains. Grip variety is genuinely different stimulus here, not just a change of scenery.' },
  inclinecurl: { why: 'Arms trail behind your torso, so the biceps start from a real stretch every rep — no cheating the bottom.', deep: 'The incline bench pins your shoulders back, taking away the swing and hip-drive that sneak into a standing curl once it gets heavy. Stretched-position tension is one of the more consistent findings in recent hypertrophy research, and this is the version of a curl that guarantees it.' },
  pushdown:    { why: 'Triceps make up most of your upper arm — this is the anchor lift for tracking that muscle across the phase.', deep: 'The triceps are roughly two-thirds of upper-arm size, yet nothing in the base program trains them directly. Constant cable tension through the full lockout makes this a reliable, easy-to-load anchor — the accessory triceps slot rotates every block, this one stays put so there\'s a number worth tracking.' },
  overheadext: { why: 'Overhead position stretches the long head of the triceps — the part a pushdown barely touches.', deep: 'The triceps\' long head crosses the shoulder as well as the elbow, so it only gets a real stretch when the arm is overhead. A pushdown alone will grow triceps but will undertrain this specific head — this fills that gap.' },
  skullcrusher:{ why: 'A barbell through the same overhead-stretch range, loaded heavier than a dumbbell extension allows.', deep: 'Same long-head-stretch logic as the overhead extension, but a bar (or EZ-bar) lets you load it more heavily than a single dumbbell — useful once bodyweight-adjacent triceps work stops being the limiting factor.' },
};
for (const id in INSIGHTS) if (EXERCISES[id]) Object.assign(EXERCISES[id], INSIGHTS[id]);
/* generic taper-phase line (exercise-specific taperWhy overrides if present) */
const TAPER_WHY = 'Taper mode: today is about keeping this pattern sharp, not building it — light, crisp, done. Race legs are the priority.';

/* =====================================================================
   HOWTO — step-by-step setup/execution, one level deeper than `cue`.
   `cue` stays a single reminder for mid-set glancing; `steps` is for the
   first time you meet a movement or a variant, read once before you start.
   Scoped to the exercises TEMPLATES actually prescribes (every session in
   buildProgram() draws from this list) rather than the full 54-entry
   library — swap-only variants keep their `cue` alone. Same voice as
   PREPS/STRETCHES: short, plain, second person.
   ===================================================================== */
const HOWTO = {
  boxjump:    { steps: ['Stand close to the box, feet hip-width.', 'Swing your arms back, then drive them forward as you jump.', 'Land soft and quiet with both feet, knees slightly bent.', 'Step back down — never jump down, that\'s free eccentric load you don\'t need.'] },
  bss:        { steps: ['Rear foot up on a bench behind you, laces down.', 'Front foot far enough forward that your knee stays over your ankle at the bottom.', 'Drop straight down, back knee grazing the floor.', 'Drive up through the front heel — don\'t push off the back foot.'] },
  slrdl:      { steps: ['Stand on one leg, soft knee, dumbbell in the opposite hand.', 'Hinge forward at the hip, letting the back leg rise as a counterbalance.', 'Keep your hips square — don\'t let them open up.', 'Go as low as your hamstring flexibility allows, then squeeze the glute back to standing.'] },
  calfstand:  { steps: ['Stand tall, balls of your feet on a step or plate if you have one.', 'Rise onto your toes as high as you can, pause a beat at the top.', 'Lower slow, all the way down until you feel a real stretch.', 'Keep the knee straight throughout — bending it turns this into the seated version.'] },
  copen:      { steps: ['Lie on your side, propped on the bottom elbow, directly under your shoulder.', 'Top leg goes on a bench, bottom leg stays underneath.', 'Lift your hips until your body is one straight line from shoulder to ankle.', 'Hold — no sagging at the hips, no rotating forward or back.'] },
  squat:      { steps: ['Bar on your upper back, feet shoulder-width, toes slightly out.', 'Brace your core, unrack, and step back before you start.', 'Sit down and back, knees tracking over your toes, chest tall.', 'Go to at least parallel, then drive up through the whole foot.'] },
  rdl:        { steps: ['Bar in hand at hip height, soft knees.', 'Push your hips straight back, chest staying proud, bar tracking close down your thighs.', 'Stop when you feel a real hamstring stretch — usually mid-shin, not the floor.', 'Drive your hips forward to stand, squeezing the glutes at the top.'] },
  hipthrust:  { steps: ['Upper back braced against a bench, bar rolled over your hips.', 'Feet flat, roughly shin-vertical at the top of the rep.', 'Drive through your heels, pushing your hips to full extension.', 'Squeeze glutes hard for a full second at the top before lowering under control.'] },
  slhipthrust: { steps: ['Upper back against a bench, one foot planted, the other leg held up off the floor.', 'Shin roughly vertical under the working knee at the top.', 'Drive through the planted heel to full hip extension, keeping both hips level.', 'The lifted leg is there to make you honest — if your hips twist to help, the weight is too heavy.'] },
  calfseat:   { steps: ['Sit at the machine, knees bent under the pads, balls of your feet on the platform.', 'Lower your heels for a full stretch.', 'Rise onto your toes as high as you can, slow tempo throughout.', 'The bent knee takes the gastrocnemius out of it — this is soleus work, so it can take higher reps than it feels like it should.'] },
  bench:      { steps: ['Lie back, eyes roughly under the bar, feet planted flat.', 'Grip just outside shoulder width, shoulder blades pulled together and down.', 'Lower the bar to your chest under control, elbows at a moderate angle (not flared to 90°).', 'Drive it back up in a straight line — don\'t let it drift toward your face.'] },
  pullup:     { steps: ['Hang from the bar, hands just outside shoulder width.', 'Pull your shoulder blades down first, then bend the elbows to bring your chin over the bar.', 'Lower all the way to a full hang each rep — that\'s the range that counts.', 'Add weight via a belt or held dumbbell once bodyweight reps stop being hard.'] },
  dbrow:      { steps: ['One knee and hand on a bench, back flat, opposite foot on the floor.', 'Let the dumbbell hang straight down from a relaxed shoulder.', 'Pull it to your hip, leading with the elbow, not the hand.', 'No torso twist — if you need to rotate to finish the rep, the weight is too heavy.'] },
  pallof:     { steps: ['Stand side-on to the cable, handle at chest height.', 'Press the handle straight out from your chest until your arms are fully extended.', 'Hold — the cable is trying to rotate you toward it, and your only job is to resist.', 'Bring it back to your chest under control and repeat.'] },
  carry:      { steps: ['Pick up one heavy dumbbell in one hand, the other hand free.', 'Stand tall — resist leaning away from the weight.', 'Walk with even, level steps, hips staying square.', 'Set it down under control at the target distance, then switch hands next set.'] },
  ohp:        { steps: ['Bar at collarbone height, grip just outside shoulder width.', 'Brace your glutes and core hard — this is a full-body lift, not just shoulders.', 'Press straight up, tucking your head through once the bar clears your face.', 'Lock out fully overhead, bar stacked over mid-foot.'] },
  csrow:      { steps: ['Chest flat against the pad, feet braced.', 'Start with arms fully extended, shoulder blades allowed to spread.', 'Pull your elbows back past your ribs, squeezing your shoulder blades together.', 'Control the weight back out — don\'t let it yank your arms straight.'] },
  incline:    { steps: ['Set the bench to 30–45°, dumbbells resting on your thighs.', 'Kick them up to your shoulders as you lie back.', 'Press up and slightly in, stopping just short of locking your elbows.', 'Lower under control to a stretch at the bottom, elbows around 45° from your torso.'] },
  facepull:   { steps: ['Rope attachment at roughly eye height on the cable.', 'Pull toward your face, leading with your elbows high and wide.', 'Aim the ends of the rope toward your eyebrows, thumbs pointing back.', 'Pause and squeeze your shoulder blades together before returning slowly.'] },
  abwheel:    { steps: ['Kneel, wheel in both hands, directly under your shoulders.', 'Roll forward slowly, keeping your hips tucked under — no arch in the lower back.', 'Go only as far as you can control while keeping that flat-back position.', 'Pull back to start using your abs, not your hip flexors.'] },
  glutebridge: { steps: ['Lie on your back, bar over your hips, knees bent, feet flat.', 'Feet a little closer to your hips than a hip thrust — shins near-vertical at lockout.', 'Drive your hips up to full extension, squeezing hard at the top.', 'Lower with control back to the floor between reps.'] },
  pushup:     { steps: ['Hands on two dumbbells (or blocks), set slightly wider than shoulder width.', 'Body in one straight line from head to heels.', 'Lower your chest below the level of your hands — the deficit is the point.', 'Press back up without letting your hips sag or pike.'] },
  bandpull:   { steps: ['Hold the band at chest height, arms straight out in front, shoulder-width grip.', 'Pull the band apart by driving your shoulder blades together.', 'Keep your arms straight throughout — the movement comes from the shoulder blades, not the elbows.', 'Control the return; don\'t let the band snap your hands back in.'] },
  dbflye:      { steps: ['Lie on a flat or slightly inclined bench, a dumbbell in each hand above your chest.', 'Set a slight, fixed bend in your elbows and keep it there the whole set.', 'Lower your arms out to the sides in an arc until you feel a real stretch across your chest.', 'Bring the dumbbells back together over your chest in the same arc, squeezing at the top.'] },
  dip:         { steps: ['Support yourself on parallel bars, arms locked.', 'Lean your torso forward and lower under control, elbows flaring slightly out.', 'Go down until you feel a real stretch across your chest.', 'Press back up without letting your shoulders shrug toward your ears.'] },
  bbcurl:      { steps: ['Stand tall, bar in an underhand grip, roughly shoulder width.', 'Elbows pinned to your sides for the whole set.', 'Curl the bar up without letting your elbows drift forward or your hips swing.', 'Lower under control all the way to a straight arm.'] },
  hammercurl:  { steps: ['Stand tall, a dumbbell in each hand, palms facing your body.', 'Curl one or both dumbbells up keeping your thumbs pointed up throughout.', 'Elbows stay pinned to your sides — no swing.', 'Lower under control to a straight arm.'] },
  inclinecurl: { steps: ['Sit back on an incline bench, arms hanging straight down behind your torso.', 'Curl the dumbbells up without letting your elbows drift forward.', 'Squeeze at the top.', 'Lower slowly all the way down — this is where the stretch happens, don\'t rush it.'] },
  pushdown:    { steps: ['Stand at the cable stack, bar or rope attachment at chest height.', 'Elbows pinned to your ribs for the whole set.', 'Press down to a full lockout, squeezing the triceps.', 'Let the weight travel back up under control, elbows never leaving your sides.'] },
  overheadext: { steps: ['Sit or stand tall, one or two dumbbells held overhead, arms straight.', 'Elbows pointed forward and kept still.', 'Lower the weight behind your head until you feel a real stretch.', 'Press back up to straight arms without letting the elbows flare out.'] },
  skullcrusher:{ steps: ['Lie on a bench, bar held straight above your shoulders.', 'Keeping your upper arms still and vertical, bend only at the elbow.', 'Lower the bar toward your forehead, not your chest.', 'Extend back to straight arms, elbows staying stacked over your shoulders throughout.'] },
};
for (const id in HOWTO) if (EXERCISES[id]) Object.assign(EXERCISES[id], HOWTO[id]);

/* =====================================================================
   STRETCH LIBRARY + MUSCLE MAP (post-session routine)
   MUSCLE_MAP: exId → muscle tags used to weight the routine toward what
   you actually trained. Tags: quads glutes hams calves adductors hipflex
   chest back shoulders core. Add a mapping when adding an exercise.
   ===================================================================== */
const MUSCLE_MAP = {
  squat:['quads','glutes'], frontsquat:['quads','glutes','core'], hacksquat:['quads','glutes'], legpress:['quads','glutes'],
  bss:['quads','glutes','adductors'], revlunge:['quads','glutes'], stepup:['quads','glutes'],
  slrdl:['hams','glutes'], bstance:['hams','glutes'], cableslrdl:['hams','glutes'],
  rdl:['hams','glutes','back'], trapbar:['hams','glutes','back'], goodmorning:['hams','back'],
  hipthrust:['glutes'], slhipthrust:['glutes'], glutebridge:['glutes'],
  calfstand:['calves'], slcalf:['calves'], lpcalf:['calves'], calfseat:['calves'], bkcalfpress:['calves'],
  copen:['adductors','core'], sideplank:['core','glutes'], adductor:['adductors'],
  boxjump:['calves','quads'], broadjump:['glutes','quads'], depthdrop:['quads','calves'],
  bench:['chest','shoulders'], dbbench:['chest','shoulders'], machpress:['chest','shoulders'],
  incline:['chest','shoulders'], incmach:['chest','shoulders'], pushup:['chest','core'],
  pullup:['back'], latpull:['back'], assistpull:['back'],
  dbrow:['back'], csrow:['back'], cablerow:['back'], sealrow:['back'],
  ohp:['shoulders'], landmine:['shoulders','core'], dbshoulder:['shoulders'],
  facepull:['shoulders','back'], revpec:['shoulders','back'], bandpull:['shoulders','back'],
  pallof:['core'], cablechop:['core'], bandpallof:['core'],
  carry:['core','back'], safarmer:['core','back'],
  abwheel:['core','hipflex'], hangraise:['core','hipflex'], cablecrunch:['core'],
  // ---- Hypertrophy phase — introduces the biceps/triceps tags ----
  dbflye:['chest'], dip:['chest','triceps'],
  bbcurl:['biceps'], hammercurl:['biceps'], inclinecurl:['biceps'],
  pushdown:['triceps'], overheadext:['triceps'], skullcrusher:['triceps'],
};
/* "Get ready" gap before every hold: the next stretch is shown while this counts
   down, so you have time to get on the floor and into position before the hold
   timer starts. Applies to every stretch AND to each side of a per-side stretch
   (swapping legs is its own setup). Budgeting in buildStretchRoutine() and the
   "time left" readout both derive from this, so the routine estimate stays honest. */
const STRETCH_SETUP_SECS = 10;

/* Stretches: written for someone tired at the end of a session — short sentences,
   no jargon. hold = seconds (per side when perSide). */
const STRETCHES = [
  { id:'st-calf-wall', name:'Calf stretch (wall)', muscles:['calves'], perSide:true, hold:40, instr:'Hands on a wall. Step one foot back. Keep that leg straight, heel on the floor. Lean in until the calf pulls.' },
  { id:'st-soleus', name:'Bent-knee calf stretch', muscles:['calves'], perSide:true, hold:30, instr:'Same wall position, back foot a bit closer. Now bend the back knee, heel down. You\'ll feel it lower, near the Achilles.' },
  { id:'st-hipflex', name:'Kneeling hip flexor stretch', muscles:['hipflex'], perSide:true, hold:40, instr:'Kneel on one knee, other foot in front. Tuck your tailbone under, then shift your hips forward a little. Feel the front of the hip on the kneeling side.' },
  { id:'st-fig4', name:'Figure-4 glute stretch', muscles:['glutes'], perSide:true, hold:40, instr:'Lie on your back. Cross one ankle over the other knee. Reach through and pull the bottom thigh toward your chest.' },
  { id:'st-pigeon-seat', name:'Seated glute stretch', muscles:['glutes'], perSide:true, hold:35, instr:'Sit on a bench or chair. Ankle over the opposite knee. Sit tall, then lean forward slowly until the outside of the hip pulls.' },
  { id:'st-ham-lying', name:'Lying hamstring stretch', muscles:['hams'], perSide:true, hold:40, instr:'Lie on your back. Lift one leg, hands behind the thigh. Keep the knee nearly straight and pull gently toward you.' },
  { id:'st-quad', name:'Standing quad stretch', muscles:['quads'], perSide:true, hold:35, instr:'Stand tall, hold something if you need to. Grab your ankle behind you. Knees together, tailbone tucked. Feel the front of the thigh.' },
  { id:'st-butterfly', name:'Butterfly stretch', muscles:['adductors'], perSide:false, hold:40, instr:'Sit down, soles of your feet together. Let your knees fall toward the floor. Lean forward slowly with a long back.' },
  { id:'st-childpose', name:'Child\'s pose', muscles:['back','shoulders'], perSide:false, hold:45, instr:'Kneel, knees wide, sit back toward your heels. Walk your hands forward and let your chest sink. Breathe slow into your back.' },
  { id:'st-twist', name:'Lying spinal twist', muscles:['back','core'], perSide:true, hold:35, instr:'Lie on your back. Bring one knee across your body toward the floor. Arms wide, look the other way. Let gravity do it.' },
  { id:'st-doorway', name:'Doorway chest stretch', muscles:['chest'], perSide:true, hold:30, instr:'Forearm on a door frame, elbow at shoulder height. Step through gently until the chest opens. Don\'t force it.' },
  { id:'st-crossbody', name:'Cross-body shoulder stretch', muscles:['shoulders'], perSide:true, hold:30, instr:'Bring one arm across your chest. Use the other arm to hug it in. Keep the shoulder down away from your ear.' },
  { id:'st-latreach', name:'Overhead side reach', muscles:['back','shoulders'], perSide:true, hold:30, instr:'Stand, one arm overhead. Lean sideways away from that arm. One long line from hip to fingertips.' },
  { id:'st-knees-chest', name:'Knees to chest', muscles:['back','glutes'], perSide:false, hold:35, instr:'Lie on your back. Hug both knees in. Rock gently side to side if that feels good.' },
  { id:'st-cobra', name:'Cobra stretch', muscles:['core','hipflex'], perSide:false, hold:35, instr:'Lie face down, hands under your shoulders. Push your chest up, hips stay on the floor. Stop where it feels good.' },
  { id:'st-downdog-calf', name:'Down-dog calf pedal', muscles:['calves','hams'], perSide:false, hold:40, instr:'Hands and feet on the floor, hips high like a triangle. Slowly pedal your heels toward the floor, one at a time.' },
  /* Added because an upper-body day could previously only ever find ONE chest
     stretch (and one quad, one adductor) — the library was too thin to fill a
     routine from what an upper session actually trains. These sit at the end so
     the long-standing primaries above stay the first pick for each muscle. */
  { id:'st-chest-floor', name:'Floor chest opener', muscles:['chest','shoulders'], perSide:true, hold:35, instr:'Lie face down. Stretch one arm straight out to the side. Roll gently onto that shoulder until the chest opens.' },
  { id:'st-chest-clasp', name:'Hands-behind-back stretch', muscles:['chest','shoulders'], perSide:false, hold:30, instr:'Stand tall. Clasp your hands behind your back. Straighten your arms and lift them a little. Chest forward, shoulders down.' },
  { id:'st-openbook', name:'Open-book twist', muscles:['back','chest'], perSide:true, hold:35, instr:'Lie on your side, knees bent, arms together in front. Open the top arm across your body like a book. Follow your hand with your eyes.' },
  { id:'st-couch', name:'Couch stretch', muscles:['quads','hipflex'], perSide:true, hold:40, instr:'Kneel with your back foot up on a bench or couch. Tuck your tailbone under and stand the front leg tall. Strong one — ease into it.' },
  { id:'st-quad-side', name:'Side-lying quad stretch', muscles:['quads'], perSide:true, hold:35, instr:'Lie on your side. Grab the top ankle and draw your heel toward your backside. Knees stacked, hips pushed forward.' },
  { id:'st-sidelunge', name:'Side lunge groin stretch', muscles:['adductors'], perSide:true, hold:35, instr:'Stand wide. Bend one knee and sink your weight onto it, the other leg straight. Feel the inside of the straight leg.' },
  { id:'st-ham-seated', name:'Seated forward fold', muscles:['hams','back'], perSide:false, hold:40, instr:'Sit with your legs out in front. Hinge from the hips and reach toward your feet. Long back, soft knees if you need them.' },
  /* Added for the hypertrophy phase — biceps/triceps had no stretch anywhere in
     the library, so an arm-heavy session could never get one. */
  { id:'st-bicep-wall', name:'Bicep wall stretch', muscles:['biceps'], perSide:true, hold:30, instr:'Stand side-on to a wall. Place your palm flat against it behind you, arm straight, thumb pointing down. Turn your body slowly away from the wall.' },
  { id:'st-bicep-doorway', name:'Doorway bicep stretch', muscles:['biceps'], perSide:true, hold:30, instr:'Stand in a doorway. Place one straight arm along the frame behind you, roughly shoulder height. Lean your body forward and away from that arm.' },
  { id:'st-tricep-overhead', name:'Overhead triceps stretch', muscles:['triceps'], perSide:true, hold:30, instr:'Reach one arm overhead, then bend the elbow so your hand drops behind your head. Use the other hand to gently press the elbow back and down.' },
  { id:'st-tricep-doorway', name:'Doorway triceps stretch', muscles:['triceps'], perSide:true, hold:30, instr:'Bend one elbow overhead, hand dropping behind your head. Gently press that elbow into a wall or door frame for a deeper stretch than your hand alone gives.' },
];

/* =====================================================================
   STRETCH ROUTINE BUILDER
   =====================================================================
   Runner essentials (calves, hip flexors, glutes, hamstrings) used to be placed
   FIRST unconditionally, ahead of anything the session actually trained. On an
   upper-body day they ate the whole time budget before chest/back/shoulders were
   even considered — a 5-minute routine after Upper A contained zero stretches for
   anything that had been worked.

   The fix is priority and proportion, not deletion. The essentials still belong in
   every routine: this is a running app, and those four take their load from RUNNING
   as much as from lifting, so they need attention on an upper day too. But they are
   a TAIL, not the head, and they are capped at a share of the budget:

     1. what you just trained, hardest-worked muscle first  (>= TRAINED_SHARE of time)
     2. runner essentials you did NOT train — a shorter maintenance dose, capped
     3. leftover time — a second stretch for the muscles you worked hardest

   Callers can also pass synthetic loads for a recent long run (see
   buildStretchRoutine in app.js), which is how "day after a long run" gets its
   calves and hamstrings back to the front on an upper day — as trained muscles,
   through rule 1, rather than as a special case. */
const STRETCH_ESSENTIALS = ['calves', 'hipflex', 'glutes', 'hams'];
const TRAINED_SHARE = 0.65;   // at least this much of the budget goes to what was trained

/* Wall-clock cost of one stretch: every hold is preceded by a STRETCH_SETUP_SECS
   "get ready" gap, and a per-side stretch pays for both a setup and a hold twice. */
function stretchDur(st, hold) {
  const h = hold != null ? hold : st.hold;
  /* Prep items carry their own, shorter setup gap (see PREP_SETUP_SECS): ten
     seconds to get down into a floor stretch is right, ten seconds before leg
     swings is dead air. Anything without an explicit setup keeps the original. */
  const setup = st.setup != null ? st.setup : STRETCH_SETUP_SECS;
  return (setup + h) * (st.perSide ? 2 : 1);
}

/* loads: { muscle: setsCompleted }. opts: { soreBias }.
   Pure — no app state — so tools/test-stretch.js can drive it directly. */
function stretchRoutine(loads, mins, opts) {
  opts = opts || {};
  loads = loads || {};
  const budget = mins * 60;
  const trained = Object.keys(loads).filter(m => loads[m] > 0).sort((a, b) => loads[b] - loads[a]);
  // Nothing logged (mobility/rest day): fall back to the essentials as the routine,
  // uncapped — otherwise the share cap would leave almost nothing to do.
  const bare = !trained.length;
  const tail = STRETCH_ESSENTIALS.filter(m => !loads[m]);
  const tailCap = bare ? budget : budget * (1 - TRAINED_SHARE);

  const used = new Set(); const list = []; let total = 0; let tailTime = 0;
  const nextFor = m => STRETCHES.find(x => x.muscles.includes(m) && !used.has(x.id));
  const take = (st, hold, isTail) => {
    const d = stretchDur(st, hold);
    if (total + d > budget + 20) return false;
    if (isTail && tailTime + d > tailCap + 20) return false;
    used.add(st.id); list.push({ ...st, hold }); total += d;
    if (isTail) tailTime += d;
    return true;
  };

  // 1. what you actually trained, hardest-worked first — longer holds where the
  //    volume was heavy (6+ sets through a muscle)
  for (const m of trained) {
    const st = nextFor(m); if (!st) continue;
    take(st, loads[m] >= 6 ? Math.max(st.hold, 40) : st.hold, false);
  }
  // 2. runner essentials that today did not train — maintenance dose, capped share.
  //    Sore days get the full hold instead of the short one.
  for (const m of tail) {
    const st = nextFor(m); if (!st) continue;
    take(st, opts.soreBias ? Math.max(st.hold, 45) : Math.min(st.hold, 30), true);
  }
  // 3. spend whatever is left on the muscles that took the most work
  for (const m of trained) {
    const st = nextFor(m); if (!st) continue;
    take(st, st.hold, false);
  }
  return { list, total };
}

/* =====================================================================
   ON-DEMAND, AREA-TARGETED STRETCHING — no workout required
   =====================================================================
   For "I'm sore/tight right now," not for what a session just trained.
   Deliberately NOT stretchRoutine(): that builder always gives
   STRETCH_ESSENTIALS a guaranteed slot (right for a runner's post-session
   routine, meaningless when someone picked "shoulders" because that's what's
   bothering them) and dedupes to one stretch per muscle per call, which
   fights the actual goal here — depth on a couple of areas, not breadth
   across a whole session.

   Framing matters as much as the selection: this is range-of-motion and
   comfort work, not a diagnosis or treatment for pain. [S1][S2] The UI layer
   (app.js) is responsible for saying that plainly and persistently — this
   file only owns picking stretches and timing them honestly.

   [S1] Herbert RD, Gabriel M. "Effects of stretching before and after
        exercising on muscle soreness and risk of injury." BMJ 2002 —
        static stretching does not meaningfully reduce soreness.
   [S2] Hayden JA, Ellis J, Ogilvie R, Malmivaara A, van Tulder MW. "Exercise
        therapy for chronic low back pain." Cochrane Database Syst Rev —
        exercise therapy, not passive stretching alone, is the evidence-backed
        approach to actual back pain; this feature is deliberately NOT that.
   [S3] Thomas E, Bianco A, Paoli A, Palma A. "The Relation Between Stretching
        Typology and Stretching Duration: The Effects on Range of Motion."
        Int J Sports Med 2018 — roughly 60s total time-under-stretch per
        muscle per session captures most of the ROM benefit; more is
        diminishing returns, not "more thorough." Drives AREA_TARGET_SECS. */
const AREA_TARGET_SECS = 60;

/* Body-area picker → the existing STRETCHES muscle vocabulary. 'back' alone
   has to stand in for both neck/upper-back and lower-back complaints — there
   is no finer tag in the library — so Neck & Lower Back share it deliberately
   rather than inventing a distinction the content can't back up. */
const STRETCH_AREAS = [
  { id: 'neck',     label: 'Neck & upper back',   muscles: ['back', 'shoulders'] },
  { id: 'shoulder', label: 'Shoulders & chest',   muscles: ['shoulders', 'chest'] },
  { id: 'lowback',  label: 'Lower back',          muscles: ['back', 'core'] },
  { id: 'hip',      label: 'Hip & glutes',        muscles: ['glutes', 'hipflex', 'adductors'] },
  { id: 'thigh',    label: 'Front of hip/thigh',  muscles: ['quads', 'hipflex'] },
  { id: 'hams',     label: 'Hamstrings',          muscles: ['hams'] },
  { id: 'calf',     label: 'Calves & Achilles',   muscles: ['calves'] },
  { id: 'arms',     label: 'Arms',                muscles: ['biceps', 'triceps'] },
];

/* muscleTags: array of muscle strings (already resolved from the areas the
   user picked — dedupe before calling if multiple areas were selected).
   Pure — no app state — so tools/test-stretch.js can drive it directly.

   Two passes: first one rep of every matching stretch (best-matching —
   most overlapping tags — first), then, budget allowing, repeat reps of
   the best match for any muscle still short of AREA_TARGET_SECS. A stretch
   can legally appear more than once in the returned list — startRoutine()/
   vStretch() just play whatever's there, no dedup of their own. */
function areaStretchRoutine(muscleTags, mins) {
  const budget = mins * 60;
  const tagSet = new Set(muscleTags);
  const candidates = STRETCHES.filter(st => st.muscles.some(m => tagSet.has(m)));
  const ranked = candidates
    .map((st, i) => ({ st, score: st.muscles.filter(m => tagSet.has(m)).length, i }))
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map(x => x.st);

  const list = []; let total = 0;
  const exposure = {}; for (const m of muscleTags) exposure[m] = 0;
  const add = st => {
    const d = stretchDur(st);
    if (total + d > budget + 20) return false;
    list.push({ ...st }); total += d;
    const gain = st.hold * (st.perSide ? 2 : 1);
    for (const m of st.muscles) if (m in exposure) exposure[m] += gain;
    return true;
  };

  // pass 1: one rep of everything relevant, best match first
  for (const st of ranked) add(st);
  // pass 2: top up any muscle still short of the evidence-based target [S3],
  // repeating its best-matching stretch until it clears the target or the
  // budget runs out
  for (const m of muscleTags) {
    const best = ranked.find(st => st.muscles.includes(m));
    if (!best) continue;
    while (exposure[m] < AREA_TARGET_SECS) { if (!add(best)) return { list, total }; }
  }
  return { list, total };
}

/* soreLog: [{date, areas:[STRETCH_AREAS ids]}], appended once per picked
   session in app.js. This does not diagnose anything — it just notices when
   the same area keeps coming back, which is exactly the kind of pattern
   worth an actual assessment rather than more stretching. Pure — no app
   state — so tools/test-stretch.js can drive it directly.
   Returns [{areaId, count}] for areas picked >= threshold times within the
   trailing `days`-day window, most-picked first. */
function sorePattern(soreLog, todayISO, days, threshold) {
  const cutoff = dadd(todayISO, -(days || 30));
  const counts = {};
  for (const entry of (soreLog || [])) {
    if (!entry || entry.date < cutoff) continue;
    for (const a of (entry.areas || [])) counts[a] = (counts[a] || 0) + 1;
  }
  return Object.entries(counts)
    .filter(([, c]) => c >= (threshold || 3))
    .map(([areaId, count]) => ({ areaId, count }))
    .sort((a, b) => b.count - a.count);
}

/* Pure judgment call on whether a recent-vs-prior set count for a muscle
   group counts as a "notable" increase — correlational context to sit
   alongside a sorePattern() hit, never framed as a cause. Deliberately
   conservative: a floor on the absolute set count (6) so a 2-vs-1 blip never
   qualifies, and a 30% jump on top of that for the case where there IS a
   real prior baseline. Returns a plain "X → Y sets" fragment, or null if the
   shift isn't worth mentioning. app.js supplies the actual set counts (it
   owns ST.sessions) — this file only owns the threshold judgment. */
function volumeShiftNote(recentSets, priorSets) {
  if (recentSets < 6) return null;
  if (priorSets === 0) return `0 → ${recentSets} sets`;
  if (recentSets / priorSets >= 1.3) return `${priorSets} → ${recentSets} sets`;
  return null;
}

/* =====================================================================
   MOVEMENT PREP — the routine that runs BEFORE a session
   =====================================================================
   Evidence base, cited the same way as the progression engine below, so a
   future change can be checked against the literature rather than vibes.

   [1] Behm DG, Chaouachi A. "A review of the acute effects of static and dynamic
       stretching on performance." Eur J Appl Physiol 2011;111(11):2633-51.
   [2] Simic L, Sarabon N, Markovic G. "Does pre-exercise static stretching
       inhibit maximal muscular performance? A meta-analysis." Scand J Med Sci
       Sports 2013;23(2):131-48.
   [3] Behm DG, Blazevich AJ, Kay AD, McHugh M. "Acute effects of muscle
       stretching on physical performance, range of motion, and injury incidence
       in healthy active individuals." Appl Physiol Nutr Metab 2016;41(1):1-11.
   [4] Jeffreys I. "Warm-up revisited — the RAMP method." UKSCA 2006.

   Two rules follow, and the whole library is built around them.

   NOTHING IS HELD. [1][2][3] Static holds at or beyond ~60s per muscle
   measurably cut force and power output; below ~30s the effect is trivial but
   there is still nothing to gain. So every item here is a movement, not a hold,
   and STRETCHES above — the post-session library — must never be used to build
   a prep routine. tools/test-warmup.js asserts exactly that, because reaching
   for the ready-made muscle-tagged stretch library is the obvious shortcut and
   the wrong call.

   MOBILISE, THEN ACTIVATE. [4] RAMP is Raise, Activate, Mobilise, Potentiate.
   Two of those four are deliberately absent here because they are already
   covered elsewhere:
     - Potentiate, for lifts, is the barbell ramp in warmupPlan().
     - Raise, for runs, is the first easy kilometre of the run itself. This app
       does NOT prescribe a warm-up jog, strides or running drills before a run —
       a deliberate product decision, not an oversight. Nothing in PREPS involves
       going anywhere.
   What is left is the part nothing else covers: take the joints the session will
   use through their range, then switch on the muscles that will do the work.
   Run continuously with short setup gaps, a six-minute circuit of this raises
   muscle temperature on its own.
   ===================================================================== */

/* Prep items are movements, so the "get ready" gap is half the stretch one —
   you are already standing up. stretchDur() honours the per-item override. */
const PREP_SETUP_SECS = 5;

/* work = seconds of movement (per side when perSide). The rep target lives in
   the instruction rather than in a counter: every time estimate in this app
   derives from durations, and a rep-counted item would make the "~N min"
   buttons and the "time left" readout lie. tier orders the routine — every
   mobilise item runs before any activate item. */
const PREPS = [
  // ---- mobilise ----
  { id:'wu-ankle-rock',  name:'Ankle rocks',            muscles:['calves'],              tier:'mobilise', perSide:true,  work:30, instr:'Stand facing a wall, one foot forward. Drive that knee forward over your toes and back. Heel stays down. About 15 rocks.' },
  { id:'wu-legswing-fb', name:'Leg swings, front to back', muscles:['hipflex','hams'],   tier:'mobilise', perSide:true,  work:30, instr:'Hold a wall. Swing one leg forward and back, relaxed and loose. Let the range build. About 15 swings.' },
  { id:'wu-legswing-lr', name:'Leg swings, side to side', muscles:['adductors','glutes'],tier:'mobilise', perSide:true,  work:30, instr:'Face the wall, hands on it. Swing one leg across your body and out. Keep your hips facing forward. About 15 swings.' },
  { id:'wu-9090',        name:'90-90 hip switches',     muscles:['hipflex','glutes'],    tier:'mobilise', perSide:false, work:40, instr:'Sit with both knees bent, one leg in front, one to the side. Rotate your knees over to the other side. Slow, controlled, back and forth.' },
  { id:'wu-worldgreat',  name:'Deep lunge with a turn',  muscles:['hipflex','hams','back'], tier:'mobilise', perSide:true, work:35, instr:'Step into a long lunge, both hands inside the front foot. Reach the inside arm up and follow it with your eyes. Step back, repeat.' },
  { id:'wu-catcow',      name:'Cat-cow',                muscles:['back','core'],         tier:'mobilise', perSide:false, work:30, instr:'On hands and knees. Round your back up, then let it sag and lift your chest. Move with your breathing.' },
  { id:'wu-tspine',      name:'Open-book rotations',    muscles:['back','chest'],        tier:'mobilise', perSide:true,  work:30, instr:'On your side, knees bent, arms out in front. Sweep the top arm across and open your chest to the ceiling. Back and forth.' },
  { id:'wu-armcircle',   name:'Arm circles',            muscles:['shoulders'],           tier:'mobilise', perSide:false, work:30, instr:'Big slow circles forward, then backward. Let them get bigger as the shoulders free up.' },
  { id:'wu-wallslide',   name:'Wall slides',            muscles:['shoulders','chest'],   tier:'mobilise', perSide:false, work:30, instr:'Back to a wall, arms in a goalpost shape touching it. Slide them up overhead and back down. Keep contact if you can.' },
  { id:'wu-squat-deep',  name:'Bodyweight squats',      muscles:['quads','glutes'],      tier:'mobilise', perSide:false, work:35, instr:'Feet about shoulder width. Squat as deep as you comfortably go, stand tall. Slow down, no bouncing.' },
  { id:'wu-revlunge-dyn',name:'Reverse lunges',         muscles:['quads','hipflex'],     tier:'mobilise', perSide:true,  work:30, instr:'Step back into a lunge, back knee toward the floor, then drive up. Tall chest. About 8 each side.' },
  { id:'wu-inchworm',    name:'Inchworm walkouts',      muscles:['hams','core','shoulders'], tier:'mobilise', perSide:false, work:35, instr:'Bend and put your hands down. Walk them out to a plank, hold a beat, walk them back and stand up.' },
  { id:'wu-cossack',     name:'Side lunges',            muscles:['adductors','quads'],   tier:'mobilise', perSide:true,  work:30, instr:'Stand wide. Sink your weight onto one bent leg, the other stays straight. Push across to the other side.' },
  { id:'wu-elbowswing',  name:'Elbow swings',           muscles:['biceps','triceps'],    tier:'mobilise', perSide:true,  work:30, instr:'Stand tall, arm relaxed at your side. Swing your forearm up toward your shoulder and back down, loose and rhythmic. About 15 each side.' },

  // ---- activate ----
  { id:'wu-glutebridge', name:'Glute bridges',          muscles:['glutes'],              tier:'activate', perSide:false, work:30, instr:'On your back, knees bent. Drive your hips up, squeeze hard at the top for a beat, lower. About 15.' },
  { id:'wu-monster',     name:'Lateral band walks',     muscles:['glutes','adductors'],  tier:'activate', perSide:false, work:35, instr:'Band round your shins or knees, small squat. Step sideways one way, then back. No band? Just step wide and slow.' },
  { id:'wu-calfraise',   name:'Calf raises',            muscles:['calves'],              tier:'activate', perSide:false, work:30, instr:'Stand tall, rise onto your toes, lower slow. Straight knees. About 15.' },
  { id:'wu-soleus',      name:'Bent-knee calf raises',  muscles:['calves'],              tier:'activate', perSide:false, work:30, instr:'Same again but with your knees slightly bent the whole time. This one wakes up the deep calf muscle underneath.' },
  { id:'wu-kneedrive',   name:'Standing knee drives',   muscles:['hipflex','core'],      tier:'activate', perSide:true,  work:30, instr:'Stand tall, hold something if you need to. Drive one knee up to hip height and lower it under control. About 12 each side.' },
  { id:'wu-deadbug',     name:'Dead bugs',              muscles:['core'],                tier:'activate', perSide:false, work:40, instr:'On your back, arms up, knees over hips. Lower one arm and the opposite leg, then swap. Lower back stays flat.' },
  { id:'wu-birddog',     name:'Bird dogs',              muscles:['core','back','glutes'],tier:'activate', perSide:true,  work:30, instr:'On hands and knees. Reach one arm forward and the opposite leg back. Hips level, no twisting. Swap slowly.' },
  { id:'wu-slbalance',   name:'Single-leg reaches',     muscles:['glutes','calves'],     tier:'activate', perSide:true,  work:30, instr:'Stand on one leg. Reach the other foot forward, out, then behind you, tapping lightly. Stay tall.' },
  { id:'wu-bandpull',    name:'Band pull-aparts',       muscles:['shoulders','back'],    tier:'activate', perSide:false, work:30, instr:'Band at chest height, arms straight. Pull it apart to your chest, control it back. No band? Squeeze your shoulder blades together instead.' },
  { id:'wu-scappush',    name:'Scap push-ups',          muscles:['chest','shoulders'],   tier:'activate', perSide:false, work:30, instr:'In a plank or against a wall, arms straight. Let your chest sink between your shoulder blades, then push it away. Elbows stay locked.' },
  { id:'wu-planktap',    name:'Plank shoulder taps',    muscles:['core','shoulders'],    tier:'activate', perSide:false, work:30, instr:'High plank, feet wide. Tap one hand to the opposite shoulder, then swap. Stop your hips rocking.' },
  { id:'wu-hamcurl-sl',  name:'Standing hamstring curls', muscles:['hams'],              tier:'activate', perSide:true,  work:30, instr:'Stand tall, hold something. Curl one heel up toward your backside and lower it slow. About 12 each side.' },
  /* Added for the hypertrophy phase — biceps/triceps had no warm-up item either. */
  { id:'wu-armpump',     name:'Light arm pumps',          muscles:['biceps'],              tier:'activate', perSide:false, work:30, instr:'Empty bar or light dumbbells, easy curls — nowhere near working weight. About 12, just getting blood into the muscle.' },
  { id:'wu-benchdip',    name:'Bench dips',               muscles:['triceps'],             tier:'activate', perSide:false, work:30, instr:'Hands on a bench behind you, feet out in front. Bend your elbows and lower a little, then press back up. About 12, easy range.' },
];

/* =====================================================================
   PREP INSIGHTS — "why am I doing this before I train?"
   Every PREPS entry MUST have one: { why, deep }. Same contract and same voice
   as INSIGHTS above, with one deliberate difference — a warm-up movement's job
   is to PREPARE, not to build. These say what it buys you in the next hour, not
   what it adapts over a block. Claiming otherwise would be the easy lie here.
   tools/test-warmup.js fails the build if an entry is missing.
   ===================================================================== */
const PREP_INSIGHTS = {
  'wu-ankle-rock': { why: 'Your ankle needs to bend about ten degrees past vertical for a normal stride. Thirty seconds there first means your foot isn\'t hunting for that range on the first kilometre.', deep: 'Dorsiflexion — the shin travelling forward over a planted foot — is the most commonly limiting joint range in both running and squatting. When it is short the body finds the range elsewhere: the foot rolls in, the knee drifts, the heel lifts early. Rocking into the range under bodyweight restores what is available today without the force loss a long static hold would cost you.' },
  'wu-legswing-fb': { why: 'Takes your hip through the exact arc it is about to repeat several thousand times, before any of those reps happen at speed.', deep: 'Running is hip flexion and extension repeated quickly, and the hamstring\'s most vulnerable moment is late swing — lengthened, decelerating the shin. Swinging the leg freely rehearses that arc at low speed and low force, raising tissue temperature while the range builds progressively. Relaxed and rhythmic beats forced: you are opening a door, not kicking it down.' },
  'wu-legswing-lr': { why: 'Running is almost entirely forward and back, which is exactly why the sideways range quietly disappears. This keeps it.', deep: 'The adductors and lateral hip stabilise the pelvis every time you land on one leg, but they rarely get taken through their full side-to-side range in a week made of running and lifting. Swinging across the body and out restores that range cheaply and warms the groin musculature — a common place to pick up a niggle on cambered roads.' },
  'wu-9090': { why: 'Rotation is the hip range you lose first and miss most. This finds today\'s honest amount before you ask the joint to work.', deep: 'The hip is a ball joint with rotation available both ways, and both sitting and running narrow it. Switching between 90-90 positions moves the joint through internal and external rotation under no load at all. Restricted hip rotation tends to get borrowed from the lower back, so this is spine maintenance as much as hip work.' },
  'wu-worldgreat': { why: 'One movement that opens the hip, the hamstring and the upper back — the three places a session is most likely to find you stiff.', deep: 'The deep lunge loads the front hip while the back leg\'s hip flexor is taken into length, and the reach adds thoracic rotation. Doing them together is time-efficient and closer to how the body actually moves than isolating each. For a runner it hits the specific combination that long hours of sitting most reliably takes away.' },
  'wu-catcow': { why: 'Wakes the spine up segment by segment so your trunk can do its real job — staying quiet while your legs move.', deep: 'Running asks the trunk to resist movement rather than produce it, but a spine that has not moved all morning stiffens into a single block. Flexing and extending through full range, slowly and with the breath, restores segmental motion and raises temperature around the spinal muscles. It costs almost nothing and makes everything after it feel less rigid.' },
  'wu-tspine': { why: 'Your upper back rotates with every arm swing. If it will not, your lower back does it instead — and it is not built for that.', deep: 'The thoracic spine is designed for rotation; the lumbar spine mostly is not. When the upper back stiffens, rotational demand migrates down to a region that resists it, which is a well-trodden route to low-back irritation in runners and lifters alike. Open-books restore that rotation on the floor, where the pelvis cannot cheat the movement.' },
  'wu-armcircle': { why: 'Thirty seconds of blood flow through the shoulder before you ask it to press or pull anything.', deep: 'The shoulder has the largest range of any joint and the least bony stability, so it leans on soft tissue that works better warm. Big slow circles raise temperature through the cuff and deltoid without loading them — which is the whole point of a raise-and-mobilise item: prepare the tissue, spend nothing.' },
  'wu-wallslide': { why: 'Teaches the shoulder blade to travel properly before you ask it to do that under a loaded barbell.', deep: 'Pressing overhead requires the shoulder blade to rotate upward as the arm rises; when it does not, the space the tendons pass through narrows. Wall slides rehearse that upward rotation against a surface that gives instant feedback about whether you are arching your back to fake the range rather than finding it at the shoulder.' },
  'wu-squat-deep': { why: 'The cheapest way to warm the whole leg — knees, hips and ankles moving together under nothing but your own weight.', deep: 'A bodyweight squat takes every major lower-body joint through a large range at once, which raises muscle temperature faster than isolated drills do. For a lifter it doubles as a rehearsal of the pattern about to be loaded; for a runner it is an honest check on what the knees and ankles are offering today, before you go and repeat a much smaller range for an hour.' },
  'wu-revlunge-dyn': { why: 'Splits your stance the way running does — one leg at a time — and opens the hip flexor of the leg behind you.', deep: 'Every stride is a split stance, yet most warm-ups stay square. Stepping back loads the front leg\'s quad and glute while lengthening the rear hip flexor through movement rather than a held stretch. The reverse direction keeps the shin more vertical than a forward lunge, which is kinder to the knee while the legs are still cold.' },
  'wu-inchworm': { why: 'Walks you through hamstring length, a plank and a shoulder position in one movement — a whole-body wake-up in half a minute.', deep: 'The walkout lengthens the hamstrings dynamically on the way out, asks the trunk to hold a plank at the far end, then reverses it. Because it is continuous rather than held, it raises temperature while restoring range — the distinction that matters before a session rather than after one. It is also a fair self-test: wherever the walkout feels worst today is what needs your attention.' },
  'wu-cossack': { why: 'Loads the inside of your thigh through range — the direction running never trains and cambered roads keep demanding.', deep: 'Side lunges take the adductors into length while the opposite quad and glute work, covering the frontal plane that a running-and-lifting week almost entirely ignores. Groin strains tend to happen at the end of available range under load, so visiting that range deliberately, unloaded and warm, is sensible before a session rather than after it.' },
  'wu-elbowswing': { why: 'Takes the elbow through its full range before you load either side of it — flexion and extension, biceps and triceps in one movement.', deep: 'A swinging, unloaded rep through full elbow flexion and extension raises temperature and rehearses the range both an arm curl and an arm extension are about to use, without spending anything on either muscle before the working sets do.' },
  'wu-glutebridge': { why: 'Gets the glutes firing before you train, so they lead hip extension instead of leaving your hamstrings to cover for them.', deep: 'Hip extension can be produced by the glutes or, less efficiently, largely by the hamstrings. After hours of sitting the glutes are often slow to switch on and the hamstrings — already the tissue most at risk in a runner — take a bigger share than they should. A short set of bridges with a genuine squeeze at the top raises glute activation before the work starts. This is the "activate" half of a warm-up doing its job.' },
  'wu-monster': { why: 'Switches on the side-hip muscles that stop your knee collapsing inward every time you land.', deep: 'Glute medius controls the pelvis in single-leg stance. When it is underactive the pelvis drops and the knee tracks inward on landing — a pattern associated with knee and ITB irritation in runners. Stepping sideways against resistance targets it directly and takes under a minute. No band is needed to get most of the benefit; slow, deliberate, wide steps will do.' },
  'wu-calfraise': { why: 'Your calves absorb several times bodyweight on every stride. Fifteen easy reps first is a small courtesy.', deep: 'The gastrocnemius crosses the knee and powers toe-off. Loading it gently through full range beforehand raises tissue temperature and rehearses the exact contraction it is about to repeat thousands of times. Calf and Achilles complaints are among the most common running injuries, and the tissue measurably tolerates load better warm than cold.' },
  'wu-soleus': { why: 'The deep calf muscle carries the highest force of any muscle when you run — and bending the knee is the only way a warm-up reaches it.', deep: 'With the knee bent the gastrocnemius goes slack and the soleus does the lifting. Modelling studies put peak soleus force during running above any other muscle in the body, and it is a frequent hidden source of shin and Achilles trouble. Every straight-legged movement lets it hide, so thirty seconds of bent-knee raises is the only reliable way to include it.' },
  'wu-kneedrive': { why: 'Rehearses the hip flexor drive that picks your knee up on every stride, without going anywhere to do it.', deep: 'The hip flexors do the swing-phase work of bringing the leg through, and they fatigue late in a long run. Driving the knee to hip height under control activates them through the range they are about to use, while the standing leg gets a moment of single-leg balance for free. The controlled lowering matters as much as the drive up.' },
  'wu-deadbug': { why: 'Trains your trunk to stay still while your arms and legs move — which is exactly its job when you run.', deep: 'The trunk\'s role in running is anti-movement: resisting the rotation and extension that swinging limbs would otherwise impose. Dead bugs isolate that demand precisely, moving opposite limbs while the lower back stays flat against the floor. If the back lifts, the trunk has stopped doing its job — which makes this an honest test as well as a warm-up.' },
  'wu-birddog': { why: 'The floor version of what your trunk does mid-stride: one arm forward, opposite leg back, hips refusing to twist.', deep: 'Bird dogs load the posterior trunk and glutes while demanding rotational stability through the pelvis — the same diagonal pattern walking and running use. Keeping the hips level is the entire exercise; the reach is just the challenge that makes it hard. Slow and level beats far and fast every time.' },
  'wu-slbalance': { why: 'Running is a series of one-legged landings. This reminds your ankle and hip of that before the first of them.', deep: 'Standing on one leg while reaching in different directions asks the foot, ankle and lateral hip to co-ordinate exactly as they do at mid-stance. It wakes the small stabilisers a warm-up otherwise skips, and it quietly surfaces asymmetry: the side that wobbles more is usually the side that has been compensating.' },
  'wu-bandpull': { why: 'Undoes the rounded-forward shoulder position before you load it — which matters more than it sounds.', deep: 'Pull-aparts activate the rear shoulder and the muscles that draw the shoulder blades together, the group a day at a desk leaves long and quiet. Doing them first puts the shoulder blade in a better position for whatever press follows. High reps, light resistance, no strain: this is a switch being flicked, not a set being trained.' },
  'wu-scappush': { why: 'Wakes up the muscle that holds your shoulder blade flat against your ribs — the foundation every press is built on.', deep: 'Serratus anterior keeps the shoulder blade flat and rotating properly as the arm moves. Scap push-ups isolate it by removing the elbow from the equation entirely: arms locked, only the shoulder blades travel. It is a small movement most people have never trained deliberately, and pressing feels noticeably more stable once it is switched on.' },
  'wu-planktap': { why: 'Anti-rotation with your bodyweight on one arm — the trunk demand of running, made obvious.', deep: 'Lifting one hand in a plank creates a rotational force the trunk has to cancel, the same job it does each time an arm swings while the opposite leg drives. Widening the feet makes it easier and narrowing them harder, so the difficulty is yours to set. Success is measured by the hips not rocking, never by the number of taps.' },
  'wu-hamcurl-sl': { why: 'Wakes the hamstring through the knee-bending action it performs on every stride, before you ask it for anything hard.', deep: 'The hamstrings both extend the hip and flex the knee, and the knee-bending role is the one warm-ups usually miss entirely. Curling the heel up under control activates the muscle through range while it is still unloaded. Given hamstrings are among the tissues a runner is most likely to strain, a few controlled reps beforehand is cheap insurance.' },
  'wu-armpump': { why: 'Blood into the biceps before you load them — a small dose, easy weight, well short of your working sets.', deep: 'Light, high-rep pumping work raises local blood flow and temperature in the muscle about to be trained, the same raise-before-load logic behind every item in this list. Kept deliberately far under working weight so it primes rather than pre-fatigues.' },
  'wu-benchdip': { why: 'Bodyweight triceps activation through a real range before you load the joint.', deep: 'Bench dips take the elbow through flexion and extension under nothing heavier than bodyweight, waking the triceps and rehearsing the lockout you are about to load. Easy range, easy pace — this is priming, not a set.' },
};
for (const id in PREP_INSIGHTS) { const p = PREPS.find(x => x.id === id); if (p) Object.assign(p, PREP_INSIGHTS[id]); }

const PREP_TIER_ORDER = { mobilise: 0, activate: 1 };
/* Ceiling on how much of a prep budget mobilising may spend — see prepRoutine. */
const PREP_MOBILISE_SHARE = 0.6;
const PREP_MOBILISE_SHARE_SORE = 0.75;

/* Synthetic muscle loads for a run, on the same scale as lift sets so the
   trained-share arithmetic in prepRoutine behaves identically for both. These
   describe what the run will DEMAND, not what a warm-up jog would do — there
   is no warm-up jog. Easy days get a light dose; long and hard days weight the
   posterior chain and hip flexors up, because that is what goes first. */
const RUN_LOADS = {
  easy: { calves: 4, glutes: 3, hams: 3, quads: 2, hipflex: 3 },
  hard: { calves: 6, glutes: 5, hams: 5, quads: 4, hipflex: 4 },
  long: { calves: 6, hams: 6, glutes: 5, quads: 4, hipflex: 5 },
  race: { calves: 6, glutes: 5, hams: 5, quads: 4, hipflex: 5 },
};
/* Minutes of prep per run type. An easy recovery run does not need six minutes
   of anything; race morning does. */
const RUN_PREP_MINS = { easy: 4, hard: 6, long: 6, race: 8 };

function runType(day) {
  if (!day) return 'easy';
  if (day.kind === 'race') return 'race';
  const t = (day.title || '').toLowerCase();
  if (t.includes('hard')) return 'hard';
  if (t.includes('long')) return 'long';
  return 'easy';
}
function runLoads(day) { return { ...RUN_LOADS[runType(day)] }; }
function runPrepMins(day) { return RUN_PREP_MINS[runType(day)]; }

/* Loads a lift session is ABOUT to produce, from its template — the prep
   equivalent of the { muscle: setsCompleted } map buildStretchRoutine() derives
   from a finished session. Prescribed sets, because nothing is done yet.
   dateISO/mesoStartISO are optional and only matter for hypertrophy-phase
   templates carrying 'ROTATE:<pool>' sentinels (see materializeTemplate) —
   every other caller can omit them and get the exact old behaviour, since a
   template with no sentinel resolves identically either way. */
function plannedLoads(tplId, dateISO, mesoStartISO) {
  const tpl = dateISO ? materializeTemplate(tplId, dateISO, mesoStartISO) : TEMPLATES[tplId];
  const loads = {};
  if (!tpl) return loads;
  for (const [exId, sets] of tpl.items) {
    for (const m of (MUSCLE_MAP[exId] || [])) loads[m] = (loads[m] || 0) + sets;
  }
  return loads;
}

/* Same contract and the same three-pass shape as stretchRoutine, so the two are
   learnable as one idea: what the session will use (hardest-loaded first), then
   the runner essentials it will not, capped, then whatever budget is left.
   STRETCH_ESSENTIALS and TRAINED_SHARE are reused deliberately — "what a runner
   always needs a look at" is the same list coming or going.
   opts: { soreBias } — a sore body gets more mobilising and less activating,
   done by taking a second mobilise pass before activation is considered. */
function prepRoutine(loads, mins, opts) {
  opts = opts || {};
  loads = loads || {};
  const budget = mins * 60;
  const trained = Object.keys(loads).filter(m => loads[m] > 0).sort((a, b) => loads[b] - loads[a]);
  const bare = !trained.length;
  const tail = STRETCH_ESSENTIALS.filter(m => !loads[m]);
  const tailCap = bare ? budget : budget * (1 - TRAINED_SHARE);

  /* Mobilising is cheap to want and expensive to buy: one item per trained
     muscle will happily consume the entire budget and leave nothing switched
     on, which is a stretch routine wearing a warm-up's clothes. So mobilise is
     capped at a share of the budget exactly as the essentials tail is, and
     activation always has room left. A sore body gets a bigger mobilise share
     and correspondingly less activation. */
  /* Second cap, and it exists for the reason documented above stretchRoutine:
     two passes over today's muscles will otherwise consume the whole budget and
     leave an upper-body day with no calf or hip work at all — the exact
     regression that routine was fixed for. So the trained passes are held to
     TRAINED_SHARE and the essentials tail keeps its share. The final leftover
     pass is uncapped, so nothing is wasted when the tail comes up short. */
  const trainedCap = budget * TRAINED_SHARE;
  const mobCap = trainedCap * (opts.soreBias ? PREP_MOBILISE_SHARE_SORE : PREP_MOBILISE_SHARE);

  const used = new Set(); const list = []; let total = 0; let tailTime = 0; let mobTime = 0; let trainedTime = 0;
  const nextFor = (m, tier) => PREPS.find(x => x.muscles.includes(m) && !used.has(x.id) && (!tier || x.tier === tier));
  const take = (p, isTail, capped) => {
    const item = { ...p, hold: p.work, setup: PREP_SETUP_SECS };
    const d = stretchDur(item);
    if (total + d > budget + 20) return false;
    if (isTail && tailTime + d > tailCap + 20) return false;
    if (!isTail && capped && trainedTime + d > trainedCap + 20) return false;
    if (capped && p.tier === 'mobilise' && mobTime + d > mobCap + 20) return false;
    used.add(p.id); list.push(item); total += d;
    if (isTail) tailTime += d; else trainedTime += d;
    if (p.tier === 'mobilise') mobTime += d;
    return true;
  };
  const pass = (muscles, tier, isTail, capped) => {
    for (const m of muscles) { const p = nextFor(m, tier); if (p) take(p, isTail, capped); }
  };

  pass(trained, 'mobilise', false, true);                 // 1. free up what today will use, capped
  pass(trained, 'activate', false, true);                 // 2. switch it on, within the same share
  pass(tail, null, true, false);                          // 3. runner essentials today skips, capped
  pass(trained, null, false, false);                      // 4. spend what is left on the heaviest-loaded

  // RAMP order is a property of the routine, not of the selection: mobilise
  // everything before activating anything. Sort is stable, so muscle priority
  // survives inside each tier.
  list.sort((a, b) => PREP_TIER_ORDER[a.tier] - PREP_TIER_ORDER[b.tier]);
  return { list, total };
}

/* Session templates. items: [exId, sets, reps] — reps is per side for perSide, seconds for 'time', metres for 'carry'. */
const TEMPLATES = {
  /* build-phase sessions extended after week-1 feedback (finished in ~20 min):
     +1 exercise on lower A, +1 set on most mains. Race/taper weeks stay deliberately short. */
  lowerA:        { title: 'Lower A · Light', est: 48, items: [['boxjump', 3, 3], ['bss', 4, 8], ['slrdl', 3, 8], ['slhipthrust', 3, 10], ['calfstand', 4, 10], ['copen', 3, 30]] },
  lowerA_noplyo: { title: 'Lower A · Light', est: 44, items: [['bss', 4, 8], ['slrdl', 3, 8], ['slhipthrust', 3, 10], ['calfstand', 4, 10], ['copen', 3, 30]] },
  lowerB:        { title: 'Lower B · Heavy', est: 50, items: [['boxjump', 3, 3], ['squat', 5, 4], ['rdl', 4, 6], ['hipthrust', 3, 8], ['calfseat', 4, 12]] },
  upperA:        { title: 'Upper A', est: 45, items: [['bench', 5, 5], ['pullup', 5, 6], ['dbrow', 4, 8], ['pallof', 3, 12], ['carry', 4, 30]] },
  upperB:        { title: 'Upper B', est: 45, items: [['ohp', 5, 5], ['csrow', 4, 8], ['incline', 4, 8], ['facepull', 4, 15], ['abwheel', 4, 10]] },
  /* TAPER VOLUME — sized from Bosquet et al. 2007 (see PROGRESSION ENGINE header,
     ref [4]): the biggest performance gains came from cutting training VOLUME by
     roughly 41-60% while HOLDING intensity and frequency. So taper templates keep
     the same rep schemes and loads (the progression engine freezes the load) and
     cut sets only. Peak build week is 81 sets; the taper weeks below land at
     32-34, i.e. a 58-60% cut — the deep end of the band, because these weeks have
     only three lift days (the fourth slot is race-eve mobility). Nothing new is
     introduced in a taper week by design. */
  // Geelong (B race) mini-taper — no plyo, nothing heavy after Tue
  lowerTaperG:   { title: 'Lower · Geelong taper', est: 32, items: [['bss', 3, 6], ['slrdl', 2, 6], ['calfstand', 3, 8], ['copen', 2, 20]] },
  upperLight:    { title: 'Upper · Light', est: 32, items: [['bench', 4, 5], ['pullup', 4, 5], ['pallof', 3, 10]] },
  upperLightB:   { title: 'Upper · Light', est: 32, items: [['ohp', 4, 5], ['csrow', 4, 8], ['facepull', 3, 15]] },
  // Week 6 — rebuild
  lowerFinal:    { title: 'Lower · Final stimulus', est: 35, items: [['squat', 3, 5], ['rdl', 2, 6], ['hipthrust', 2, 8], ['calfseat', 2, 12]] },
  upperMod:      { title: 'Upper · Moderate', est: 30, items: [['ohp', 3, 5], ['csrow', 3, 8], ['incline', 2, 8], ['abwheel', 2, 10]] },
  // Melbourne taper week — volume ~58% down on peak, intensity untouched (heavy
  // triples stay heavy triples), no plyo. Four lift days here, 34 sets total. [4]
  lowerTaperA:   { title: 'Lower · Taper', est: 30, items: [['bss', 3, 6], ['slrdl', 2, 6], ['calfstand', 3, 8], ['copen', 2, 20]] },
  lowerTaperB:   { title: 'Lower · Taper (crisp)', est: 26, items: [['squat', 3, 3], ['calfseat', 3, 10]] },
  upperTaperA:   { title: 'Upper · Taper', est: 28, items: [['bench', 4, 4], ['pullup', 3, 5], ['pallof', 3, 10]] },
  upperTaperB:   { title: 'Upper · Taper (optional)', est: 24, items: [['ohp', 3, 5], ['csrow', 3, 8], ['facepull', 2, 15]] },
  // Week 8 — race week primer
  primer:        { title: 'Full-Body Primer · Very light', est: 25, items: [['squat', 2, 5], ['bench', 2, 8], ['csrow', 2, 10], ['calfstand', 2, 10]] },
  // Maintenance mode (post-Melbourne): 3 flexible sessions/week, ~40 min each
  maintLower:    { title: 'Maintenance · Lower', est: 40, items: [['squat', 3, 5], ['rdl', 3, 6], ['bss', 3, 8], ['calfstand', 3, 10], ['copen', 3, 30]] },
  maintUpper:    { title: 'Maintenance · Upper', est: 38, items: [['bench', 3, 5], ['csrow', 3, 8], ['ohp', 2, 6], ['pullup', 3, 6], ['pallof', 3, 12]] },
  maintFull:     { title: 'Maintenance · Full Body', est: 42, items: [['hipthrust', 3, 8], ['incline', 3, 8], ['slrdl', 3, 8], ['dbrow', 3, 8], ['calfseat', 3, 12], ['abwheel', 3, 10]] },
  // Post-race recovery week: one very light session, movement over load
  recoverySession:{ title: 'Recovery · Move & Loosen', est: 25, items: [['glutebridge', 2, 10], ['pushup', 2, 8], ['bandpull', 2, 15], ['calfstand', 2, 10]] },

  /* Hypertrophy phase (post-Melbourne, optional): 5 sessions/week, chest and
     arms at 2x/week frequency, legs held at maintenance (reuses maintLower
     above unchanged — see HYPER_ORDER). A 'ROTATE:<pool>' sentinel in place
     of an exId means "resolve this from HYPER_POOLS via materializeTemplate()"
     — see that function below for why. */
  hyperChestTri:     { title: 'Chest & Triceps', est: 48, items: [['bench', 4, 6], ['ROTATE:chestAcc', 3, 10], ['pushdown', 3, 12], ['ROTATE:tricepsAcc', 3, 12]] },
  hyperBackBi:       { title: 'Back & Biceps', est: 48, items: [['pullup', 4, 6], ['ROTATE:backAcc', 3, 8], ['bbcurl', 3, 10], ['ROTATE:bicepsAcc', 3, 12]] },
  hyperShoulderArms: { title: 'Shoulders & Arms', est: 45, items: [['ohp', 4, 6], ['facepull', 3, 15], ['ROTATE:bicepsAcc', 3, 12], ['ROTATE:tricepsAcc', 3, 12]] },
  hyperChestBack:    { title: 'Chest & Back', est: 38, items: [['incline', 3, 10], ['dip', 3, 10], ['ROTATE:backAcc', 3, 10]] },
};

/* =====================================================================
   HYPERTROPHY PHASE — periodized exercise rotation
   =====================================================================
   Evidence base:
   [H1] Fonseca RM, Roschel H, Tricoli V, et al. "Changes in exercises are
        more effective than in loading schemes to improve muscle strength."
        J Strength Cond Res 2014 — varying exercise selection outperformed
        constant selection at matched progressive overload.
   [H2] Rhea MR, Alderman BL. "A meta-analysis of periodized versus
        nonperiodized strength and power training programs." Res Q Exerc
        Sport 2004 — periodized structuring outperforms non-periodized.
   [H3] Schoenfeld BJ, Grgic J, Krieger JW. "How many times per week should a
        muscle be trained to maximize hypertrophy?" J Sports Sci 2019 —
        2x/week beats 1x/week at equal volume (drives HYPER_ORDER's chest/arm
        frequency and TEMPLATES.hyper* above).

   Anchor lifts (bench, pullup, ohp, bbcurl, pushdown) are NOT in a pool and
   never rotate — they're what the app's e1RM trajectory/PR-book track over
   the whole phase, and rotating a tracked lift would keep resetting that
   history for no benefit. Only the accessory slots — the ones marked
   'ROTATE:<pool>' in TEMPLATES above — rotate, on a block boundary defined by
   HYPER_MESO_WEEKS. [H1][H2]

   HYPER_MESO_WEEKS sits inside the standard 4-6 week mesocycle range used in
   the periodization literature [H2]; verify the exact figure against current
   sources before treating it as more precise than "within that range." */
const HYPER_MESO_WEEKS = 5;
const HYPER_POOLS = {
  chestAcc:   ['incline', 'dbflye', 'dip'],
  backAcc:    ['csrow', 'dbrow', 'cablerow'],
  bicepsAcc:  ['hammercurl', 'inclinecurl'],
  tricepsAcc: ['overheadext', 'skullcrusher'],
};
/* Fixed weekly order — legs (reusing maintLower unchanged) sits mid-week
   between the two heaviest days. Referenced by app.js's hypertrophy
   maintenanceCard variant to offer the next session in sequence. */
const HYPER_ORDER = ['hyperChestTri', 'hyperBackBi', 'maintLower', 'hyperShoulderArms', 'hyperChestBack'];

/* Whole weeks elapsed between two ISO dates. Pure — both dates are inputs,
   never read from the clock — so rotation is exactly reproducible in tests. */
function weeksSince(startISO, todayISO) {
  const [sy, sm, sd] = startISO.split('-').map(Number);
  const [ty, tm, td] = todayISO.split('-').map(Number);
  const start = new Date(sy, sm - 1, sd);
  const t = new Date(ty, tm - 1, td);
  return Math.max(0, Math.floor((t - start) / (7 * 86400000)));
}
/* Which pool member is "live" for a given date. blockWeeks defaults to
   HYPER_MESO_WEEKS but takes a param so tests can drive it directly. */
function hyperExId(pool, startISO, todayISO, blockWeeks) {
  const idx = Math.floor(weeksSince(startISO, todayISO) / (blockWeeks || HYPER_MESO_WEEKS));
  return pool[idx % pool.length];
}
/* Resolves a TEMPLATES entry's 'ROTATE:<pool>' sentinels into real exIds for
   a given date, returning the same { title, est, items } shape a plain
   TEMPLATES entry has. Templates with no ROTATE sentinel pass through
   unchanged (mesoStartISO is simply unused), so this is safe to call for
   every tplId, not just hypertrophy ones — see buildSession() in app.js. */
function materializeTemplate(tplId, dateISO, mesoStartISO) {
  const tpl = TEMPLATES[tplId];
  if (!tpl) return null;
  const items = tpl.items.map(([exId, sets, reps]) => {
    if (typeof exId === 'string' && exId.startsWith('ROTATE:')) {
      const pool = HYPER_POOLS[exId.slice(7)];
      exId = hyperExId(pool, mesoStartISO, dateISO);
    }
    return [exId, sets, reps];
  });
  return { title: tpl.title, est: tpl.est, items };
}

/* race-week checklist defaults (editable per race in-app) */
/* Stable ids, not positional index — ST.races[key].checklist is keyed by
   item.id so reordering or inserting an item here can never scramble an
   existing user's checked state the way a plain array-of-strings did. */
const RACE_CHECKLIST = [
  { id: 'kit', text: 'Race kit laid out (shoes, socks, top, shorts, anti-chafe)' },
  { id: 'bib', text: 'Bib collected / registration confirmed' },
  { id: 'breakfast', text: 'Breakfast planned and tested (nothing new on race day)' },
  { id: 'fuel', text: 'Gels / fuel packed (~30-60g carbs per hour)' },
  { id: 'hydration', text: 'Hydration plan sorted (course drink stations checked)' },
  { id: 'pacing', text: 'Pacing plan set (check the app\'s projection — start conservative)' },
  { id: 'logistics', text: 'Transport & start-line logistics confirmed' },
  { id: 'taper', text: 'Trust the taper: feeling flat this week is normal and temporary' },
];
const RECOVERY_WEEK = [
  'Day 1-2: walk, eat, sleep. Nothing else — the race is still in your legs.',
  'Day 3: 20 minutes easy mobility or a gentle spin if you feel like moving.',
  'Day 4: optional Recovery workout in the app — light movement, zero grinding.',
  'Day 5-6: easy short jog if the legs feel genuinely fresh; skip guilt-free.',
  'Day 7: normal life resumes. Maintenance mode starts when you\'re ready.',
];

const WHY_SCHEDULE = `**Why this plan?**

Your runs are fixed: Wed hard, Fri easy, Sun long. Lifting fills Mon/Tue/Thu/Sat around them:

• **Thursday is the heavy lower day** — it's the only slot with no run in the 24h before or after that matters (Wed is done, Friday is easy). The real strength stimulus lives here, clear of your key runs.

• **Monday is the light lower day** — it follows the Sunday long run, so it's single-leg, calf and stability work at modest loads. Heavy lower here would compromise recovery.

• **Tue & Sat are upper days** — they sit directly before the Wed hard run and Sun long run, so no fresh leg fatigue is carried into either key run.

Week 1 is a short intro (Thu–Sun) so the program starts right away without waiting for Monday — two conservative sessions to groove the movements. Plyometrics (box jumps) run through the build weeks only (1–5), first in the session while fresh. Week 6 mini-tapers into Geelong (B race). Week 7 recovers, then one final lower session Thursday — the last real leg stimulus. Weeks 8–9 taper into Melbourne (A race).

**The taper rule:** cut the volume, keep the weights. Taper weeks drop to about 40% of peak sets (a ~60% cut) while the heavy triples stay heavy — that's the combination the tapering research backs, and it's why the app stops suggesting load increases in taper weeks instead of making the sessions feel easy. Race week is a primer only.`;

/* ---- date helpers (local time) ---- */
function dstr(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function dadd(iso, days) { const [y, m, dd] = iso.split('-').map(Number); const d = new Date(y, m - 1, dd + days); return dstr(d); }
function today() { return dstr(new Date()); }
/* Calling toLocaleDateString() with an options object builds a fresh Intl
   formatter every time, which is startlingly expensive in bulk: profiling the
   Progress → Log view found 45 ms of a 82 ms render sitting in this one
   function across 346 calls — more than half the cost of the slowest screen in
   the app. One shared formatter, plus a memo keyed on the ISO string, takes it
   to roughly nothing. The memo never needs clearing: a given date always
   formats to the same text, and it is bounded by how many distinct days exist. */
const _DTF = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
const _fmtDateMemo = new Map();
function fmtDate(iso) {
  if (!iso) return '—';
  let s = _fmtDateMemo.get(iso);
  if (s === undefined) {
    const [y, m, d] = iso.split('-').map(Number);
    s = _DTF.format(new Date(y, m - 1, d));
    _fmtDateMemo.set(iso, s);
  }
  return s;
}
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

/* =====================================================================
   PROGRESSION ENGINE — RPE autoregulation × program phase
   =====================================================================
   Evidence base. Each rule below cites the number(s) it rests on, so a future
   change can be checked against the same literature rather than vibes.

   [1] Zourdos MC, Klemp A, Dolan C, et al. "Novel Resistance Training-Specific
       Rating of Perceived Exertion Scale Measuring Repetitions in Reserve."
       J Strength Cond Res. 2016;30(1):267-275.
       → RPE maps to reps-in-reserve (RPE 10 = failure, RPE 8 ≈ 2 RIR). The gap
         between logged RPE and target RPE is therefore a meaningful estimate of
         how much load was left on the table, and is what drives load changes here.
   [2] Helms ER, Cronin J, Storey A, Zourdos MC. "Application of the Repetitions
       in Reserve-Based Rating of Perceived Exertion Scale for Resistance
       Training." Strength Cond J. 2016;38(4):42-49.
       → autoregulation: set the next session's load from the last session's
         RPE/RIR rather than from a fixed percentage schedule, because readiness
         varies day to day. This engine is that idea, per exercise variant.
   [3] ACSM Position Stand. "Progression Models in Resistance Training for Healthy
       Adults." Med Sci Sports Exerc. 2009;41(3):687-708.
       → when the target reps are met with reps to spare, add roughly 2-10% load,
         at the smaller end for upper body / small muscle groups. Hence the
         asymmetric lower-vs-upper increment percentages below.
   [4] Bosquet L, Montpetit J, Arvisais D, Mujika I. "Effects of tapering on
       performance: a meta-analysis." Med Sci Sports Exerc. 2007;39(8):1358-1365.
       → the largest performance gains came from a ~2-week taper that cut TRAINING
         VOLUME by roughly 41-60% while HOLDING intensity and frequency. So in
         taper phases: volume is cut by the session templates, and the load is
         held — never increased, never trimmed unless something went wrong.
   [5] Balsalobre-Fernández C, Santos-Concejero J, Grivas GV. "Effects of Strength
       Training on Running Economy in Highly Trained Runners: A Systematic Review
       With Meta-Analysis." J Strength Cond Res. 2016;30(8):2361-2368.
   [6] Blagrove RC, Howatson G, Hayes PR. "Effects of Strength Training on the
       Physiological Determinants of Middle- and Long-Distance Running
       Performance: A Systematic Review." Sports Med. 2018;48(5):1117-1149.
       → [5][6] heavy, low-rep strength work plus plyometrics improves running
         economy; high-rep hypertrophy work is not the mechanism. Consequence for
         this engine: progression goes into LOAD, and reps are always handed back
         unchanged from the template. Adding reps would drift a runner's session
         toward hypertrophy and away from the adaptation being bought.
   [7] Rønnestad BR, Mujika I. "Optimizing strength training for running and
       cycling endurance performance: a review." Scand J Med Sci Sports.
       2014;24(4):603-612.
       → heavy strength training complements endurance training provided running
         stays the priority. Hence: when RPE runs over target, hold or back off
         rather than push through, and say so out loud.
   [8] Rhea MR, Ball SD, Phillips WT, Burkett LN. "A comparison of linear and
       daily undulating periodized programs with equated volume and intensity for
       strength." J Strength Cond Res. 2002;16(2):250-255.
       → PERIODISATION CHOICE: daily-undulating (DUP) beat linear at equated
         volume/intensity. This program is already undulating within the week —
         Monday Lower A is light/single-leg at 8-10 reps, Thursday Lower B is
         heavy at 4-6 reps; Upper A and Upper B likewise differ. So progression is
         applied PER EXERCISE VARIANT against that variant's own history (see
         exHistory in app.js): the light day never inherits the heavy day's jump,
         and each slot undulates on its own track. That is the DUP model, and it
         is what the existing schedule already implies — a linear model would have
         required flattening the week, which would cost the runner the light day
         that protects the Sunday long run.

   VOLUME periodisation lives in TEMPLATES (sets × reps per phase), per [4].
   LOAD  periodisation lives here.
   ===================================================================== */

function roundToStep(w, step) { return Math.max(0, Math.round(w / step) * step); }

/* Phase policy. rpeAdj shifts the exercise's target RPE band for the phase;
   allowUp gates load increases; upMult/maxUpPct scale and cap them; cutPct
   forces a reduction (deload). Labels are used verbatim in the reason text. */
const PHASE_POLICY = {
  // Week 1-2 anatomical adaptation: groove the movements, tendons and connective
  // tissue lag muscle in adapting, so target RPE drops a point and increments are
  // halved and capped at 3%. [3] (low end of the range), [6] (base before load).
  intro:    { label: 'intro week', rpeAdj: -1, allowUp: true, upMult: 0.5, maxUpPct: 3, atTargetHold: true },
  // Build: the real progressive-overload phase. [2] drives size of jump, [3] caps it.
  build:    { label: 'build', rpeAdj: 0, allowUp: true, upMult: 1, maxUpPct: 7, atTargetHold: false },
  // Peak load week: same rules, slightly more headroom — the last week that pushes.
  peak:     { label: 'peak week', rpeAdj: 0, allowUp: true, upMult: 1, maxUpPct: 8, atTargetHold: false },
  // Post-B-race rebuild: race is in the legs, so half-size jumps for a week. [7]
  rebuild:  { label: 'rebuild week', rpeAdj: -0.5, allowUp: true, upMult: 0.6, maxUpPct: 4, atTargetHold: false },
  // Taper: hold intensity, cut volume — load is frozen. [4]
  taper:    { label: 'taper', rpeAdj: -1, allowUp: false, hold: 'Taper: intensity held, volume cut by the plan — load stays put.' },
  // Race week: primer only. Nothing should feel like work. [4]
  raceweek: { label: 'race week', rpeAdj: -2, allowUp: false, hold: 'Race week: this is a primer, not a session — same load, feel crisp and stop early.' },
  // Deload / reduced day (readiness red-amber or post-race recovery week): cut. [7]
  deload:   { label: 'deload', rpeAdj: -1, allowUp: false, cutPct: 10, hold: 'Light day: load cut ~10% on top of the reduced volume.' },
  // Maintenance (post-block): holding strength is the goal, not adding to it. [7]
  maint:    { label: 'maintenance', rpeAdj: -0.5, allowUp: true, upMult: 0.5, maxUpPct: 4, atTargetHold: true },
  // Hypertrophy phase (post-block, chest/arms priority): unlike maint this is not
  // just holding on — it's an ongoing growth phase and should keep pushing at
  // target RPE rather than parking there. rpeAdj 0 (full target band, not maint's
  // -0.5) and atTargetHold: false (never converts an on-target hit into a hold)
  // are what make that real; upMult sits between build's 1.0 and maint's 0.5
  // because this phase has no fixed end date to peak toward.
  hypertrophy: { label: 'hypertrophy phase', rpeAdj: 0, allowUp: true, upMult: 0.75, maxUpPct: 6, atTargetHold: false },
};
function phasePolicy(key) { return PHASE_POLICY[key] || PHASE_POLICY.build; }

/* week.phase string (set by buildProgram) → policy key. */
function phaseKeyFromLabel(label) {
  const s = String(label || '').toLowerCase();
  if (/maintenance/.test(s)) return 'maint';
  if (/race week/.test(s)) return 'raceweek';
  if (/taper/.test(s)) return 'taper';            // 'Taper' and 'Geelong mini-taper'
  if (/recover|rebuild/.test(s)) return 'rebuild';
  if (/intro/.test(s)) return 'intro';
  if (/peak/.test(s)) return 'peak';
  if (/build/.test(s)) return 'build';
  return 'build';
}

const clampRPE = v => Math.max(5, Math.min(10, Math.round(v * 2) / 2));
/* Target RPE band for an exercise in a phase — the exercise's own band [1],
   shifted by the phase. Returns null for exercises that aren't RPE-driven
   (plyos, planks, carries: those are quality/technique work, not load work). */
function targetRPEForPhase(exId, phaseKey) {
  const ex = EXERCISES[exId];
  if (!ex || !ex.rpe) return null;
  const p = phasePolicy(phaseKey);
  return [clampRPE(ex.rpe[0] + p.rpeAdj), clampRPE(ex.rpe[1] + p.rpeAdj)];
}
const rpeBandTxt = t => (t[0] === t[1] ? String(t[0]) : `${t[0]}–${t[1]}`);
const rirBandTxt = t => (t[0] === t[1] ? String(10 - t[1]) : `${10 - t[1]}–${10 - t[0]}`);
function meanOf(a) { return a.reduce((x, y) => x + y, 0) / a.length; }
/* mean RPE of the working sets of one past session for this exercise */
function sessionRPE(h) {
  if (!h) return null;
  const r = h.sets.filter(s => s.rpe != null && s.weight != null && s.reps > 0).map(s => s.rpe);
  return r.length ? meanOf(r) : null;
}

/* history: array of {date, sets:[{weight,reps,rpe,failed}]} for one exercise variant, oldest→newest.
   tplReps = the session's target reps for this exercise (per side where applicable).
   ctx     = { phase } — policy key from phaseKeyFromLabel (see progressionCtx in app.js).
   Returns { weight, reps, reason, warn, phase, target }. reps is always the
   template's reps: load progresses, rep schemes don't drift. [5][6] */
function nextPrescription(exId, history, step, tplReps, ctx) {
  const ex = EXERCISES[exId];
  const phaseKey = (ctx && ctx.phase) || 'build';
  const pol = phasePolicy(phaseKey);
  const inc = step || WEIGHT_STEP_DEFAULT;
  const target = targetRPEForPhase(exId, phaseKey);
  const out = (weight, reason, warn) => ({ weight, reps: tplReps, reason, warn: warn || null, phase: phaseKey, target });

  if (!history.length) {
    // First exposure: pick load by feel against the phase's RIR target, not by a
    // percentage of a 1RM we don't have. [1][2]
    return out(null, target
      ? `First time — start light: a weight you could stop ${rirBandTxt(target)} reps short of failure (RPE ${rpeBandTxt(target)}).`
      : 'First time — start light and learn the movement. Quality over load.');
  }
  const last = history[history.length - 1];
  const worked = last.sets.filter(s => s.weight != null && s.reps > 0);
  if (!worked.length) return out(null, 'No logged sets last time — set your weight.');
  const topW = Math.max(...worked.map(s => s.weight));
  const avgReps = meanOf(worked.map(s => s.reps));
  const repsMet = !tplReps || avgReps >= tplReps - 0.34;   // hit (or basically hit) every set
  if (!target) return out(topW, 'Same as last time — this one is about quality, not load.');
  const rpes = worked.filter(s => s.rpe != null).map(s => s.rpe);
  if (!rpes.length) return out(topW, 'No RPE logged last time — holding. Tap an RPE next time and this steers itself.');
  const avg = meanOf(rpes);
  const tgt = (target[0] + target[1]) / 2;
  const lower = ex.group === 'lower';
  const anyFail = worked.some(s => s.failed) || rpes.some(r => r >= 10);
  // Accumulated fatigue: this lift has now run over target two sessions straight.
  // Same signal the deload radar watches, but per-lift. [2][7]
  const prev = sessionRPE(history[history.length - 2]);
  const drifting = prev != null && prev > tgt + 0.5 && avg > tgt + 0.5;

  /* ---- 1. what does the RPE say to do? (phase-independent) ---- */
  let intent, reason, warn = null;
  const avgTxt = avg.toFixed(1).replace(/\.0$/, '');
  if (anyFail) {
    intent = 'down-hard';
    reason = `RPE 10 / failed set last time — backing off to get back inside RPE ${rpeBandTxt(target)}.`;
  } else if (!repsMet) {
    // Reps come before load: a missed rep target means the last load was already
    // too heavy for the prescribed scheme. [3]
    if (avg > tgt + 1) { intent = 'down'; reason = `Got ~${avgReps.toFixed(1)} of ${tplReps} reps at RPE ${avgTxt} — dropping the load so all ${tplReps} land.`; }
    else { intent = 'hold'; reason = `Got ~${avgReps.toFixed(1)} of ${tplReps} reps last time — same load until all ${tplReps} land.`; }
  } else if (avg <= tgt - 2) {
    // 2+ points under target ≈ 2+ more reps in reserve than intended [1] — the
    // load is clearly too light, take the bigger jump. [2][3]
    intent = 'up-big';
    reason = `All reps at RPE ${avgTxt} vs target ${rpeBandTxt(target)} — that's ${(tgt - avg).toFixed(1)} points of headroom, so a proper jump.`;
  } else if (avg < tgt - 0.5) {
    intent = 'up-mid';
    reason = `All reps, RPE ${avgTxt} just under target ${rpeBandTxt(target)} — stepping up.`;
  } else if (avg <= tgt + 0.5) {
    intent = 'up-small';
    reason = `All reps, RPE ${avgTxt} on target — smallest useful overload.`;
  } else if (avg <= tgt + 1) {
    intent = 'hold';
    reason = `RPE ${avgTxt} ran over target ${rpeBandTxt(target)} — same load, earn it back before adding.`;
  } else {
    intent = 'down';
    reason = `RPE ${avgTxt} well over target ${rpeBandTxt(target)} — easing the load.`;
  }
  if (drifting && (intent === 'hold' || intent === 'up-small')) {
    intent = 'down';
    reason = `RPE has run over target two sessions straight (${prev.toFixed(1)} then ${avgTxt}) — trimming the load.`;
  }
  if (drifting || anyFail || intent === 'down' || intent === 'down-hard') {
    warn = drifting
      ? 'Possible accumulated fatigue on this lift — if the running also feels heavy, take the light-day option.'
      : 'If this keeps happening, it\'s fatigue, not weakness — check the deload radar on Today.';
  }

  /* ---- 2. what does the phase allow? ---- */
  const wantsUp = intent.startsWith('up');
  if (wantsUp && !pol.allowUp) {
    intent = 'hold';
    reason = pol.hold;                       // taper / race week / deload wording
  } else if (wantsUp && pol.atTargetHold && intent === 'up-small') {
    intent = 'hold';
    reason = `RPE ${avgTxt} on target — ${pol.label}: holding here rather than nudging up.`;
  } else if (wantsUp) {
    reason += pol.upMult < 1 ? ` (${pol.label}: half-size jump)` : '';
  }
  if (pol.cutPct && intent === 'hold') { intent = 'deload-cut'; reason = pol.hold; }

  /* ---- 3. turn intent into a weight ---- */
  // Lower body carries bigger absolute loads and tolerates bigger jumps than
  // upper body / small muscle groups — the asymmetry is straight out of [3].
  const UP = { 'up-big': lower ? 0.06 : 0.04, 'up-mid': lower ? 0.03 : 0.02, 'up-small': 0 };
  const DOWN = { down: lower ? 0.05 : 0.035, 'down-hard': lower ? 0.07 : 0.05, 'deload-cut': (pol.cutPct || 10) / 100 };
  let w = topW;
  if (intent in UP) {
    const cap = Math.max(topW * pol.maxUpPct / 100, inc);          // cap, but never below one step
    const minSteps = intent === 'up-big' ? 2 : 1;
    w = topW + Math.min(Math.max(topW * UP[intent] * pol.upMult, inc * minSteps), cap);
  } else if (intent in DOWN) {
    w = Math.max(0, topW - Math.max(topW * DOWN[intent], inc));    // always at least one real step down
  }
  // Round to the user's increment, but never let rounding cancel the decision:
  // with a 1 kg step a 3% cut on a light lift must still move. [3]
  let weight = roundToStep(w, inc);
  if (w > topW && weight <= topW) weight = roundToStep(topW + inc, inc);
  if (w < topW && weight >= topW) weight = Math.max(0, roundToStep(topW - inc, inc));
  return out(weight, reason, warn);
}

/* Warm-up ramp for heavy lifts.
   Returns { steps: [...labels], note } or null when the lift needs no ramp.
   Structured rather than pre-joined because the session view renders each rung as
   its own tappable pill — a single joined string read as just another "N kg × R"
   sentence, indistinguishable from the working weight and from last session. */
function warmupPlan(exId, workWeight, step) {
  const ex = EXERCISES[exId];
  if (!ex.wu) return null;
  if (ex.wu === 'bw') return { steps: ['BW × 5', 'BW × 3'], note: 'slow, full range' };
  if (workWeight == null || workWeight <= 0) return { steps: [], note: 'Do 2–3 easy ramp sets before your first working set.' };
  const r = w => Math.max(0, Math.round(w / step) * step);
  if (workWeight <= 40) return ex.wu === 'bar' ? { steps: ['bar × 10'], note: null } : { steps: [], note: 'One easy set at half weight.' };
  const steps = [];
  if (ex.wu === 'bar') steps.push('bar × 10');
  for (const [pct, reps] of [[0.5, 5], [0.7, 3], [0.85, 1]]) {
    const w = r(workWeight * pct);
    if (w >= (ex.wu === 'bar' ? 25 : 10) && w < workWeight) steps.push(`${w} × ${reps}`);
  }
  if (!steps.length) return null;
  return { steps, note: null };
}

/* Standard Australian/metric plate set found at almost any commercial gym.
   Bar weight is a setting (ST.settings.barWeight) since 20 kg men's, 15 kg
   women's/technique and 10 kg training bars are all common — plates aren't. */
const PLATE_SET = [25, 20, 15, 10, 5, 2.5, 1.25];

/* Greedy per-side plate breakdown for a barbell working weight.
   Returns { perSide, plates, remainder, exact }: `plates` is the descending
   list of plates for ONE side, `remainder` is whatever's left over if the
   available set can't hit the target exactly (rounding elsewhere already
   keeps this rare, but a custom step or a thin plate set can still miss).
   Pure — no app state — so tools/test-progression.js can drive it directly. */
function platesPerSide(weight, bar, available) {
  const set = (available && available.length ? available : PLATE_SET).slice().sort((a, b) => b - a);
  const perSide = Math.max(0, (weight - bar) / 2);
  const plates = [];
  let remaining = Math.round(perSide * 100) / 100;
  for (const p of set) {
    while (remaining + 1e-6 >= p) { plates.push(p); remaining = Math.round((remaining - p) * 100) / 100; }
  }
  return { perSide, plates, remainder: Math.max(0, remaining), exact: remaining < 0.01 };
}

function e1rm(weight, reps, rpe) {
  if (!weight || !reps) return 0;
  const rir = rpe != null ? Math.max(0, 10 - rpe) : 0;
  const total = reps + rir;
  if (total > 12) return 0; // not meaningful past ~12 effective reps
  return weight * (1 + total / 30);
}

/* Node test hook — `module` is undefined in the browser, so this is a no-op there
   and program.js stays a plain classic script. See tools/test-progression.js. */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    EXERCISES, TEMPLATES, STRETCHES, MUSCLE_MAP, RACES, PHASE_POLICY,
    WEIGHT_STEP_DEFAULT, WEIGHT_STEP_CHOICES, STRETCH_SETUP_SECS,
    nextPrescription, roundToStep, phaseKeyFromLabel, targetRPEForPhase,
    stretchRoutine, stretchDur, STRETCH_ESSENTIALS, TRAINED_SHARE,
    STRETCH_AREAS, areaStretchRoutine, AREA_TARGET_SECS, sorePattern, volumeShiftNote,
    warmupPlan, e1rm, buildProgram, PLATE_SET, platesPerSide,
    HYPER_MESO_WEEKS, HYPER_POOLS, HYPER_ORDER, weeksSince, hyperExId, materializeTemplate, dadd, dstr,
    PREPS, PREP_INSIGHTS, PREP_SETUP_SECS, PREP_TIER_ORDER, RUN_LOADS, RUN_PREP_MINS,
    prepRoutine, plannedLoads, runLoads, runType, runPrepMins,
  };
}
