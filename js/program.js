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
};
for (const id in INSIGHTS) if (EXERCISES[id]) Object.assign(EXERCISES[id], INSIGHTS[id]);
/* generic taper-phase line (exercise-specific taperWhy overrides if present) */
const TAPER_WHY = 'Taper mode: today is about keeping this pattern sharp, not building it — light, crisp, done. Race legs are the priority.';

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
};
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
];

/* Session templates. items: [exId, sets, reps] — reps is per side for perSide, seconds for 'time', metres for 'carry'. */
const TEMPLATES = {
  /* build-phase sessions extended after week-1 feedback (finished in ~20 min):
     +1 exercise on lower A, +1 set on most mains. Race/taper weeks stay deliberately short. */
  lowerA:        { title: 'Lower A · Light', est: 48, items: [['boxjump', 3, 3], ['bss', 4, 8], ['slrdl', 3, 8], ['slhipthrust', 3, 10], ['calfstand', 4, 10], ['copen', 3, 30]] },
  lowerA_noplyo: { title: 'Lower A · Light', est: 44, items: [['bss', 4, 8], ['slrdl', 3, 8], ['slhipthrust', 3, 10], ['calfstand', 4, 10], ['copen', 3, 30]] },
  lowerB:        { title: 'Lower B · Heavy', est: 50, items: [['boxjump', 3, 3], ['squat', 5, 4], ['rdl', 4, 6], ['hipthrust', 3, 8], ['calfseat', 4, 12]] },
  upperA:        { title: 'Upper A', est: 45, items: [['bench', 5, 5], ['pullup', 5, 6], ['dbrow', 4, 8], ['pallof', 3, 12], ['carry', 4, 30]] },
  upperB:        { title: 'Upper B', est: 45, items: [['ohp', 5, 5], ['csrow', 4, 8], ['incline', 4, 8], ['facepull', 4, 15], ['abwheel', 4, 10]] },
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
  // Maintenance mode (post-Melbourne): 3 flexible sessions/week, ~40 min each
  maintLower:    { title: 'Maintenance · Lower', est: 40, items: [['squat', 3, 5], ['rdl', 3, 6], ['bss', 3, 8], ['calfstand', 3, 10], ['copen', 3, 30]] },
  maintUpper:    { title: 'Maintenance · Upper', est: 38, items: [['bench', 3, 5], ['csrow', 3, 8], ['ohp', 2, 6], ['pullup', 3, 6], ['pallof', 3, 12]] },
  maintFull:     { title: 'Maintenance · Full Body', est: 42, items: [['hipthrust', 3, 8], ['incline', 3, 8], ['slrdl', 3, 8], ['dbrow', 3, 8], ['calfseat', 3, 12], ['abwheel', 3, 10]] },
  // Post-race recovery week: one very light session, movement over load
  recoverySession:{ title: 'Recovery · Move & Loosen', est: 25, items: [['glutebridge', 2, 10], ['pushup', 2, 8], ['bandpull', 2, 15], ['calfstand', 2, 10]] },
};

/* race-week checklist defaults (editable per race in-app) */
const RACE_CHECKLIST = [
  'Race kit laid out (shoes, socks, top, shorts, anti-chafe)',
  'Bib collected / registration confirmed',
  'Breakfast planned and tested (nothing new on race day)',
  'Gels / fuel packed (~30-60g carbs per hour)',
  'Hydration plan sorted (course drink stations checked)',
  'Pacing plan set (check the app\'s projection — start conservative)',
  'Transport & start-line logistics confirmed',
  'Trust the taper: feeling flat this week is normal and temporary',
];
const RECOVERY_WEEK = [
  'Day 1-2: walk, eat, sleep. Nothing else — the race is still in your legs.',
  'Day 3: 20 minutes easy mobility or a gentle spin if you feel like moving.',
  'Day 4: optional Recovery session in the app — light movement, zero grinding.',
  'Day 5-6: easy short jog if the legs feel genuinely fresh; skip guilt-free.',
  'Day 7: normal life resumes. Maintenance mode starts when you\'re ready.',
];

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

/* history: array of {date, sets:[{weight,reps,rpe,failed}]} for one exercise variant, oldest→newest.
   tplReps = the session's target reps for this exercise (per side where applicable).
   Recommends BOTH weight and reps, using last session's RPE + reps completed + weight. */
function nextPrescription(exId, history, step, tplReps) {
  const ex = EXERCISES[exId];
  const targetRPE = ex.rpe;
  if (!history.length) return { weight: null, reps: tplReps, reason: 'First time — start light (you should have 3–4 reps left in the tank, RPE 6–7).' };
  const last = history[history.length - 1];
  const worked = last.sets.filter(s => s.weight != null && s.reps > 0);
  if (!worked.length) return { weight: null, reps: tplReps, reason: 'No logged sets last time — set your weight.' };
  const topW = Math.max(...worked.map(s => s.weight));
  const avgReps = worked.reduce((a, s) => a + s.reps, 0) / worked.length;
  const repsMet = !tplReps || avgReps >= tplReps - 0.34;   // hit (or basically hit) every set
  if (!targetRPE) return { weight: topW, reps: tplReps, reason: 'Same as last time.' };
  const rpes = worked.filter(s => s.rpe != null).map(s => s.rpe);
  if (!rpes.length) return { weight: topW, reps: tplReps, reason: 'No RPE logged last time — holding.' };
  const avg = rpes.reduce((a, b) => a + b, 0) / rpes.length;
  const tgt = (targetRPE[0] + targetRPE[1]) / 2;
  const lower = ex.group === 'lower';
  const anyFail = worked.some(s => s.failed) || rpes.some(r => r >= 10);
  let w, reason;
  if (anyFail) {
    w = topW * (lower ? 0.93 : 0.95);
    reason = 'RPE 10 / failed set last time — backing off.';
  } else if (!repsMet) {
    // reps were missed: fix reps before touching load
    if (avg > tgt + 1) { w = topW * (lower ? 0.95 : 0.965); reason = `Got ~${avgReps.toFixed(1)} of ${tplReps} reps at RPE ${avg.toFixed(1)} — dropping weight to hit all reps.`; }
    else { w = topW; reason = `Got ~${avgReps.toFixed(1)} of ${tplReps} reps last time — same weight, hit all ${tplReps} before adding.`; }
  } else if (avg <= tgt - 1) {
    w = topW * (lower ? 1.075 : 1.0375); // aggressive: +5–10% lower, +2.5–5% upper
    reason = `All reps at avg RPE ${avg.toFixed(1)} vs target ${tgt} — jumping up.`;
  } else if (avg <= tgt) {
    w = topW + step;
    reason = 'All reps, RPE on target — small step up.';
  } else if (avg <= tgt + 1) {
    w = topW;
    reason = `RPE slightly high (${avg.toFixed(1)}) — holding weight.`;
  } else {
    w = topW * (lower ? 0.95 : 0.965);
    reason = `RPE too high (${avg.toFixed(1)}) — reducing.`;
  }
  return { weight: roundToStep(w, step), reps: tplReps, reason };
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
