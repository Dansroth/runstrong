# Prompt: Summer block — February becomes a 10 km, the half build is removed, lifting stays the point

Paste everything below the line into a fresh Claude Code session started in `C:\Users\rothd\runstrong`, after v38 is live. One commit and version bump per stage. Nothing here is urgent before **Mon 2026-11-30** — the recovery week and the nine-week hypertrophy block are unchanged and keep running as built.

---

You are changing what happens **after** the hypertrophy block in **RunStrong**, a personal offline-first PWA at `C:\Users\rothd\runstrong` (vanilla JS, no build step, no dependencies, `localStorage` state; `OFFSEASON_PROMPT.md` §"What already exists" and `HYPERTROPHY_PROMPT.md` §"What the app is" describe the architecture).

The decision that drives everything below: **the February race is now a 10 km, not a half, and the user is not running a half-marathon build for it.** The goal for this summer is muscle — building it and looking good for it — with running kept to a modest externally-owned plan. In the user's words: *"I'm keen to build muscle and look good for summer. I have a 10km run in Feb but will take a bit of time off a proper running program and only do maintenance runs."*

Concretely:

- The **Carman's Classic** entry on **Sun 2027-02-21** becomes the **10 km**, and it is no longer an A race.
- The **12-week half-marathon build is deleted** — not disabled, deleted.
- From **Mon 2026-11-30** to race day, a **summer block**: lifting stays hypertrophy-focused at **3–4 sessions a week** (down from 5), and running is **three sessions a week that RunStrong does not prescribe**.
- The running comes from the user's **Runna** app. RunStrong's job is to hold the slot, let it be logged, and schedule lifting around it — never to write the session.

## The calendar (fixed — do not re-derive)

| Dates | Phase | Weeks |
|---|---|---|
| Mon 21 → Sun 27 Sep 2026 | Post-race recovery week (`RECOVERY_LAYOUT`) | 1 | 
| Mon 28 Sep → Sun 29 Nov 2026 | Hypertrophy block, 5 lifts + 2 easy runs + mobility (`HYPER_WEEK`) | 9 |
| **Mon 30 Nov 2026 → Sun 21 Feb 2027** | **Summer block** — 3–4 lifts + 3 Runna runs | **12** |

`RUN_BUILD_START` (2026-11-30) + 84 days − 1 = 2027-02-21, so the summer block ends exactly on race day and is the same twelve weeks the half build occupied. The date constant keeps its value; rename it (`SUMMER_START` or similar) since "run build" no longer describes what starts there.

The transition week — block week 9, Mon 23 → Sun 29 Nov, `TRANSITION_WEEK` — was written to ease running back to three days before the build started. That is still exactly right: the Runna plan is three runs a week and it starts the Monday after. **Leave it alone.**

## The running, as the user described it

Owned by Runna, starting Mon 2026-11-30, three sessions a week:

- **Tuesday and Friday** — one **easy run 5–10 km** and one **tempo run 5–10 km**, and *"these alternate Tuesdays and Fridays"*.
- **Sunday** — **long run, 10–16 km**.

RunStrong shows these as run days with the distance band and the session type, and nothing more: no pace targets, no interval prescriptions, no long-run progression table. Logging, adherence, streaks and day-swapping must treat them as ordinary run days so nothing downstream special-cases them.

**Ambiguity to resolve before you build it:** "alternate" most likely means the pair swaps week to week (wk 1 easy Tue / tempo Fri, wk 2 tempo Tue / easy Fri). Implement that as a single documented constant so flipping it is a one-line change — and confirm the reading with the user rather than burying the assumption.

## What already exists — read before designing

- `RACES` (`program.js` ~line 8) — `{ key: 'feb2027', name: 'Carman\'s Classic Half Marathon', tag: 'A race', date: '2027-02-21' }`. Also check `finalRace()` / `nextRace()` in `app.js` and every caller: **the app currently always has an A race, and after this change it will not.** If anything keys off the `'A race'` tag, fix it properly rather than leaving the tag lying about the distance.
- `buildProgram()` (`program.js` ~1414) — `buildRaceBlock().concat(buildOffseason(), buildRunBuild(feb.date, feb.key))`. The third call is what you are replacing.
- **To delete:** `RUN_BUILD_WEEKS`, `RUN_BUILD_PLAN`, `buildRunBuild()` (`program.js` ~1288–1330 and the doc comment above them), `MAINT_2` / `MAINT_3`, and the exports on ~line 1788.
- **Not to delete:** `TEMPLATES.maintLower` / `maintUpper` / `maintFull` (`program.js` ~816–818). They are still used by the legacy free-form maintenance mode — `maintenanceCard()` (`app.js` ~1532). Removing them breaks that path. Grep before you cut anything.
- `PHASE_POLICY` (`program.js` ~1533) and `phaseKeyFromLabel()` (~1577). The old build put lifting on `PHASE_POLICY.maint`. **The summer block does not.** Muscle is still the goal, so loading weeks stay on `PHASE_POLICY.hypertrophy` and deload weeks on `hyperDeload`. If a reduced-frequency variant is warranted, add one and justify it — do not reach for `maint`.
- `HYPER_MESO_WEEKS = 4`, `HYPER_RAMP`, `hyperWeekInBlock()`, `materializeTemplate()`, `HYPER_POOLS`, `hyperExId()` and the `'ROTATE:<pool>'` sentinel (`program.js` ~930–1000). Rotation and the volume ramp are pure functions of `weeksSince(HYPER_START, dateISO)`, so they continue across 30 November on their own. `hyperExId()` is `pool[floor(weeksSince / HYPER_MESO_WEEKS) % pool.length]` — the index keeps advancing for as long as the anchor holds, and wraps when it runs off the end of a pool. Anchor lifts (squat, bench, rdl, pullup, ohp, bbcurl, overheadext) are literal ids and never rotate, so the e1RM trajectory stays continuous [H9].
- `mesoAnchor()` (`program.js` ~1422).
- Copy that describes the old plan and must change: the narrative at `program.js` ~1037, the week-summary line at `app.js` ~1501, and the Plan-tab blurb at `app.js` ~3380.
- Tests referencing the run build: `tools/test-progression.js` ~296–330 and ~459–466.
- Persistence: `SCHEMA_VERSION = 18` (`app.js` ~6), `APP_VERSION = 'v38'` (~212). `ST.program` is **stored, not recomputed**, so a calendar change needs a schema bump and a migration that rebuilds it — migration `1 → 2` is the precedent. Keep `sw.js`'s `CACHE` in step with the version bump.

## Settled — the user's answers (2026-09-20)

The open decisions below were put to the user and answered. **One answer widened the scope: the current nine-week block changes too**, so the line above about it being unchanged no longer holds.

- **Pre-30 Nov (the nine-week block):** five lifts a week, four of 60 min on **Mon, Tue, Thu, Fri**, and the **30-minute session on Sunday** paired with the existing easy run. Wednesday keeps run + mobility. **Saturday becomes the rest day** — the block currently has none. The four 60-min days map onto the existing `hypLowerA` / `hypUpperA` / `hypLowerB` / `hypUpperB`; `hypArms` is what moves to Sunday and is re-scoped to fit 30 minutes.
- **From 30 Nov (summer block):** lifts **Mon, Wed, Sat** at 60 min, the **30-minute session on Tuesday** stacked with that day's Runna run, **Thursday** rest/mobility. Runs stay Tue/Fri/Sun.
- **Saturday's session is upper/arms-dominant**, legs left alone, so the Sunday long run starts fresh.
- **Anchoring:** re-anchor the volume ramp to 30 Nov so the summer block opens on mesocycle week 1, but give the exercise rotation its own continuous anchor so accessories keep advancing instead of snapping back to October's.
- **Scope:** all five stages.
- **Not asked, assumed:** race week is a lighter final week with nothing heavy after the Wednesday; the Tue/Fri easy/tempo pair alternates week to week as a single documented constant.

## Open decisions — as put to the user

1. **Is there a rest day, and where does the 30-minute session go?** Three Runna runs (Tue/Fri/Sun) plus four lifts is seven days of training and no rest day, which the hypertrophy block deliberately avoided by carrying mobility on a run day. The recommendation: **three lifts as the spine — Mon, Wed, Sat — with Thursday as a flex day** that is mobility by default and an optional fourth lift when the user feels good. That honours "3–4 days", keeps a real rest day in a normal week, and puts Saturday's session a day clear of the Sunday long run. The 30-minute session (see Stage B) then most naturally stacks onto a Tuesday or Friday Runna run, giving four lift touches a week without costing the rest day — but confirm that with the user before laying out the week.
2. **Saturday lift vs Sunday long run.** Whatever lands on Saturday should not leave the legs wrecked for the long run. Either keep Saturday upper/arms-dominant, or hold it to moderate RPE on lower work. Pick one, document why in a comment beside the layout, and say which you picked.
3. **Mesocycle anchoring at 30 November.** `hyperWeekInBlock(HYPER_START, '2026-11-30')` returns week 2 of a mesocycle, so continuing the existing anchor starts the summer block mid-ramp. Either re-anchor to 30 Nov so the block opens on week 1, or carry the rotation through unbroken. **Note the side effect before choosing:** `hyperExId()` reads the same anchor, so re-anchoring resets the pool index to 0 and brings block 1's accessories straight back on 30 November — the opposite of what the rotation is for. If you re-anchor the ramp, the rotation index needs its own continuous anchor. Either way the twelve weeks need a deload rhythm (three loading weeks + a deload, per `HYPER_MESO_WEEKS`).
4. **Race week.** The 10 km is a run the user is doing, not a peak they are chasing — but turning up to a start line with Saturday's session still in the legs is a bad trade for no benefit. Recommendation: a lighter final week, lifting kept short, nothing heavy after the Wednesday.

## Stage A — the race, the calendar, and the end of the half build (v39, schema 19)

1. `RACES.feb2027` becomes the 10 km: fix the `name`, drop it off `'A race'`, keep `key` and `date`. Audit `finalRace()` / `nextRace()` and their callers for the no-A-race case.
2. Delete `buildRunBuild()` and its data, per the list above. Leave the `maint*` templates.
3. Add the summer block builder — twelve weeks from `RUN_BUILD_START`, run slots on Tue/Fri/Sun per the Runna spec, lift slots per the layout agreed in decision 1, mobility kept weekly, deload rhythm per decision 3, race week per decision 4. Same `{ phase, monday, days }` shape as `buildOffseason()` so the Plan tab, `dayFor()`, adherence, streaks and day-swapping need no changes.
4. `buildProgram()` calls the new builder. Schema 19 migration rebuilds stored `ST.program`.
5. Tests: the calendar is still race block + recovery + hypertrophy + twelve, the summer block starts on the Monday after the last hypertrophy week, week 12 ends on 2027-02-21, no gap or overlap at the 29/30 Nov seam, and every summer week has exactly three runs and three-or-four lifts.

## Stage B — the lifting split at reduced frequency (v40)

The block's five sessions (`hypLowerA`, `hypUpperA`, `hypLowerB`, `hypUpperB`, `hypArms`) have to become three, plus an optional fourth. This is the part that needs real thought rather than deletion:

- **[H2] (Schoenfeld 2019, ≥2×/week beats 1× at matched volume)** is the binding constraint. Three sessions cannot be a push/pull/legs split without dropping every muscle to once a week. Upper/lower/full, or three full-body-leaning sessions, are the candidates — pick from the evidence already catalogued in the HYPERTROPHY BLOCK header comment (`program.js` ~854) and justify the choice in a comment naming the refs.
- Weekly hard sets per muscle will fall by roughly a third. Where that lands is not a free choice — see the priority section below.
- Keep every new template on the same exercise/`MUSCLE_MAP`/`STRETCHES`/`PREPS` contract so warm-ups and cool-downs still cover what was trained. Keep the `HYPER_RAMP` volume ramp and the deload at the mesocycle boundary.
- The optional fourth session must be genuinely optional — skipping it is a complete week, not a failed one, and the copy should say so in the app's existing "skip guilt-free" register.

### Session length — 60 minutes, and one short session paired with a run

The block's sessions are currently `est` 50–55 min (`hypLowerA`/`UpperA`/`LowerB`/`UpperB` 55, `hypArms` 50). The summer block changes that:

- **Every session is a full 60 minutes**, except one.
- **One session is 30 minutes.** The user pairs a run with that session on the same day, so the day still costs about an hour. Build it as a short, dense lift that leaves something in the legs and lungs — not a 60-minute session with the last two exercises deleted.
- `est` is what the UI promises, so the prescribed work must actually fit it. Check the arithmetic against the sets, reps and `rest` values of the exercises you pick rather than setting `est` to 60 and hoping.

**The extra minutes are not spread evenly** — 55 → 60 across the session count is real room, and it goes to the protected muscles in the priority section below. This also softens the volume cut: five 50–55 min sessions was ~270 min of lifting a week; three sessions at 60/60/30 is 150, and 60/60/60/30 with the optional fourth is 210. Say which muscles the recovered minutes went to.

**Which day the 30-minute session lands on is part of open decision 1**, because it interacts with the rest day and the Runna schedule. Two readings, and the user should confirm which: either the short lift stacks onto an existing Runna run day (Tue/Fri), which keeps three lift days and a genuine rest day, or it sits on its own day with an extra easy run added, which makes a fourth run in the week. [H11] (Schumann 2022 — same-day vs separate-day concurrent training made no difference to hypertrophy) says the stacking itself costs nothing, so this is a scheduling question, not a physiological one.

### Where the volume goes — the priority has changed

Measured from the current block (average hard sets per muscle across loading weeks 1–3, counted through `MUSCLE_MAP` via `materializeTemplate`, so compounds credit every muscle they involve):

> shoulders 22.3 · glutes 20.0 · back 19.0 · quads 15.0 · **chest 12.7** · hams 11.3 · triceps 11.3 · **biceps 11.3** · calves 8.0 · adductors 3.3 · **core 2.0** · hipflex 2.0

That ordering is inherited from the running program, where lifting existed to make a half-marathon survivable. **The summer block's goal is different and the user has stated it plainly: chest, biceps and abs.** Re-rank accordingly.

- **Protected — the surviving volume goes here first: chest, biceps, core.** Chest and biceps hold at least their current weekly sets at ≥2×/week frequency [H2], despite the session count dropping. If something has to give to make that arithmetic work, it gives somewhere else.
- **Core is the outlier and must change.** It currently gets 2 sets a week of one exercise (hanging leg raise, on `hypArms` — the session most likely to disappear in the compression). Raise it to a real, progressive dose trained ≥2×/week [H2], loaded rather than endless bodyweight reps, and give it its own rotating pool like every other accessory slot. Note that `pallof`, `abwheel` and `copen` already exist in the library but are anti-rotation/anti-extension work sitting in the *running* templates — direct trunk flexion under load is what is actually missing.
- **Absorbing the cut — glutes, quads, hams, calves.** The user runs three times a week through this block, including a tempo and a 10–16 km long run, so the lower body is not short of stimulus. Keep enough to hold what the nine-week block built and to keep them running healthy — the single-leg and posterior-chain work carries real injury-resilience rationale in its `why` copy, so do not gut it — but this is where the sets come from.
- **Shoulders and back** sit at the top of that table partly through double-counting: bench and incline press credit shoulders, rows credit back and biceps. Recount direct work before deciding what they can afford to lose.
- **Report the numbers.** Produce the same per-muscle table for the new split, before and after, and put it in the summary. A priority change this size should be visible as arithmetic, not asserted in prose.

**On the six-pack, say this to the user and keep it out of the app copy:** ab visibility is driven mostly by body fat, not ab volume. More core work builds the muscle underneath and is worth doing on its own merits, but RunStrong does not track nutrition, so the block cannot deliver the look by itself. Do not add nutrition tracking, calorie or macro features, or body-fat estimates — Stage E's plain bodyweight log is the one exception, and it is measurement, not coaching. Do not let any exercise `why` copy imply the app delivers a six-pack — the honesty rule from `WARMUP_PROMPT.md` applies here exactly as it does to a leg extension not helping a half marathon.

### Exercise rotation is not optional — it is the point of the block's structure

`[H9]` (Fonseca 2014) is already in the block's evidence header: **varied exercise selection beat constant selection at matched overload**. That is why accessories rotate every mesocycle while anchor lifts never do, and the summer block must carry that principle forward rather than quietly freezing the selection for twelve weeks. Three requirements:

1. **Every rotating slot survives the compression.** Collapsing five sessions into three retires whole templates, and `HYPER_POOLS` slots go with them — `bicepsAcc` and `tricepsAcc` currently live on `hypArms`, which may not exist any more. Every pool that disappears must be rehomed into a surviving session or consciously retired, and you must say which. A muscle silently losing its rotating accessory is the failure mode to avoid here.
2. **The pools are long enough for five mesocycles, not two.** The existing block spans two rotations; the summer block adds three more (the index reaches 5 by race week). `bicepsAcc`, `tricepsAcc`, `quadAcc`, `calfSeat` and `shoulderAcc` hold only two exercises each, so they alternate A/B/A/B and the same exercise returns every eight weeks. That still satisfies [H9], but it is thinner variety than the block was designed to deliver. **Extend the two-entry pools to at least three or four options** before the block runs out of new stimulus in January — check the 62-exercise library first and only add exercises that are genuinely missing (the library had no lateral raise, no leg extension, no seated leg curl at last audit; grep before adding, and any new exercise needs its full contract).
3. **Tests cover it.** Assert that across the twelve summer weeks each rotating slot actually changes exercise at the mesocycle boundary, that no rotating slot resolves to the same exercise for more than one mesocycle in a row, and that anchor lifts never change. Assert the protected muscles too: chest, biceps and core hold their target weekly sets in every loading week of the block.

## Stage C — copy and UI (v41)

Everywhere the app currently says the February half or maintenance lifting, it now says the 10 km and the summer block. At minimum: the narrative at `program.js` ~1037, `app.js` ~1501 and ~3380. Read them and fix the meaning, not just the words — ~1037 describes a long-run progression that will no longer exist, and ~1501 promises lifting drops to maintenance, which is now the opposite of what happens.

**`showHyperRetro()` (`app.js` ~3321) needs real work, not a copy edit.** It is the report the user opens mid-block to see how it is going, and it is hardcoded to the nine-week block in three separate ways:

- `weeksIn` is clamped by `HYPER_WEEKS`, so from late November it reads "week 9 of 9" for the whole summer.
- `weekTpls` is derived from `HYPER_WEEK`, so it reports session adherence against the five retired templates: the sessions the user is actually doing never appear, and the ones they are not show as zero.
- the rotation list walks `HYPER_POOLS` through `HYPER_POOL_LABEL` (`app.js` ~3320), so any pool rehomed or retired in Stage B renders wrong — and a new pool with no label entry renders `undefined: <exercise>`. **Every pool needs a label.**

Make the report phase-aware: it should know which block it is reporting on, count weeks against that block's length, and read its template list from that block's layout rather than from `HYPER_WEEK`. Check the `hyperReady` gate at `app.js` ~2773 while you are in there.

## Stage D — weekly sets per muscle (v42)

The app prescribes from `[H1]` (weekly hard sets drive hypertrophy) and `[H2]` (≥2×/week per muscle), cites both in code, and then gives the user no way to see whether a week actually delivered them. Progress currently offers total tonnage and e1RM trajectories — both strength metrics. The hypertrophy metric is missing, and it is the one that matters for this block.

Build it:

- **A per-muscle weekly set count from logged sets**, not from the plan — what was done, not what was prescribed. `MUSCLE_MAP` over completed sets is already the exact pattern at `app.js` ~2057 (stretch routine) and ~2137 (soreness note); reuse it rather than inventing a third counting path. Count a working set once per muscle the exercise maps to, and state that convention in the UI, because compounds crediting several muscles is why "shoulders" looks inflated.
- **Shown against the block's target for that muscle**, so the protected muscles from Stage B are visibly holding. Sorted by volume, current week plus the trend across the block.
- **Per-muscle tonnage over time** alongside the set count. Total tonnage hides whether chest specifically is doing more work than it was in October.
- It belongs in Progress, in the strength section, and only when the current phase is a hypertrophy one — `phaseKeyFromLabel()` already distinguishes these.
- Pure counting functions live in `program.js` with assertions in `tools/test-progression.js`: a known set of logged sessions produces a known per-muscle count, compounds credit every mapped muscle, and deload weeks halve as expected.

## Stage E — bodyweight log (v43, schema bump)

The user's goal this block is visual, and the app has no way to know whether it is working. Add a **bodyweight log — weight only**. The user has explicitly declined waist or any other measurement, so do not add one, and do not add a "measurements" section that implies more fields are coming.

- **Weekly, not daily.** One number a week, easy to skip, no streak attached to it and no nagging.
- **Show a rolling average trend, never a single-point verdict.** No goal weight, no target band, no judgement copy, no "on track / off track". The app's voice is "skip guilt-free" and that applies here more than anywhere else in the app.
- Stored in the existing single-blob `ST` state with a schema bump and migration; plots in Progress beside the strength section.
- Nothing derived from it beyond the trend: no BMI, no body-fat estimate, no calorie maths, no inference about whether the block is "working".

## Constraints (all stages)

- Vanilla JS, no build step, no dependencies, offline-first. New pure functions live in `program.js` and are exported through the `module.exports` guard at the bottom.
- Every pure function you add gets assertions in `tools/test-*.js`. Run `node tools/test-progression.js` (and the stretch and warm-up suites) before each commit.
- Serve with the `runstrong` config in `.claude/launch.json` (port 5173) and actually look at the Plan tab across the 29/30 Nov seam and race week before calling a stage done.
- House style for evidence: numbered refs in a header comment, each rule naming the ref it rests on. Do not overclaim in `why` copy — the honesty rule from `WARMUP_PROMPT.md` applies, and a summer hypertrophy block should not pretend to be helping a 10 km.
- One commit and one version bump per stage; `APP_VERSION` and the `sw.js` `CACHE` string move together.
- Present decisions 1–4 and the Tuesday/Friday alternation reading before implementing, then build.
