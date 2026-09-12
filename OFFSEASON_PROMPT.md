# Prompt 2 of 2: Off-season — hypertrophy block, weekly mobility, February 2027 build, session swapping, simpler Progress

Paste everything below the line into a fresh Claude Code session started in `C:\Users\rothd\runstrong`, **after** `GEELONG_TAPER_PROMPT.md` has shipped as v32 (schema 13). Stages A and B must be live before **Mon 2026-09-28**; the rest can follow at their own pace, one commit and version bump per stage.

---

You are building the **off-season** for **RunStrong**, a personal offline-first PWA at `C:\Users\rothd\runstrong` (vanilla JS, no build step, no dependencies, `localStorage` state; see `HYPERTROPHY_PROMPT.md` §"What the app is" for the file layout). The Geelong Half on Sun 2026-09-20 is the last race until **Sun 2027-02-21**. Between those dates the user wants:

- **Weights 5 days a week**, built for **hypertrophy**, science-based — and explicitly *not* a copy of the existing v27 chest-and-arms phase: **change the exercises, the sets, the reps and the rest periods**, and justify each from the evidence below.
- **One scheduled mobility session a week.**
- **Two easy runs a week** to hold aerobic base. Nothing harder.
- That regime runs until about three months out from the February race, then a **12-week half-marathon build** starts.
- Two app features: **swap sessions between days** in the Plan tab, and a **simpler Progress tab** — fewer, bigger things per section.

## The calendar (fixed — do not re-derive)

| Dates | Phase | Weeks |
|---|---|---|
| Mon 21 → Sun 27 Sep 2026 | Post-race recovery week (`RECOVERY_WEEK`, `program.js` ~line 874, already exists) | 1 |
| Mon 28 Sep → Sun 29 Nov 2026 | **Hypertrophy block**: 5 lifts + 1 mobility + 2 easy runs per week | 9 |
| Mon 30 Nov 2026 → Sun 21 Feb 2027 | **Half-marathon build**, race on the final Sunday | 12 |

30 Nov + 84 days = 22 Feb, so week 12 ends exactly on race day. Nine hypertrophy weeks split naturally into two mesocycles (4 + 4) plus a one-week transition into running (see Stage B).

## What already exists — extend it, don't fork it

Read these before designing anything. The last two briefs in this repo (`HYPERTROPHY_PROMPT.md`, `WARMUP_PROMPT.md`) explain the architecture; the v27 hypertrophy work is the direct predecessor of Stage B.

- `offerRecoveryMode()` (`app.js` ~1393) → `startMaintenance('balanced' | 'hypertrophy')` (~1405) → `ST.maintenance = { active, startedOn, program, mesoStart }`; guided recovery week gated by `inRecoveryWeek()` (~1412). Once `maintenance.active` is true, **the dated `ST.program` calendar is bypassed entirely**: `maintenanceCard()` / `maintenanceCardHyper()` (~1416–1465) pick "the next undone template" and running is an unenforced counter (`HYPER_RUN_TARGET = 2`). There is no Plan-tab view of the off-season, no scheduled mobility, no dates. **Stage A replaces this with a dated calendar** so that the Plan tab, notifications, streaks, adherence and the new swap feature all have one source of truth.
- `TEMPLATES.hyper*` + `HYPER_POOLS` / `HYPER_ORDER` / `HYPER_MESO_WEEKS` / `materializeTemplate()` (`program.js` ~778–858): the v27 split (Chest+Tri, Back+Bi, `maintLower`, Shoulders+Arms, Chest+Back) with a `'ROTATE:<pool>'` sentinel mechanism for accessory rotation on a mesocycle boundary. **Keep the mechanism, replace the program.**
- `PHASE_POLICY.hypertrophy` (`program.js` ~1074) and `progressionCtx()` (`app.js` ~421): load autoregulation by RPE. Everything new must flow through `nextPrescription`; do not build a second progression system.
- Exercise contract: `name, group, mode, rest, rpe, swaps, equip (EQUIP_KEYS: barbell dumbbell bench machine cable band box), cue, why/deep, steps`, plus a `MUSCLE_MAP` entry over the tag vocabulary `quads glutes hams calves adductors hipflex chest back shoulders core biceps triceps`, plus `STRETCHES`/`PREPS` coverage so `stretchRoutine()`/`prepRoutine()` warm up and cool down what was actually trained. Read the header comments above those two functions — they document a real regression.
- The 62-exercise library (`program.js` ~20–110). Check what is *missing* for a hypertrophy program before you assume it is there: at the time of writing there is **no lateral raise, no seated/lying leg curl, no leg extension, no preacher curl, no cable flye** (there is `dbflye`), and no rear-delt isolation beyond `facepull`/`revpec`. Grep before adding.
- `buildProgram()` (`program.js` ~920) is hardcoded to `PROGRAM_START`/`WEEK2_MONDAY` and one race. Stage C generalises it.
- Progress: `vProgress` (`app.js` ~2491) with `logBody()` (~2503) and `insightsBody()` (~3087). Full inventory in Stage E.
- Persistence: single blob `runstrong.db`, `SCHEMA_VERSION = 13` after the taper brief, migrations in `MIGRATIONS` (`app.js` ~35–113), `ST.program` stored not recomputed (migration `1 → 2` is the rebuild precedent). `save()` invalidates derived caches.
- Tests: `tools/test-*.js`, dependency-free, driven through the `module.exports` guard at the bottom of `program.js`. Every pure function you add goes in `program.js` and gets assertions.

## Evidence base for Stage B (verify each yourself before citing it in code)

House style: numbered refs in a header comment, each rule naming the ref it rests on. Do not overclaim in exercise `why` copy — a leg extension does not "help your half", and the honesty rule from `WARMUP_PROMPT.md` applies.

- **[H1] Schoenfeld BJ, Ogborn D, Krieger JW.** Dose-response relationship between weekly resistance training volume and increases in muscle mass. *J Sports Sci* 2017;35(11):1073–82. — Hypertrophy rises with weekly hard sets per muscle, with clear gains up to ~10+ sets/week and diminishing (not zero) returns beyond. Sets the **per-muscle weekly set targets**.
- **[H2] Schoenfeld BJ, Grgic J, Krieger J.** How many times per week should a muscle be trained to maximize muscle hypertrophy? *J Sports Sci* 2019;37(11):1286–95. — At matched volume, ≥2×/week beats 1×/week. **Every major muscle group is trained at least twice a week.**
- **[H3] Schoenfeld BJ, Grgic J, Ogborn D, Krieger JW.** Strength and hypertrophy adaptations between low- vs. high-load resistance training. *J Strength Cond Res* 2017;31(12):3508–23. — Similar hypertrophy across ~6–20+ reps when sets are taken close to failure; heavier loads still win for strength. **Compounds 5–10 reps, isolation 10–20 reps**, both count.
- **[H4] Robinson ZP, Pelland JC, Remmert JF, et al.** Exploring the dose-response relationship between estimated resistance training proximity to failure, strength gain, and muscle hypertrophy: a series of meta-regressions. *Sports Med* 2024. — Hypertrophy improves the closer sets get to failure; strength gain does not need it. **Working sets at 0–3 RIR (RPE 7–10); last set of an isolation exercise to ~0–1 RIR.** Map this onto the app's RPE bands and `PHASE_POLICY.hypertrophy`.
- **[H5] Schoenfeld BJ, Pope ZK, Benik FM, et al.** Longer interset rest periods enhance muscle strength and hypertrophy in resistance-trained men. *J Strength Cond Res* 2016;30(7):1805–12. — 3 min beat 1 min for hypertrophy on compound lifts. **Compounds rest 2–3 min; isolation 60–90 s**, set per exercise in the `rest` field, not one global value.
- **[H6] Maeo S, Wu Y, Huang M, et al.** Triceps brachii hypertrophy is substantially greater after elbow extension training performed in the overhead vs. neutral arm position. *Eur J Sport Sci* 2023;23(7):1240–50. — and **[H7] Maeo S, Huang M, Wu Y, et al.** Greater hamstrings muscle hypertrophy but similar damage protection after training at long versus short muscle lengths. *Med Sci Sports Exerc* 2021;53(4):825–37. — Training at **long muscle lengths** grows more muscle (overhead extension > pushdown; seated > prone leg curl). Also **[H8] Kassiano W, Costa B, Nunes JP, et al.** Which ROMs lead to optimum muscle hypertrophy? A systematic review and meta-analysis. *J Strength Cond Res* 2023;37(5):1135–44. — Drives **exercise selection**: prefer the long-length variant in each slot (incline curl, overhead extension, seated leg curl, deep squat/leg press, flye at stretch, RDL).
- **[H9] Fonseca RM, Roschel H, Tricoli V, et al.** Changes in exercises are more effective than in loading schemes to improve muscle strength. *J Strength Cond Res* 2014;28(11):3085–92. — already cited by the v27 rotation code. Keep rotating accessories per mesocycle; keep anchor lifts fixed so e1RM tracking stays continuous.
- **[H10] Coleman M, Burke R, Augustin F, et al.** Gaining more from doing less? The effects of a one-week deload period during supervised resistance training on muscular adaptations. *PeerJ* 2024;12:e16777. — A planned one-week deload neither helped nor hurt hypertrophy over 9 weeks. Use it as fatigue management at the mesocycle boundary (volume halved, loads kept), not as a growth strategy; say so in the comment.
- **[H11] Schumann M, Feuerbacher JF, Sünkeler M, et al.** Compatibility of concurrent aerobic and strength training for skeletal muscle size and function: an updated systematic review and meta-analysis. *Sports Med* 2022;52(3):601–12. — Concurrent training does not compromise hypertrophy or maximal strength (only explosive strength), and same-day vs. separate-day made no difference. **Two easy runs a week are compatible with a leg-hypertrophy block**; place them for logistics and freshness, not out of interference fear.
- **[H12] Thomas E, Bianco A, Paoli A, Palma A.** The relation between stretching typology and stretching duration: the effects on range of motion. *Int J Sports Med* 2018;39(4):243–54. — Range of motion improves with roughly ≥5 min of stretching per muscle group per week, split any way. Sizes the weekly mobility session: it can meaningfully cover the whole body in ~25 min.
- The taper refs [T1]–[T3] from `GEELONG_TAPER_PROMPT.md` apply again in Stage C's final two weeks.

---

## Stage A — the off-season is a dated calendar (v33, schema 14)

**Goal:** after the Geelong result is logged, the app lays out real dated days for the recovery week, the hypertrophy block and (placeholder until Stage C) the February build, and every existing consumer reads them the way it reads the race program today.

- Extend `buildProgram()` (or add `buildOffseason()` that appends to it — your call, but there must be **one** `ST.program.weeks` array) so weeks continue past 20 Sep with the phases in the calendar table. Each day keeps the existing `{ date, kind, tpl?, title, sub? }` shape. New `kind: 'mobility'` days become real, schedulable sessions (Stage B says what they contain).
- `offerRecoveryMode()`: the default and recommended path is now this off-season calendar. Keep the balanced-maintenance path (`startMaintenance('balanced')`) working — it is a fallback the last brief insisted on — but it is no longer the headline. Decide what `ST.maintenance` still means once the calendar drives everything (probably just a flag that the off-season started, plus `mesoStart`), and document it in `defaultState()`.
- `maintenanceCard()` / `maintenanceCardHyper()`: replace "next undone template" logic with the normal `vHome` today's-card path reading `dayFor(today())`. The `HYPER_RUN_TARGET` counter goes away; the two runs are now days on the plan.
- Retire the `weekFor()`/`dayFor()` short-circuits at `app.js:1426-1428` and `1450-1452` that compute a Mon–Sun window because the calendar ends. Everything that branches on `ST.maintenance.active` (`vHome`, `vSchedule`, weekly summaries, `raceCountdowns`, `raceExtraCards`) needs a pass: with a calendar that extends to February, most of those branches should simply disappear.
- Weekly summaries and the "N weeks to the next race" copy should work with `RACES` containing the February race once Stage C adds it, and say "off-season" until then.
- Migration 13 → 14: rebuild `ST.program` (precedent: migration 1), preserve `sessions`/`runs`/`routines` keyed by date, initialise any new state. Tests: the calendar has no gaps from 2026-08-13 to 2027-02-21, every week has 7 days after week 1, and the phase labels resolve through `phaseKeyFromLabel()` to the intended `PHASE_POLICY` keys (`hypertrophy`, `deload`, `rebuild`, `build`, `taper`, `raceweek`) — add a label for the mobility/transition weeks and extend the regex deliberately.

## Stage B — the hypertrophy program, rebuilt from the evidence (v34, schema 15 if needed)

**Goal:** 5 lifting days + 1 mobility day + 2 easy runs per week for 9 weeks, science-driven, with new exercises, new set/rep/rest prescriptions and mesocycle structure. This replaces the v27 chest-and-arms program as the default. The user said "base it on science, change up the exercises, reps, sets, rests" — they did **not** re-affirm the chest-and-arms priority, so build a **balanced, all-muscle hypertrophy program** where legs are finally trained for growth (no race is near, so the old "legs at maintenance" rule is gone), and keep the direct chest/arm work the library already gained in v27 at ≥2×/week. Keep the old `hyper*` templates in the file only if the balanced/legacy path still references them; otherwise delete them — dead templates are worse than none.

### B1. Weekly layout (propose the exact one; this is the recommended starting point)

| Day | Session | Notes |
|---|---|---|
| Mon | Lower A — quad-dominant | squat or hack/leg press, leg extension, seated leg curl (light), standing calf |
| Tue | Upper A — push-emphasis, with one row | bench, incline/flye at stretch, overhead press or lateral raise, overhead triceps extension, one horizontal row |
| Wed | Easy run 1 (40–50 min, conversational) + **Mobility session** (20–25 min) | Mobility after the run, same day, so the block keeps a real rest day |
| Thu | Lower B — hinge-dominant | RDL, hip thrust, seated leg curl (main), split squat, seated calf |
| Fri | Upper B — pull-emphasis, with one press | pull-up/lat pulldown, cable row, face pull/rear delt, incline curl, one press |
| Sat | Arms & shoulders + weak point | lateral raise, DB shoulder press, barbell curl, hammer/preacher curl, pushdown, dip; core |
| Sun | Easy run 2 (45–60 min) | Or rest if life gets in the way — the run is the one that moves, not a lift |

Every major group lands ≥2×/week [H2]. Per muscle, aim for **10–12 hard sets/week in mesocycle week 1 rising to ~16–18 by week 3–4** [H1], then a deload week at ~50% sets with loads held [H10]. Count sets per muscle in a test (`MUSCLE_MAP` makes this mechanical) and assert the targets — do not eyeball it. Arms and shoulders get direct work three times a week because the Sat day exists; that is a volume decision within [H1], not a "priority".

### B2. Prescription rules (encode in `TEMPLATES` + per-exercise fields, not prose)

- Compounds: **5–10 reps, rest 2–3 min** [H3][H5]. Isolation: **10–20 reps, rest 60–90 s** [H3][H5]. Set `rest` per exercise.
- Effort: working sets at **RPE 7–9 (1–3 RIR)**; the last set of each isolation exercise at RPE 9–10 [H4]. Check whether `PHASE_POLICY.hypertrophy` (`rpeAdj: 0, upMult: 0.75, maxUpPct: 6, atTargetHold: false`) still expresses this — it probably does for compounds; decide whether isolation slots need a slightly higher target band and do it through the exercise's own `rpe` field rather than a new policy.
- Mesocycles: **weeks 1–4** (moderate loads, 8–12 compounds / 12–15 isolation), **deload week 4**, **weeks 5–8** (heavier compounds 5–8 / isolation 10–15, accessories rotated [H9]), **deload week 8**, **week 9 transition** (3 lifts, a third easy run reintroduced, mobility kept) into the running build. `HYPER_MESO_WEEKS` becomes 4. Anchor lifts (squat, bench, RDL, pull-up/lat pulldown, OHP, barbell curl, overhead extension) never rotate; accessories rotate through `HYPER_POOLS` via the existing `'ROTATE:'` sentinel.
- Exercise selection favours the **long-muscle-length** variant of each movement [H6][H7][H8]: overhead extension over pushdown as the main triceps lift, incline curl for biceps, seated leg curl, deep squat/leg press, DB or cable flye with a stretch at the bottom, RDL. Say this in the header comment and in each exercise's `why`.
- Equipment: respect `ST.settings.equip` and the existing equipment-aware `swaps` (v26). Every new exercise needs a barbell/dumbbell/band alternative in `swaps` so a home session still materialises.

### B3. New exercises (full contract, no shortcuts)

At minimum: **lateral raise (DB, cable swap), seated leg curl (machine; swap: Nordic/band curl or slider curl), leg extension (machine; swap: reverse Nordic or sissy squat), preacher or spider curl (swap: incline curl), cable flye (swap: `dbflye`)**, and a **rear-delt isolation** if `revpec` does not already cover it. Each with `name, group, mode, rest, rpe, swaps, equip, cue, why, deep, steps` and a `MUSCLE_MAP` entry. Check `STRETCHES`/`PREPS` cover every tag you use — new tags only if a real gap exists (there should be none: the arm tags were added in v27).

Write `why`/`deep` in the honest hypertrophy voice established in v27 (evidence-based growth reasoning, or plainly "this is the block you asked for"), never the running-support framing of the base library.

### B4. The mobility session (new session type, once a week)

- A scheduled `kind: 'mobility'` day that opens a **guided ~25 min full-body routine** built from `STRETCHES` via `areaStretchRoutine()`/`stretchRoutine()` — do not write a second stretch library. Coverage: every major group in the week's lifting plus hip flexors, adductors, calves and ankles (the running readiness set), sized so each area gets **≥5 min/week** across this session plus post-lift cool-downs [H12]. Two rounds of 30–60 s per stretch is the shape; the app already varies `hold`/rounds — reuse it.
- Logged like a routine (`ST.routines[date]`), counted for streak and adherence, visible in the Plan tab, swappable like any day (Stage D). It must **not** count as a lift in lifting-volume charts.
- Keep the existing on-demand, area-targeted stretching (v28) exactly as it is.

### B5. Running during the block

Two `kind: 'run'` days with `runType()` = easy, subtitles giving a duration range and "conversational — if you can't chat, slow down". No pace targets, no quality. `RUN_LOADS`/`RUN_PREP_MINS` already dose the warm-up for easy runs. Garmin/Strava imports keep merging by date. Home nudges (unlogged-run backlog) already exist.

### B6. Tests

Per-muscle weekly set counts hit the [H1] targets in each mesocycle week; every group ≥2×/week [H2]; rest fields match the compound/isolation rule [H5]; deload weeks are ~50% sets; `materializeTemplate()` rotates accessories on the 4-week boundary; anchor lifts never rotate; the transition week has 3 lifts and 3 runs; the mobility routine covers every tag trained that week and totals ≥5 min per area. Extend `test-stretch.js` for the mobility routine, `test-progression.js` for the policy.

## Stage C — the February 2027 half-marathon build (v35, schema 16)

**Goal:** a race-date-anchored 12-week program that reuses the structure that worked in Aug–Sep.

- `RACES` gains `{ key: 'feb2027', name: <ask the user for the race name; placeholder 'February Half'>, tag: 'A race', date: '2027-02-21' }`. Keep Geelong in the array with its logged result so the PR book and race-projection history stay intact.
- Generalise `buildProgram()`: a race date and a week count in, weeks out, Monday-anchored, ending on the race Sunday. The old program (Aug–Sep) must still be reproducible bit-for-bit for the dates already logged — either keep the old builder for the historical range or snapshot it; test that a week-3 August day still maps to the template it was logged against.
- Structure, mirroring the proven layout in `WHY_SCHEDULE` (Wed hard, Fri easy, Sun long; lifts Mon/Tue/Thu/Sat with Thursday heavy lower): **base 3 weeks (2 lifts → 3), build 5 weeks with down-weeks at 4 and 8, peak 2 weeks, taper 1 week + race week** using the existing `lowerA/B`, `upperA/B`, taper and `primer` templates and `PHASE_POLICY` keys. Mobility stays once a week (Wed or Sat) because the user asked for it as a standing feature, not a block feature.
- **Real long-run progression** in the Sunday `sub` strings, not `'~20 km'` for every week: roughly 12 km → 21–22 km peak three weeks out, ~10% steps, down-weeks at ~70%, then the [T1]-shaped taper the Geelong brief built. Wednesday quality sessions get an actual prescription per phase (base: strides/hill sprints; build: tempo and intervals; peak: HM-pace work; taper: the Geelong sharpener). Still strings — do not build a running engine.
- Race-week checklist, countdown, projection and result logging all work for `feb2027` with no `'melbourne'`/`'geelong'` string literals left in `app.js`.

## Stage D — swap sessions between days (v36, schema 17)

**Goal:** in the Plan tab, move any planned day to another day of the same week (a swap: both days exchange their plans), and have Home, "Up next", notifications, adherence, streaks and weekly summaries all agree.

- **Persist overrides, not mutations.** Migrations rebuild `ST.program`, so a swap stored by editing `ST.program.weeks[n].days[i]` would be lost. Add `ST.planOverrides = { [date]: dayPlan }` and make `dayFor(date)` the single accessor that applies it. Grep every reader of `.weeks[` / `.days[` in `app.js` (`vHome`, `upNext`, `vSchedule`, `vDayPreview`, notification context, `adherence`, streak heatmap, weekly summaries, `deloadRadar`) and route them through the accessor. Pure swap/validation logic lives in `program.js` with tests.
- **UI:** on a Plan-tab row, a `move` mini-button (next to the existing `view`/`log`) opens a sheet listing the other six days of that week with what is on each; tapping one performs the swap. A row with an override shows a small "moved" tag and an **Undo** that clears both dates' overrides. Same visual language as the existing sheets (`openReadiness`, the recovery-mode sheet).
- **Locked:** race day; any day with a logged session/run/routine (`ST.sessions`, `ST.runs`, `ST.routines`); days in the past. **Warnings, not blocks**, using the rationale already written in `WHY_SCHEDULE`: a lift day landing the day before the hard or long run; heavy lower within 48 h before the long run; two lower days back-to-back; a deload-week day swapped with a non-deload day (can't happen within a week, but check cross-week is disallowed). Show the warning in the sheet and let the user proceed.
- Hypertrophy-block days swap the same way (that is why Stage A made them dated). Mobility days swap too.
- Tests: swap is symmetric and idempotent (swap twice = original); locked days refuse; each warning fires on the exact fixtures above; `dayFor()` returns the override and `phaseLabel()` is unaffected (phase is a week property).

## Stage E — Progress: fewer, bigger things per section (v37, no schema change)

**Goal:** the user's words were "intuitively simplify" and "fewer, bigger things per section". Today's inventory, in render order:

- **Log segment** (`logBody()`): phase line; Fitness block (VO₂ edit, HRV chart with baseline band, EF chart, then 5–6 text lines: HRV vs baseline, recovery dip, aerobic-efficiency trend, race projection per race, weekly combined load, load-ramp flag); Running weekly-km bars; pace trend chart; run log rows; weekly-summaries archive; lifting weekly-tonnage bars; "Every lift you've logged" list.
- **Insights segment** (`insightsBody()`): insight of the week; strength trajectory bars; PR book (lifts + runs); aerobic engine verdict + EF chart again; four cause-and-effect cards (red-day story, load→HRV lag, run interference, RPE drift); block retrospective; hypertrophy retrospective.

That is ~20 items across two segments, several duplicated (EF chart twice, race projection and PR/run bests overlapping). Rebuild it as **four sections, each = one headline number + one chart + at most three lines**, everything else behind a "Details ›" disclosure or the existing detail views (`vExDetail`, `showWeeklySummary`, `showRetro`, `showHyperRetro`):

1. **Strength** — headline: this week's hard sets or tonnage vs last week; chart: weekly tonnage; lines: anchor-lift e1RM trajectory (top 3 movers), link to "All lifts ›" (the current every-lift list) and PR book.
2. **Running** — headline: weekly km; chart: weekly km bars with pace trend folded in as a second series or a toggle, not two charts; lines: last run, run bests, link to "Run log ›".
3. **Recovery** — headline: HRV vs baseline in words; chart: HRV with baseline band; lines: load-ramp flag if firing, one-line verdict; "Details ›" opens the cause-and-effect explorers and EF chart.
4. **Milestones** — insight of the week; next race countdown + projection when a race exists; retrospectives when they exist.

Rules: **phase-aware ordering** (Strength first during the hypertrophy block, Running first during the build); a section with no data collapses to a single dim line, never an empty chart; keep the Log/Insights segment control only if you can say what a second segment is *for* after this — the default expectation is that it goes; keep the fast-render work from v25 intact (`fmtDate` memo, cached derived data — Progress was profiled at 82 ms and must not regress; measure before and after with the same method noted in `program.js` above `fmtDate`); a11y as v29 left it. Do not delete any computation (`liftTrajectories`, `redDayStory`, `loadHrvLag`, …) — only where it renders.

## Constraints (all stages)

- Vanilla JS. No dependencies, no build step. Pure logic in `program.js`, views in `app.js`, tokens in `css/styles.css` (dark-only).
- Reuse: `nextPrescription`/`PHASE_POLICY`, `TEMPLATES` + `materializeTemplate`, `MUSCLE_MAP`, `stretchRoutine`/`areaStretchRoutine`/`prepRoutine`, `equip` swaps, `RACES`, `RACE_CHECKLIST`, `dayFor`/`weekFor`. Extend, don't fork.
- Migrations purely additive, one per stage, in the existing comment style; every migration proves logged history renders unchanged afterwards.
- `APP_VERSION` and `sw.js` `CACHE` bump **together** on every stage (v33 → v37).
- All three test suites green before and after each stage; new pure logic gets assertions.
- Every citation in code verified by you first; `why`/`deep` copy never overclaims.
- One commit per stage, message prefixed with the version, e.g. `v34: hypertrophy block — balanced 5-day split, weekly mobility, 2 easy runs`.
- If you hit a decision the brief does not settle (the February race name, whether a rest day beats a Sunday run in a given week, whether a piece of the old chest-and-arms code stays for the legacy path), make the call that keeps the calendar above intact, state it in the commit message, and move on.
