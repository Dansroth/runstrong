# Prompt: On-demand, area-targeted stretching — no workout required

Paste everything below the line into a fresh Claude Code session started in `C:\Users\rothd\runstrong`.

---

You are adding a **standalone stretch feature to RunStrong**, a personal PWA at `C:\Users\rothd\runstrong`: the user can open the app any time — not mid-workout, not tied to a lift or a run — pick a body area that's tight or sore (hip, lower back, hamstrings, etc.), and get a short, timed, guided stretch routine for exactly that area. Every stretch selected and every hold duration must trace back to real peer-reviewed evidence, not convention or feel.

**Read this section before anything else, because it changes how you must frame the whole feature.** The user's own stated reason for wanting this is pain — "I've had pains in my hip, back etc." This app already has a house position on what stretching can honestly claim (see below), and pain is a different, more serious claim than the soreness/tightness this app already talks about. Getting the framing right is not a nice-to-have on this task; it is the task, as much as the stretch selection is.

## What the app is

A single-user, offline-first strength PWA. No build step, no framework, no backend, no dependencies. Vanilla JS, string-template rendering, `localStorage` for all state.

- `js/program.js` — pure data and pure functions. Exercise/stretch libraries, progression engine, routine builders. Exports through `module.exports` so `tools/test-*.js` can drive it directly in Node.
- `js/app.js` — state, migrations, timers, every view.
- `css/styles.css` — the design system, tokens in `:root`, dark-only.
- `tools/test-progression.js`, `tools/test-stretch.js`, `tools/test-warmup.js` — dependency-free unit tests.

Baseline before you touch anything: `APP_VERSION = 'v27'`, `SCHEMA_VERSION = 11`, all three suites green (347 + 573 + 2294 assertions). Confirm that yourself before starting.

## Read this before you design anything

**Almost everything this needs already exists.** This is a much smaller build than it sounds — mostly a new selection/entry layer over a stretch library and a timer engine that are both already done.

Already in `js/program.js`:

- **`STRETCHES`** — 27 static stretches, each `{ id, name, muscles: [...], perSide, hold, instr }`. Muscle tags currently in use: `quads glutes hams calves adductors hipflex chest back shoulders core biceps triceps` — no separate neck tag exists, so a neck complaint has nowhere precise to map yet; decide whether that's in scope.
- **`stretchDur(st, hold)` / `STRETCH_SETUP_SECS`** — every hold is preceded by a 10-second "get ready" gap; per-side stretches pay for it twice. All time-budget math must derive from this, not a hand-rolled estimate.
- **`stretchRoutine(loads, mins, opts)`** — the existing post-workout routine builder. **Do not just call this with a fabricated `loads` object and consider the job done** — read it first. It has training-context assumptions baked in that don't fit this feature: it always gives `STRETCH_ESSENTIALS` (calves/hipflex/glutes/hams — the *runner* essentials) a guaranteed slot even when irrelevant to what the user actually picked, and it dedupes so a muscle only ever gets one stretch per call. Decide deliberately whether to reuse it, extend it with an opt-out flag, or write a smaller dedicated selector for this feature — and say which you chose and why.

Already in `js/app.js`:

- **`startRoutine(cfg)`** (~line 1968) — the single generic engine behind every guided timer flow in the app (prep, post-lift stretch, run cool-down all use it). Takes `{ list, kind, title, endLabel, markComplete, onDone }` and drives the whole `vStretch` screen: setup gap → hold → advance, pause/skip included. **This is your engine. Do not build a second one.** Note it has no de-duplication of its own — the same stretch object can legally appear twice in `list` to represent two sets of it; that matters below.
- **`vStretch`** (~line 2152) — the guided timer screen itself. Per the prior UX review, the best-designed screen in the app (zero scroll at 375×812). Match its quality bar; you're reusing it, not rebuilding it.
- **`ST.settings.disclaimerSeen`** (`js/app.js` ~line 18, shown ~line 1470) — the app's one existing disclaimer, currently: *"Guidance based on your own trends — it's training advice, not medical advice."* Shown once, on the pre-workout readiness sheet. This feature is making a more sensitive claim (it's responding to a stated pain complaint, not general training load), so decide whether this flag is the right mechanism to extend or whether a distinct, feature-specific disclaimer is warranted — but the *substance* requirement below is not optional either way.
- **`navBar()`** (~line 531) — four tabs today: Today / Plan / Progress / Settings. Adding a fifth is a bigger, more visible change than this feature needs; a Home-screen entry point is very likely the better fit, but that's your call to make and justify, not mine to dictate.

## The evidence that must drive the design

This app cites its sources — see the `PROGRESSION ENGINE` header in `program.js` for the house standard, and see the "evidence that must drive the design" section of `WARMUP_PROMPT.md` if it's still in the repo for the standard this exact codebase already set for stretching claims. You'll need, at minimum:

- **Static stretching does not produce clinically meaningful reductions in muscle soreness, and the evidence it prevents injury is weak** (Herbert & Gabriel 2002; Herbert, de Noronha & Holland 2011, Cochrane). This app already asserts this elsewhere — your new copy must not contradict it. **A "sore hip" stretch session is range-of-motion and comfort, not injury prevention, and absolutely not pain treatment.**
- **Exercise therapy, not passive stretching alone, is what the evidence actually supports for chronic low back pain** (Hayden JA, Ellis J, Ogilvie R, Malmivaara A, van Tulder MW. "Exercise therapy for chronic low back pain." Cochrane Database of Systematic Reviews, most recent update). This is the single most important citation for this task — it's the reason a "lower back" option in this feature must not be framed as treating the pain, only as a general mobility/comfort routine that is not a substitute for a proper assessment.
- **Dose-response for meaningful range-of-motion change**: current evidence suggests total time-under-stretch of roughly 60 seconds per muscle per session captures most of the benefit, with diminishing returns beyond that (Thomas E, Bianco A, Paoli A, Palma A. "The Relation Between Stretching Typology and Stretching Duration: The Effects on Range of Motion." Int J Sports Med. 2018). This should set how many reps of a given hold length you prescribe per area, not a round number picked by feel.
- **General flexibility-training guidance** (ACSM position stand on flexibility): roughly 10–30 second holds, 2–4 repetitions per stretch, on most days of the week for general adults. Useful as a sanity check on rep count, not as a replacement for the Thomas et al. total-time figure above.
- Verify every one of these against the actual source before writing it into the app, the same standard the rest of this codebase already holds itself to — don't trust this summary blind.

## What to build

### 1. An honest framing, decided before any UI is built

Before writing a single line of interface code, write down — and show me — the actual copy this feature will use to distinguish "this helps general tightness and range of motion" from "this is not an assessment or treatment of your pain." It must say plainly that new, worsening, radiating pain, or pain with numbness/weakness, is a reason to see a physio or doctor, not a reason to stretch harder. This is a **non-negotiable requirement**, not a style preference — get the substance right first, polish the wording second.

### 2. An area picker, mapped onto the existing muscle vocabulary

Design a small set of body-area choices a non-jargon user would recognise — something like *Neck & upper back, Shoulders & chest, Lower back, Hip & glutes, Front of hip/thigh, Hamstrings, Calves & Achilles, Arms* — each mapping to 1–3 of the existing `STRETCHES` muscle tags. Draft your own mapping and sanity-check it against what's actually in the library (e.g. `back` alone currently has to stand in for both "lower back" and "neck/upper back" complaints — decide if that's honest enough or if the copy needs to say so). Let the user pick more than one area in a single session if they want to.

### 3. The routine itself

Given the chosen area(s) and a time budget, select from `STRETCHES` and build a `list` for `startRoutine()`. Decide, and justify:
- How many *different* stretches per chosen area to include (the library often has 2+ per tag already — e.g. glutes has three).
- Whether a stretch should appear more than once in `list` to represent multiple sets, per the ACSM rep-count guidance — this works today with zero engine changes since `startRoutine`/`vStretch` don't dedupe, they just play whatever's in the list.
- The actual hold count/duration per area, derived from the ~60-second total-time-under-stretch figure above, not from copying the post-workout routine's one-rep-per-muscle behaviour verbatim — that behaviour was designed for breadth across a whole trained session, not depth on one aching area.

### 4. An entry point reachable from anywhere

It must be reachable with the app in **any** state: no active workout, any program mode (race program, balanced maintenance, hypertrophy phase), any day. Whatever you build for this (Home-screen card, a button in Settings, or something else) must not require starting a session first — that defeats the entire point of "I'm sore right now, not about to lift."

## Constraints

- Vanilla JS. No dependencies, no build step. Pure selection/timing logic in `program.js`, view/state in `app.js` — same split as everywhere else in this app.
- **Reuse `startRoutine`/`vStretch`/`STRETCHES`/`stretchDur`/`STRETCH_SETUP_SECS`.** Do not build a second timer engine or a second stretch-content library.
- If you add any new `STRETCHES` entries (e.g. to cover a gap like neck, if you decide that's in scope), give them the same full contract as existing entries and keep the existing plain-spoken, no-jargon `instr` voice.
- Schema migration, purely additive, following the existing migration comment style — only if you actually need new persisted state (e.g. tracking which areas someone picks most often); don't add persistence you don't need.
- Bump `APP_VERSION` and the `sw.js` `CACHE` string together.
- Match the established voice: short sentences, plain language, evidence cited with named/numbered refs the way the rest of the file already does it.

## Verify before you hand it back

1. `node tools/test-progression.js`, `node tools/test-stretch.js`, `node tools/test-warmup.js` — all three must still pass.
2. Add unit tests for whatever new pure logic you write (the area→muscle mapping, the routine builder, the timing math) in the same dependency-free style as the existing suites — this is exactly the kind of pure function `tools/test-stretch.js` is built to drive directly.
3. Drive it in the browser at 375×812, dark scheme: `node tools/serve.js 8317`. Confirm you can reach the feature with **zero** active session and **zero** program state assumptions, pick "Lower back," see the honest framing copy, and run the routine end to end through `vStretch`.
4. Confirm nothing about the existing post-workout stretch flow, prep flow, or run cool-down changed.

## Output

Start by reading `STRETCHES`/`stretchRoutine` in `program.js` and `startRoutine`/`vStretch`/the disclaimer site in `app.js`, then **give me the honest-framing copy and a short plan before writing any code**: your area-to-muscle mapping, your call on reusing vs. extending vs. bypassing `stretchRoutine`, your rep/duration numbers and the citation behind them, and where the entry point lives. I want to approve the framing and the shape before implementation — the framing especially, since that's the part that's actually hard to get right.

Then implement, test, and report what you verified and what you did not.
