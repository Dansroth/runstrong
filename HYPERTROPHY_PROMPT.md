# Prompt: Post-Melbourne hypertrophy phase — chest & arms priority, full body kept

Paste everything below the line into a fresh Claude Code session started in `C:\Users\rothd\runstrong`.

---

You are adding a **new training phase to RunStrong**, a personal PWA at `C:\Users\rothd\runstrong`, that begins after the Melbourne Half (A race, 2026-10-11) is run: a **hypertrophy-focused program with chest and arms (biceps + triceps) as the top priority — not an upper-body-only split.** Legs stay in every week at a real, genuinely-trained volume; they are just not the top priority the way chest and arms are. Running drops to easy maintenance — no more race periodization.

This is not a new app mode from scratch. RunStrong already has a post-block "maintenance mode" with real infrastructure behind it. Your job is to extend that, not replace it or build a parallel system next to it.

## What the app is

A single-user, offline-first strength PWA. No build step, no framework, no backend, no dependencies. Vanilla JS, string-template rendering, `localStorage` for all state.

- `js/program.js` (~1000 lines) — **pure data and pure functions.** Exercise library, templates, progression engine, prep/stretch routine builders. Exports through a `module.exports` hook at the bottom so `tools/test-*.js` can drive it directly in Node.
- `js/app.js` (~3200 lines) — state, migrations, timers, every view.
- `css/styles.css` — the whole design system, tokens in `:root`, dark-only.
- `tools/test-progression.js`, `tools/test-stretch.js`, `tools/test-warmup.js` — dependency-free unit tests.

Baseline before you touch anything: `APP_VERSION = 'v26'`, `SCHEMA_VERSION = 10`, all three suites green (291 + 471 + 1955 assertions). Confirm that yourself before starting — `node tools/test-progression.js`, etc.

## Read this before you design anything

**The machinery for "what happens after the last race" already exists.** Extending it is the job.

Already in `js/app.js`:

- **`offerRecoveryMode()`** (~line 1343) — the sheet shown after the Melbourne result is logged (wired at line 1341: `if (key === 'melbourne') offerRecoveryMode();`), and also reachable any time from a "What now?" button on the race-result card and from the "Program complete" card. **This is where a choice of what comes next belongs.** Today it only offers one path — a week of recovery, then generic maintenance.
- **`startMaintenance()`** (~line 1352) — sets `ST.maintenance = { active: true, startedOn: today() }` and switches the whole app into maintenance UI: race clocks disappear (`raceCountdowns()`, `raceExtraCards()`), `vHome`/`vSchedule`/weekly summaries all branch on `ST.maintenance.active`.
- **`maintenanceCard()`** (~line 1361) — after a guided recovery week (`RECOVERY_WEEK`, 7 days), this is what actually decides the next workout: it round-robins `['maintLower', 'maintUpper', 'maintFull']`, avoiding a template already done this calendar week, with light leg-awareness if a big run happened recently. **This is the function that needs a hypertrophy-phase variant to select from — including a real leg template, not just chest/arm ones.**
- **`TEMPLATES.maintLower` / `maintUpper` / `maintFull`** (`js/program.js`, TEMPLATES block) — the existing maintenance-mode session content. Balanced, full-body-leaning, not what you're building, but the pattern (and the `est`/`items: [exId, sets, reps]` shape) to follow.
- `PHASE_POLICY.maint` (`js/program.js`) — the progression policy maintenance mode uses today: small, capped increases, holds at target rather than pushing. Decide whether hypertrophy work reuses this key as-is or needs its own (see below).

**What running does under maintenance today: nothing structured.** Once `ST.maintenance.active` is true, the generated 9-week `ST.program` calendar stops being consulted for lift *or* run days — the user just logs runs freely via `openRunLog`, with no prescribed frequency, no plan pushing them, no periodization. "Running maintenance" is not a built feature to extend; it is the current total absence of one. Decide deliberately whether this phase adds any lightweight run frequency guidance (e.g. a home-screen nudge suggesting 2 easy runs a week) or leaves running exactly as freeform as it is today, and say why. Whichever you choose, there is no taper/build structure to design — Melbourne is done, running's job now is just not losing fitness.

## The gap you have to fill first: there is no direct arm work in this app, anywhere

Go check — `grep -in "curl\|tricep\|pushdown\|skull" js/program.js`. Nothing. The 54-exercise library was built entirely for half-marathon strength support: `bench`/`ohp`/`incline`/`pushup` train chest/shoulders/triceps *incidentally*, in service of arm-swing endurance (read their `why` fields — every one is framed as "this helps your stride"). There is no biceps exercise of any kind, and no triceps *isolation* exercise. For a program whose stated biggest priority is chest and arms, you are adding real exercises, not just new templates against old ones.

You will also hit a **second, less obvious gap**: the muscle-tag vocabulary used by `MUSCLE_MAP`, `STRETCHES`, and `PREPS` is fixed and running-derived — `quads glutes hams calves adductors hipflex chest back shoulders core`. There is no `biceps` or `triceps` tag. That vocabulary is what `stretchRoutine()` and `prepRoutine()` match against to decide what a session's warm-up and cool-down cover (see the long header comments above both functions in `program.js` — read them, they document a real past regression). If you add curls and pushdowns without extending this vocabulary and adding matching `STRETCHES`/`PREPS` entries, the post-workout stretch routine will structurally never suggest an arm stretch after an arm-heavy session, and mis-tagging them onto `chest`/`shoulders`/`back` as a shortcut will silently misrepresent what was actually trained. Extend the vocabulary properly; this is not optional plumbing to skip.

## The evidence that must drive the design

This app cites its sources — see the `PROGRESSION ENGINE` header in `program.js` for the house standard (numbered refs, each rule stating which one it rests on). Match it. You'll want real citations for at least:

- **Rep range barely matters for hypertrophy if sets are taken close to failure** — load can range roughly 6–20+ reps with similar hypertrophic outcome (Schoenfeld, Grgic, Ogborn & Krieger, *J Strength Cond Res* 2017, low- vs high-load meta-analysis). This licenses higher rep ranges (10–15) for arm isolation work without it being "wrong" for growth.
- **Volume has a dose-response relationship with hypertrophy**, roughly up to ~10+ hard sets per muscle per week before returns flatten for most lifters (Schoenfeld, Ogborn & Krieger, *J Sports Sci* 2017, volume dose-response meta-analysis). This is what should set weekly chest/arm set counts, not a round number picked by feel.
- **Training a muscle twice a week beats once a week at equal volume** (Schoenfeld, Grgic & Krieger, *J Sports Sci* 2019, frequency meta-analysis). This should drive the split — chest and arms need to show up more than once a week each.
- Verify these citations yourself before writing them into the app — get the details right rather than trusting this summary blind, the same standard the rest of the file already holds itself to.

## What to build

### 1. A choice, offered where the app already asks "what now?"

Extend `offerRecoveryMode()` (or the sheet it opens) to offer this hypertrophy phase as an alternative to — or a configurable flavour of — the existing generic maintenance mode, rather than silently replacing it. Decide the exact shape: a `ST.maintenance.program: 'balanced' | 'hypertrophy'` field read by `maintenanceCard()` is the obvious fit given the existing data shape, but design it yourself and justify the choice. Whatever you build must leave the existing balanced-maintenance path intact and working — this is additive, not a rip-and-replace.

### 2. New exercises: chest and arms, done properly

At minimum: 2–3 direct biceps movements (e.g. barbell/EZ-bar curl, incline DB curl, hammer curl) and 2–3 direct triceps movements (e.g. cable pushdown, overhead extension, close-grip press or dip), plus consider whether the existing chest lifts need hypertrophy-oriented additions (cable/DB flye, dip) beyond what's already there for running support. Every new entry needs the **full existing contract**: `name, group, mode, rest, rpe, swaps, equip` (reuse the equipment vocabulary from `EQUIP_KEYS` in `app.js` — `barbell dumbbell bench machine cable band box`), `cue`, and `why`/`deep`.

On `why`/`deep`: every existing exercise's insight is written as "why this helps your half." A bicep curl does not help a half marathon, and forcing that framing would be dishonest — the exact failure mode this app's own conventions warn against (see the stretching-honesty rule in `WARMUP_PROMPT.md` if it's still in the repo: don't overclaim). Decide how the insight contract adapts for a phase whose actual goal is hypertrophy/aesthetics/strength for its own sake — a different, honest rationale (evidence-based hypertrophy reasoning, or plainly "this is the priority phase you asked for, not a running-support exercise") beats stretching the old template to fit. Say what you decided and why.

Add matching entries to `MUSCLE_MAP` (extend the tag vocabulary — see above), and give the new lifts the same `steps`-array treatment the last update added for the 23 exercises the base program actually prescribes (same voice: short, plain, second person). Add or extend `STRETCHES`/`PREPS` for the new muscle tags so warm-up and cool-down routines actually cover what gets trained — do not skip this because it is not enforced anywhere; nothing will crash if you skip it, it will just be quietly wrong.

### 3. New templates: chest and arms lead, but this is a full-body split, not an upper-only one

**Explicit requirement, not an open question: legs stay in every training week at a real, genuinely-trained volume.** This is not a token single set of leg extensions bolted on for appearances, and it is not the near-full leg day the current `maintLower`/`lowerB` templates run either — it sits between those, sized so it actually maintains the squat/RDL/hamstring strength this app's own exercise library already argues protects running economy and injury resistance (the same rationale `rdl`/`squat`'s `why` fields already carry), without competing for recovery with the chest/arm volume that is the actual point of this phase.

Chest and arms (biceps + triceps) get the highest **frequency and volume** — twice a week each is the evidence-backed floor per the frequency citation above. Back and shoulders get a real maintenance dose, not neglect (pressing needs a pulling counterbalance, and this app has spent real effort on posture/shoulder-health copy elsewhere). Legs get their own dedicated slot(s) — once or twice a week, your call, sized to maintain rather than build (this phase's stated priority is chest and arms, and leg hypertrophy volume competing for the same weekly recovery budget would blunt that) — built from the existing `squat`/`rdl`/`hipthrust`/calf-work exercises already in the library rather than new ones, since maintaining what's already trained is the goal here, not adding a second growth focus. Propose the actual weekly day count and rotation; don't leave it vague.

Follow the existing architecture split: **volume periodisation lives in `TEMPLATES`** (sets/reps per session), **load periodisation lives in `nextPrescription`/`PHASE_POLICY`** (see the header comment above `PHASE_POLICY` in `program.js`). Decide whether this phase reuses the `maint` policy key or needs a new one — hypertrophy work generally tolerates being pushed closer to target RPE more consistently than the current `maint` policy's `rpeAdj: -0.5, atTargetHold: true` allows, so reusing it unmodified may undertrain the whole point of this phase. Whatever you choose, it must still flow through the same RPE-autoregulated engine — do not build a second progression system.

Rest periods: hypertrophy work does not need the long rests of a strength-focused compound day for isolation exercises (curls, pushdowns), but do not default to the "60–90s for everything" folk wisdom either — interset rest of 2–3 minutes has been shown to outperform short rest even for hypertrophy-oriented compound work (Schoenfeld, Pope et al., *J Strength Cond Res* 2016). Set rest per-exercise deliberately, isolation vs. compound, the same way the existing library already varies `rest` by exercise.

## Constraints

- Vanilla JS. No dependencies, no build step. Pure logic in `program.js`, views in `app.js`.
- **Reuse the existing engine.** `nextPrescription`, `TEMPLATES`, `PHASE_POLICY`, `MUSCLE_MAP`, `stretchRoutine`/`prepRoutine`, the `equip` tagging system, the `steps`/`why`/`deep` exercise contract — extend these, do not fork a parallel system for this phase.
- Schema migration **10 → 11**, purely additive, following the comment style of the existing migrations (see migration `9 → 10` for the most recent example). Existing history, and the existing balanced-maintenance path, must be untouched.
- Bump `APP_VERSION` and the `sw.js` `CACHE` string **together** — they are currently both `v26`, so this ships as `v27`.
- Match the established voice everywhere: short sentences, plain language, no jargon, evidence cited with numbered/named refs the same way the rest of the file does it.

## Verify before you hand it back

1. `node tools/test-progression.js`, `node tools/test-stretch.js`, `node tools/test-warmup.js` — all three must still pass. Extend `tools/test-stretch.js`'s `MUSCLE_MAP` completeness check and `tools/test-warmup.js`'s `PREP_INSIGHTS` completeness check to cover whatever new exercises/prep items you add — they're written to fail loudly on a missing entry, keep that guarantee for the new ones too.
2. Add plate-calculator coverage for any new barbell hypertrophy lift the same way `tools/test-progression.js` already tests `platesPerSide` — free correctness check, cheap to add.
3. Drive it in the browser at 375×812, dark scheme: `node tools/serve.js 8317`. Walk the actual flow: log a Melbourne result → see the new choice in `offerRecoveryMode()` → pick the hypertrophy path → complete a chest/arm session end to end, including the post-session stretch routine actually surfacing an arm stretch → confirm the leg template is still offered in the weekly rotation, not just chest/back/shoulder/arm ones. Do not review from source alone.
4. Confirm the balanced-maintenance path (the existing behaviour) still works unchanged for someone who doesn't opt into this phase.

## Output

Start by reading `offerRecoveryMode`/`startMaintenance`/`maintenanceCard` in `app.js` and the `TEMPLATES`/`PHASE_POLICY`/`MUSCLE_MAP` sections of `program.js`, then **give me a short plan before writing code**: the exact split and weekly structure you're proposing (including the leg day(s) — day count, which existing lifts, and how it's paced against the chest/arm volume), the new chest/arm exercises and their equipment/muscle tags, your call on the `why`/`deep` framing question, your call on the running-maintenance question, and where the choice gets surfaced in the UI. I want to approve that shape before implementation.

Then implement, test, and report what you verified and what you did not.
