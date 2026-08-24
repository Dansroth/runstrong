# Prompt: Warm-up and post-run stretching for RunStrong

Paste everything below the line into a fresh Claude Code session started in `C:\Users\rothd\runstrong`.

---

You are adding **two things** to RunStrong, a personal PWA at `C:\Users\rothd\runstrong`:

1. A **warm-up / movement-prep routine before every session — lifts *and* runs** — targeted at the muscle groups that session will actually use.
2. A **post-run stretching routine**, so run days get the same cool-down that lift days already have.

Both must be driven by muscle groups and grounded in the evidence, and both must survive the only test that matters: a tired person on a phone will actually do them.

## What the app is

A single-user, offline-first strength PWA supporting half-marathon prep — Geelong Half (B race, 2026-09-20) and Melbourne Half (A race, 2026-10-11). No build step, no framework, no backend, no dependencies. Vanilla JS, string-template rendering, `localStorage` for all state.

- `js/program.js` (~700 lines) — **pure data and pure functions.** Program, exercises, stretches, progression engine. Exports through a `module.exports` hook at the bottom so `tools/test-*.js` can drive it directly in Node.
- `js/app.js` (~2700 lines) — state, migrations, timers, and every view.
- `css/styles.css` — the whole design system, tokens in `:root`.
- `tools/test-progression.js`, `tools/test-stretch.js` — dependency-free unit tests.

Baseline before you touch anything: `APP_VERSION = 'v23'`, `SCHEMA_VERSION = 8`, and both suites green (471 + 276 assertions). Confirm that yourself before starting.

## Read this before you design anything

**Most of the machinery you need already exists.** Extending it is the job; rebuilding it in parallel is the main way this task goes wrong.

Already in `js/program.js`:

- **`MUSCLE_MAP`** — `exId → ['quads','glutes',…]`. Tags: `quads glutes hams calves adductors hipflex chest back shoulders core`. Every exercise is already mapped.
- **`STRETCHES`** — 23 static stretches, each with `muscles`, `perSide`, `hold`, and a plain-English `instr`.
- **`stretchRoutine(loads, mins, opts)`** — the post-session routine builder. `loads` is `{ muscle: setsCompleted }`. It fills the budget in three passes: what you trained (hardest-worked first, at least `TRAINED_SHARE` = 65% of the time), then runner essentials you *didn't* train as a capped tail, then leftover time back to the hardest-worked. Pure and unit-tested. Read the long comment above it — it documents a real regression and the reasoning that fixed it.
- **`stretchDur()` / `STRETCH_SETUP_SECS`** — every hold is preceded by a 10-second "get ready" gap, and per-side stretches pay for it twice. All time estimates derive from this.
- **`warmupPlan(exId, workWeight, step)`** — ⚠️ **this is a barbell load ramp, not a movement warm-up.** It returns `bar × 10`, `50% × 5`, `70% × 3`, `85% × 1`. It solves the "Potentiate" problem for heavy lifts and nothing else. Do not extend it, do not rename it, and **do not give your new function a name that could be confused with it.**

Already in `js/app.js`:

- **`buildStretchRoutine(sess, mins)`** — derives `loads` from a completed session and calls `stretchRoutine`. It already passes *synthetic* loads for a recent long run, which is how "day after a long run" gets calves and hamstrings to the front. That precedent matters — reuse the pattern rather than special-casing runs.
- **`vStretch`** — the guided timer screen: setup gap → hold → advance, with pause and skip. The UX review called this **the best-designed screen in the app** (812px in an 812px viewport, zero scroll, 77px countdown, 60px buttons). It is your quality bar, and probably your engine.

Currently **run days have no session flow at all** — `vHome` renders a card with a "Log this run" button and nothing else. That gap is the substance of this task.

## The evidence that must drive the design

This app cites its sources. Read the `PROGRESSION ENGINE` header comment in `program.js` for the house standard: numbered refs, and each rule stating which ref it rests on, so a future change can be checked against literature rather than vibes. Match it.

**Before a session — dynamic, not static.**

- Long static holds (≥60s per muscle) acutely reduce force and power output. Under ~30s the effect is small to trivial. (Behm & Chaouachi 2011; Simic et al. 2013; Behm et al. 2016.)
- Dynamic stretching and movement prep preserve or slightly improve subsequent performance.
- The standard structure is **RAMP** — Raise, Activate, Mobilise, Potentiate (Jeffreys 2006). Note that for barbell work the existing `warmupPlan` ramp already *is* the Potentiate step; you are supplying Raise / Activate / Mobilise ahead of it.
- For runs, a submaximal jog raises muscle temperature, and strides before quality sessions acutely improve running economy.

**Consequence, and it is not optional: no long static holds may appear in any pre-session routine.** Reusing `STRETCHES` for warm-ups is the obvious shortcut and it is the wrong call. Build a separate dynamic library.

**After a session — static is fine, but do not overclaim it.**

- Static stretching before or after exercise does **not** produce clinically meaningful reductions in muscle soreness, and the evidence that it prevents injury is weak. (Herbert & Gabriel 2002; Herbert, de Noronha & Holland 2011, Cochrane.)
- What actually reduces running injuries is strength training — substantially, and far more than stretching, which showed no significant effect. (Lauersen, Bertelsen & Andersen 2014, BJSM.)
- What static stretching *does* deliver is range of motion when done consistently, plus a genuine wind-down ritual.

So the post-run routine is honestly framed as **range of motion and winding down — not injury prevention**. If you write user-facing copy implying otherwise, you have failed the task. There is a pleasing point to make here: the reason this user is protected from injury is the lifting they are already doing, and the app can say so.

## What to build

### 1. Pre-session movement prep — lifts and runs

- A new dynamic-movement library in `program.js`, tagged against the same muscle vocabulary as `MUSCLE_MAP`. Movements are dynamic (leg swings, walking lunges, hip openers, ankle rocks, band pull-aparts, scap work). Plain-English `instr` in the same voice as `STRETCHES` — short sentences, no jargon.
- A routine builder with the **same contract shape** as `stretchRoutine(loads, mins, opts)` so the two are learnable as one idea and testable the same way.
- **Where `loads` comes from is the wrinkle.** `stretchRoutine` reads *completed* sets. A warm-up runs before anything is completed, so derive planned loads from `TEMPLATES[tplId]` for a lift day, and from a run profile for a run day. Write that helper as a pure function in `program.js`.
- **Run muscle profile.** Running loads calves (soleus especially — the app already argues elsewhere that soleus takes the highest forces of any muscle in running), hamstrings, glutes, quads, hip flexors. Easy, hard, long and race days should not all get the identical profile; a hard session deserves strides, an easy run does not need much.
- **Taper and race weeks make the warm-up more important, not less.** Check `phaseKeyFromLabel()` — the routine must never be truncated in taper or race week, even though the session itself shrinks. Pre-race static stretching in particular must not appear.

### 2. Post-run stretching

- Reuse `stretchRoutine`. It already accepts run-derived loads; the precedent for synthetic run loads is in `buildStretchRoutine`. This should mostly be plumbing, not new logic.
- Give run days a place to reach it. Today they have none.

### 3. The one real technical wrinkle

Dynamic warm-up items are frequently **rep-based** ("10 leg swings each side"), while `vStretch`'s engine assumes a **timed hold**. Decide deliberately between giving every prep item a time budget so the existing engine runs unchanged, or extending the engine to handle reps — and say which you chose and why. Do not half-do both.

## Constraints

- **Brevity is a feature.** A warm-up that meaningfully lengthens the session gets skipped, and a skipped warm-up has zero effect size. Target something like 5–8 minutes and justify whatever you pick. Note the history: sessions were *extended* after week-1 feedback that they finished in ~20 minutes, so there is some room — but spend it knowingly.
- **Phone, one hand, portrait, gym floor, often offline.** Glanceable at arm's length. `vStretch` is the standard to match.
- **Do not bury "Log this run."** The UX review already flagged fold pressure on small screens (375×667). Whatever you add to the run card must not push it below the fold.
- Vanilla JS. No dependencies, no build step. Pure logic in `program.js`, views in `app.js`.
- Schema migration **8 → 9**, purely additive, following the comment style of the existing migrations. Existing history must be untouched.
- Bump `APP_VERSION` and the `sw.js` `CACHE` string **together** — they are currently both `v23`.

## Verify before you hand it back

1. `node tools/test-progression.js` and `node tools/test-stretch.js` — both must still pass at full count.
2. A new `tools/test-warmup.js` in the same dependency-free style, asserting at minimum:
   - **no static hold from `STRETCHES` ever appears in a pre-session routine** (the headline regression this suite exists to prevent);
   - every lift template's prep covers the muscles that template actually trains;
   - each run type gets a profile appropriate to it;
   - routines stay inside their time budget, using `stretchDur`-equivalent accounting including setup gaps;
   - taper and race-week routines are not truncated.
3. Drive it in the browser at 375×812, dark scheme: `node tools/serve.js 8317`. Walk a lift day through prep → session → stretch → summary, and a run day through prep → log → cool-down. Do not review from source alone.
4. Confirm offline still works with the server stopped.

## Output

Start by reading `program.js` and the stretch flow in `app.js`, then **give me a short plan before writing code** — what the prep library looks like, how `loads` gets derived pre-session, your call on the rep-vs-time wrinkle, and where run days gain their entry points. I want to approve that shape before implementation.

Then implement, test, and report what you verified and what you did not.
