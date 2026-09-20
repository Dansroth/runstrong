# RunStrong — Current State Audit

Audited at `APP_VERSION = 'v25'`, `SCHEMA_VERSION = 9` (2026-08-24), against the actual code in this repo — not against `UX_REVIEW.md`, `WARMUP_PROMPT.md`, or `UX_REVIEW_PROMPT.md`, which are prior work products and were used only as leads. Every claim below was checked against `js/app.js`, `js/program.js`, `css/styles.css`, `index.html`, `sw.js`, `manifest.json`, and `tools/*.js` as they exist today, and the two test suites plus a new `tools/test-warmup.js` were run (all green — 276 + 471 + 1955 assertions). Where I could not fully verify something from static reading (e.g. real-device behaviour), I say so explicitly.

File sizes at audit time: `js/app.js` 3051 lines, `js/program.js` 957 lines, `css/styles.css` 374 lines, `index.html` 24 lines.

---

## 1. Stack and architecture

**Framework: none.** Vanilla JS, ES2017-ish syntax, no build step, no bundler, no npm dependencies (no `package.json` anywhere in the repo — confirmed by `find`). `index.html:21-22` loads `js/program.js` then `js/app.js` as plain `<script>` tags. `program.js` guards a `module.exports` block (`js/program.js:947-957`) behind `typeof module !== 'undefined'` purely so `tools/test-*.js` can `require()` it under Node — in the browser this is a no-op and the file stays a classic global script.

**Rendering model: full string-template re-render.** There is no virtual DOM and no diffing. `render()` (`js/app.js:485-516`) picks a view function from a table (`vHome`, `vSchedule`, `vSession`, `vSummary`, `vExDetail`, `vSettings`, `vStretch`, `vProgress`, plus `history`/`trends` aliased to `vProgress` for old deep links), calls it to produce one HTML string, and sets `APP.innerHTML` to it wholesale. Every state change that should be visible calls `render()` again. Scroll position is manually preserved only for the session view (`keepScroll`, `js/app.js:490,505`); every other navigation resets to the top (`js/app.js:481`, with a `schedule`-view exception at `js/app.js:477-480` that scrolls the current week into view instead).

**State management: one global mutable object plus explicit `save()`.** `let ST = loadState()` (`js/app.js:103`) is the entire application state, held in memory and mutated in place by handler functions (mostly `window.*`-exposed functions referenced from inline `onclick=` attributes in the generated HTML — there is no addEventListener-based event delegation for the bulk of the UI). `save()` (`js/app.js:104-109`) serializes `ST` to `localStorage` on every mutation that matters; there is no batching, debouncing, or transactional grouping — each logical action (log a set, tick a checkbox, toggle a setting) does its own `save()` call synchronously. A few derived-data caches (`_exHistCache`, `_mergedAllCache`, `_actIndex`) exist purely for render performance and are invalidated inside `save()` (`js/app.js:107`) and again at the top of `render()` (`js/app.js:489`) so they can never outlive a mutation.

**Backend: none.** Everything is client-side. The two integrations that touch the network are opt-in and non-essential:
- **Strava** (`js/app.js:739-839`): browser calls Strava's OAuth/API directly with credentials stored in `ST.strava` in `localStorage`; there is no server-side proxy by default (an optional `tokenUrl` proxy field exists for CORS workarounds, `js/app.js:754,772`). The Settings copy itself states this now requires a paid Strava subscription (`js/app.js:2870`), so for most users this path is effectively dead in practice even though the code is fully wired.
- **Garmin Connect CSV import** (`js/app.js:843-921`): a hand-rolled CSV parser (`parseCSV`, `js/app.js:843-861`) reads a file the user exports manually from Garmin Connect's website; no network call at all. This is the actively-used run-data path.

**Database: none — `localStorage` is the only persistence.** Single key `runstrong.db` (`DB_KEY`, `js/app.js:5`) holds the entire serialized state object. A second key, `runstrong.backup.v4`, is written once as a pre-migration safety snapshot before the schema-4→5 (Strava) migration (`js/app.js:38`) and is restorable/downloadable from Settings (`js/app.js:2877,2891-2902`). There is no IndexedDB usage anywhere in the codebase (verified: no `indexedDB` references in `js/app.js` or `js/program.js`).

**Auth: none in the product sense.** This is a single-user, single-device app with no login. The only "auth" is Strava's OAuth handshake (`js/app.js:750-799`), which is a data-source connection, not app authentication.

**Persistence mechanism:** synchronous `localStorage.setItem`/`getItem` (`js/app.js:86,108`), wrapped in `try/catch` on load (`js/app.js:85-95`) so a corrupt/unparseable blob falls back to `defaultState()` rather than crashing the app. `navigator.storage.persist()` is requested once at boot (`js/app.js:3040`) as "free eviction insurance" against the browser reclaiming storage under pressure — best-effort, not guaranteed, and there's no user-visible fallback if it's denied.

**Offline behaviour / service worker:** `sw.js` is a classic cache-first worker. `CACHE = 'runstrong-v25'` (`sw.js:2`, kept in lockstep with `APP_VERSION` in `js/app.js:114` — a manual convention, not enforced by tooling). On `install` it precaches the full asset list (`sw.js:3-12`: `./`, `index.html`, `styles.css`, `program.js`, `app.js`, `manifest.json`, both icons) and calls `skipWaiting()`. On `activate` it deletes any cache key that isn't the current version and calls `clients.claim()`. The `fetch` handler (`sw.js:32-47`) is cache-first with network fallback and re-caching of successful same-origin responses, and explicitly bypasses the cache for any cross-origin request (`sw.js:34` — this is what lets Strava API calls through without being intercepted). A network failure with no cache hit falls back to serving `./index.html` (`sw.js:44`), which is a reasonable SPA-style offline fallback but means an offline deep-link to a missing asset silently becomes the home shell rather than an error. Update flow: the app listens for `controllerchange` and shows a manual "tap to reload" banner (`js/app.js:2988-2998`) rather than auto-reloading, and re-checks for updates on every `visibilitychange` to `visible` (`js/app.js:3001-3003`) because installed PWAs can resume from background without a cold start. `fresh.html` is a separate, manually-visited escape hatch that unregisters all service workers and clears all caches, then reloads — for when the normal update path itself is stuck.

**No push notifications are ever requested proactively for their own sake**, but `Notification.requestPermission()` is called once, opportunistically, the instant a lift session starts (`beginSession()`, `js/app.js:1429-1433`), with no explanatory copy shown first. If granted, `scheduleBgNotify()` (`js/app.js:231-242`) uses it only for a best-effort "rest done" notification while the tab is backgrounded (Android/desktop; iOS suspends JS timers when locked, so the comment at `js/app.js:229-230` notes the in-app alert on reopen is the real fallback there). This is a known rough edge (see §4).

---

## 2. Feature inventory

Legend: ✅ working · 🟡 half-built / partial · 🔴 stubbed or effectively dead.

### ✅ Fully working

| Feature | Files | Notes |
|---|---|---|
| 9-week periodised program generator | `js/program.js:622-678` (`buildProgram`) | Deterministic, date-anchored to `PROGRAM_START`/`WEEK2_MONDAY`. Regenerated on schema migration 1→2 (`js/app.js:30`) and whenever `ST.program` is missing (`js/app.js:89`). |
| RPE-autoregulated load progression | `js/program.js:680-913` (`nextPrescription` + `PHASE_POLICY`) | Extensively unit-tested (`tools/test-progression.js`, 276 assertions). Per-exercise-variant history via DUP model; taper/race-week/deload/maintenance policies all distinct. |
| In-workout session flow | `js/app.js:1445-1527` (`vSession`) + stepper/RPE/logSet machinery | Weight/rep steppers with tap-to-type (`js/app.js:1614-1661`), RPE picker with a non-blocking "nudge" instead of `alert()` (`js/app.js:1683-1689`), hold timer for time-mode exercises (`js/app.js:291-317`), rest timer with background notification best-effort. |
| Exercise swap with per-variant history | `js/app.js:1735-1750`, `swapExercise` at `js/app.js:396-408` | See §4 for a real data-integrity edge case in this feature. |
| Pre-session movement prep (warm-up) | `js/program.js:301-521` (`PREPS`, `prepRoutine`, `plannedLoads`, `runLoads`) + `js/app.js:1845-1885` | Newest major feature (v24/v25, per `WARMUP_PROMPT.md` and the git log). Fully unit-tested in `tools/test-warmup.js` (1955 assertions, written for this audit's verification pass and confirmed passing against the existing implementation). Dynamic-only by design — a dedicated test asserts no `STRETCHES` entry (static hold) ever leaks into a prep routine. |
| Post-session stretch / post-run cool-down | `js/program.js:221-299` (`stretchRoutine`) + `js/app.js:1776-1908` | Shared timer engine (`startRoutine`/`vStretch`, `js/app.js:1817-1830,2001-2031`) drives both lift-day stretches and run-day cool-downs. Proportional muscle-targeting algorithm is unit-tested (`tools/test-stretch.js`, 471 assertions) against the specific regression it was built to prevent (all-lower-body routine after an upper-body session). |
| Readiness check-in (soreness/fatigue) → guidance | `js/app.js:322-362` (`computeGuidance`), `js/app.js:1315-1374` (`openReadiness`) | Green/amber/red advisory banding relative to the user's own rolling baselines; taper phases cap at amber; red offers an explicit −40%-volume path. |
| Deload radar | `js/app.js:414-447` | Multi-signal (RPE drift, readiness slump, rough runs, sustained HRV/RHR dip) — conservative by design (needs 2+ consecutive signals, never a single bad day). |
| HRV / RHR / VO2max morning check-in | `js/app.js:1037-1139` | Rolling 14-reading baseline with a `.ready` gate at n≥5 (`hrvBaseline`/`rhrBaseline`, `js/app.js:1043-1055`). |
| Run logging (manual) | `js/app.js:662-737` | Distance/time/HR/feel/notes/splits (splits only shown for "Hard Run" days, `js/app.js:688`). |
| Garmin Connect CSV import | `js/app.js:843-921` | Hand-rolled CSV parser handling quoted fields, decimal-comma locales, `h:mm:ss`/`mm:ss` time formats; dedupes by synthetic id `g{date}-{km}`. |
| Strava OAuth + sync | `js/app.js:739-839` | Code is complete and correct-looking (token refresh, 6-hour auto-sync throttle, 8-week activity retention pruning) but per the in-app copy (`js/app.js:2870`) requires a paid Strava subscription since a June 2026 API change — see §2 half-built list. |
| Merged run view (Strava/Garmin as source of truth, manual log fills feel/notes) | `js/app.js:923-978` | `mergedRunFor`/`mergedRunsAll`, with a real perf-driven cache (`activityIndex()`, `js/app.js:941-956`, documented as fixing a measured 56ms render). |
| Race countdowns, race-week checklist, race result logging | `js/app.js:540-573, 1219-1269` | Two hardcoded races (`RACES` in `js/program.js:4-7`) — see §5 for why this is a hard boundary, not an oversight. |
| Maintenance mode (post-block, 3 flexible sessions/week) | `js/app.js:1270-1312` | Includes a distinct guided recovery week (`RECOVERY_WEEK`, `js/program.js:574-580`) before regular maintenance begins. |
| Progress · Log tab (weekly volume/km charts, per-lift history, run log, weekly summaries) | `js/app.js:2226-2301` | |
| Progress · Insights tab (strength trajectory, PR book, aerobic engine, 4 "cause & effect" explorers) | `js/app.js:2767-2812` | Each explorer wraps itself in a `safe()` try/catch (`js/app.js:2769`) so one bad analysis can't take down the tab — a real, deliberate resilience feature. |
| Weekly summary (Sunday review) | `js/app.js:2304-2440` | Auto-offered once per week (`weeklySummaryDue`, `js/app.js:2390-2403`), archived list capped at last 20 (`js/app.js:2430`). |
| PR detection (weight / rep / e1RM) | `js/app.js:2033-2066` | |
| JSON export/import, CSV export | `js/app.js:2903-2945` | Import validates minimally (`s.schemaVersion && s.sessions`, `js/app.js:2939`) then runs the imported data through the same `migrate()` path as normal boot. |
| Schema migration chain (v1→v9) | `js/app.js:27-82` | Sequential, additive-only by stated convention; migration 4→5 takes a pre-migration backup (`js/app.js:38`). |
| Error boundary around every view | `js/app.js:492-501` | A crashing view renders a "Something broke" card with the error message and a truncated stack, instead of a blank/frozen screen. Verified present and reachable — this is a genuine resilience feature, not marketing copy. |
| Modal/sheet a11y (focus trap, Escape, labelling) | `js/app.js:1382-1427` | IIFE watching `#modal`'s class via `MutationObserver`; a documented-and-fixed bug about coalesced observer callbacks losing focus/label on rapid close-then-open sheets (`js/app.js:1396-1399`). |
| Android/browser Back handling | `js/app.js:466-482, 3023-3039` | `history.pushState` per `go()` call plus a `popstate` handler that confirms before leaving an active session. |
| PWA install banner + platform-specific instructions | `js/app.js:2952-2982` | iOS vs Android instructions, `beforeinstallprompt` capture for the native prompt where available. |
| Self-updating service worker with user-visible "tap to reload" banner | `js/app.js:2988-3018`, `sw.js` | |

### 🟡 Half-built, partial, or with a real gap between intent and behaviour

- **Strava integration is fully coded but not really usable.** `js/app.js:739-839` implements OAuth, token refresh, and sync completely and correctly, but the in-app copy at Settings (`js/app.js:2870`) says it "requires a Strava subscription" as of a June 2026 API change, framed as a paid, optional path. For a typical free-tier Strava user this feature is present in the code but non-functional in practice — it's not dead code, but it's not really "working" for its most likely audience either. Garmin CSV import (`js/app.js:843-921`) is the de facto primary run-data path.

- **Notification permission request has no explanatory context**, confirmed still present at `js/app.js:1429-1433` inside `beginSession()` — it fires the instant "Start" is tapped on a lift session, with zero copy explaining what it's for (rest-timer alerts when backgrounded). `UX_REVIEW.md` flagged this (finding #7, referencing an older line number) and it is still true in the current code. This directly touches the "no notification permission ever requested" instinct in the constraints (see §5) — the app does not request notifications *proactively as a feature*, but it does request the OS permission with no framing, which is arguably worse than an explicit ask.

- **Exercise swap mid-session can misattribute already-logged sets.** `swapExercise()` (`js/app.js:396-408`) reassigns `e.exId` to the new variant unconditionally; it only clears the *values* of sets when none are done yet (`js/app.js:406`, `if (!done.length) e.sets.forEach(...)`). But if 1+ sets were already logged against the *original* exercise before swapping, those completed sets stay in the array and get attributed to the *new* `exId` once `e.exId` is reassigned — the code comment itself flags this as a known simplification ("simplest: sets logged before swap stay attributed to new variant only if none done", `js/app.js:405`). The swap button (`.mini.swap`, `js/app.js:1516`) is rendered unconditionally whenever the exercise has any `swaps` entries, with no guard disabling it once sets are logged — so this data-misattribution path is reachable through the normal UI, not just a theoretical edge case. Low real-world frequency (mid-exercise equipment changes are rare) but a genuine correctness bug in the per-variant history that the whole progression engine depends on.

- **`alert()`/`confirm()` inconsistency for import/restore flows**, still present: `js/app.js:916` (Garmin import error), `js/app.js:2897` (backup restore failure), `js/app.js:2941-2942` (JSON import success/failure) all use blocking `alert()`, while the rest of the app has a purpose-built non-blocking `toast()` (`js/app.js:116-128`) used for essentially every other confirmation. `confirm()` for destructive actions (reset, disconnect Strava, clear synced activities) is used consistently and is arguably the right call there — it's specifically the *notification* uses of `alert()` that are inconsistent with the rest of the app's own pattern.

- **Insights tab explorers gracefully degrade to "not enough data yet" placeholders** (`js/app.js:2767-2812`) rather than being broken, but on a fresh install this means the entire Insights segment is a wall of well-written but essentially empty state — `UX_REVIEW.md` finding #14 measured this at ~1,213px of eight stacked placeholders. I did not re-measure pixel heights (no browser available in this session), but the code structure — eight independent cards each rendering its own "keep logging" message when its readiness gate isn't met — is unchanged from what that finding describes, so the underlying issue is still present in principle even if I can't confirm the exact pixel count at v25.

- **Accessibility items flagged in `UX_REVIEW.md` and reverified against the current code as still open:**
  - Only two `<h1>` elements exist anywhere in the app (`js/app.js:1497` in `vSession`, `js/app.js:2016` in `vStretch`) — Today, Plan, Progress, Settings, and Summary render zero heading elements (confirmed by grep; finding #11).
  - `user-scalable=no` is still set (`index.html:5`; finding #17).
  - Several primary tap targets remain non-semantic `<div>`s with `onclick`: `.exlist-row` (`js/app.js:2192,2271,2279`), `.stepval` display-only instances (`js/app.js:684,686,1114`), `.ex-why` (`js/app.js:1512`), `.restbar` (`js/app.js:1527`, though it does now carry `role="timer"` and a `Skip` `<button>` inside it — this one is partially addressed, not a full div-onclick anti-pattern any more). Finding #12.
  - `.toggle` buttons in Settings (`js/app.js:2848-2849`) still render `ON`/`OFF` as their own button label with no `role="switch"`/`aria-checked` — finding #21 still open.
  - Install banner's `✕` dismiss button (`js/app.js:2960`) still has no `aria-label` — finding #20 still open.

  I did not re-verify the *fixed* items from `UX_REVIEW.md` (modal a11y, toast `role="status"`, tab-bar `aria-current`, contrast ratio, reduced-motion, etc.) pixel-for-pixel in a live browser this session, but spot-checked several in source (`role="dialog" aria-modal="true"` on `#modal` in `index.html:18`; `aria-current` logic in `bindNav()`, `js/app.js:522-529`; `prefers-reduced-motion` block in `css/styles.css:363-370`; `--acc-d: #147638` in `css/styles.css:9`, matching the fixed contrast value) and they match what `UX_REVIEW.md` describes as fixed.

### 🔴 Stubbed or effectively dead

- **`tools/gen-icons.js`** is a one-off, manually-run icon generator (zero deps, hand-rolled PNG encoder). It is not wired into any build/deploy step (there is none) and is not referenced from any other file — it exists purely as a script the developer runs by hand when the icon design changes. Not a bug, just worth flagging as tooling that lives outside the app's own execution path.
- I found **no functions that are defined and never called** beyond the above — this is a small, actively-maintained single-file-per-concern codebase, and the `module.exports` list at the bottom of `program.js` (`js/program.js:947-957`) is a reasonably reliable indicator of the "public API" surface, all of which has call sites in `app.js` or the test files.

---

## 3. Data model

Everything below is inferred directly from `defaultState()` (`js/app.js:8-25`), the `MIGRATIONS` map (`js/app.js:27-71`), and the object shapes actually constructed and mutated throughout `js/app.js`. This is what is really persisted to `localStorage['runstrong.db']` today (schema v9), not what any comment or doc claims.

### Top-level state (`ST`)

```
{
  schemaVersion: 9,
  settings: {
    step,            // number — weight increment, one of WEIGHT_STEP_CHOICES [0.5,1,2.5,5]
    sound,           // bool
    vibrate,         // bool
    seenInstall,     // bool — install banner dismissed
    seenWhy,         // bool — "why this plan?" seen (set but I found no read site gating on it — see note below)
    disclaimerSeen,  // bool — readiness-guidance disclaimer shown once
  },
  program: { startDate, weeks: [ Week ] },     // regenerated deterministically, not user-edited
  sessions: { [date]: Session },               // keyed by ISO date string, also session.id
  runs: { [date]: RunLog },
  fitness: { daily: { [date]: {hrv, rhr} }, vo2: { [date]: number }, skipped: date|null },
  strava: { clientId, clientSecret, tokenUrl, auth, activities: { [id]: Activity }, lastSync, includeOther },
  weeklySummaries: [ WeeklySummary ],           // capped at last 20
  races: { geelong: RaceState, melbourne: RaceState },
  maintenance: { active: bool, startedOn: date|null },
  routines: { [date]: { prep?: RoutineLog, stretch?: RoutineLog } },   // added in schema 9
  lastBackup: timestamp|null,
  activeSessionId: date|null,
  timer: { endTs, total, label } | null,        // active rest timer, survives reload
}
```

Note on `settings.seenWhy`: it's set at `js/app.js:2203` when `showWhy()` opens, but I did not find any read site that branches on it (the "Why this plan?" link is always shown unconditionally, `js/app.js:643`). This looks like either dead state or a hook for a future "show automatically until seen" feature that was never wired up — worth flagging as a very small inconsistency, not a bug (it costs nothing, it's just unused).

### `Session` (one lift/recovery workout; keyed by date, also the ID)

```
{
  id, date,                    // == the key
  tpl,                         // template id, e.g. 'lowerA'
  title,
  status,                      // 'active' | 'done'
  downgraded,                  // false | 'light' | 'red'
  phase,                       // PHASE_POLICY key this session was built under, e.g. 'build','taper'
  readiness: { sore, fat } | null,
  guidance: { level, score, reason, message, taperCapped, followed } | null,  // followed: 'full'|'full-anyway'|'lighter', set post-hoc
  stretch: { mins, stretches, completed } | null,
  exercises: [ ExerciseInSession ],
  curIdx,                      // index into exercises — where you are in the session
  startedTs, finishedTs,
}
```

`ExerciseInSession`:
```
{
  exId,               // current variant (may differ from origExId after a swap)
  origExId,           // the exercise this slot started as (drives the swap-options list)
  tplSets, tplReps,
  prescWeight, prescPhase, prescWarn, prescReason,   // output of nextPrescription() at session-build time
  sets: [ Set ],
  // NOTE: after an in-session swap, already-logged Set entries keep their original
  // values but become attributed to the NEW exId once e.exId is reassigned — see
  // the data-integrity gap in §2/§4 (js/app.js:396-408).
}
```

`Set`:
```
{ weight: number|null, reps: number|null, rpe: number|null, note: string, done: bool, failed: bool, ts: timestamp|null }
```
`weight` is `null` for bodyweight (`mode:'bw'`) exercises unless a bodyweight offset is logged; `reps` doubles as seconds for `mode:'time'` and metres for `mode:'carry'` exercises (unit is inferred from `EXERCISES[exId].mode`, never stored per-set).

### `RunLog` (`ST.runs[date]`)

Two shapes coexist under the same key depending on how the run was entered:
```
// manual entry:
{ km, min, feel: 'good'|'ok'|'rough'|null, note, hr: number|null, splits: [seconds], fromStrava?: bool }
// or skipped:
{ skipped: true }
```
Splits are only collected for days classified as a "Hard Run" (`isHardRun()`, `js/app.js:660`). When a Strava/Garmin activity exists for the same date, `mergedRunFor()` (`js/app.js:957-963`) synthesizes a third, read-only shape at render time — distance/time/HR come from the synced `Activity`, `feel`/`note`/`splits` come from `ST.runs[date]` if present — but that merged object is never itself persisted; it's recomputed every render (with a per-render cache, `js/app.js:969-978`).

### `Activity` (`ST.strava.activities[id]`, from either Strava sync or Garmin CSV import)

```
{ id, name, type, date, km, movingMin, elevM, avgHr: number|null, effort: number|null, src?: 'garmin' }
```
`src` is absent (implicitly `'strava'`, rendered via `sr.src || 'strava'` in several places) for API-synced entries and `'garmin'` for CSV-imported ones. Pruned to the last 8 weeks on every sync/import (`js/app.js:828-829, 904-905`).

### `RaceState` (`ST.races[key]`, key ∈ `{geelong, melbourne}`)

```
{ checklist: { [checklistItemIndex]: bool }, result: 'h:mm'|'h:mm:ss'|null, feel: 'strong'|'mixed'|'rough'|null, note, projAtRace: string|null }
```
`checklist` is keyed by the *index* into the module-level `RACE_CHECKLIST` array (`js/program.js:564-573`), not by a stable item ID — reordering or inserting an item in that array in a future change would silently reassign existing users' checked/unchecked state to the wrong items. Worth flagging as a fragility (see §4).

### `RoutineLog` (`ST.routines[date].prep` / `.stretch`, schema v9+)

```
{ mins, items: number, completed: bool, ts: timestamp }
```
Deliberately not nested under `ST.runs[date]`, because `saveRun()` replaces that object wholesale (`js/app.js:722`) — a flag stored there would be silently lost the moment a run was logged. This is a genuinely well-reasoned piece of the schema design (the comment at `js/app.js:1846-1848` explains it directly).

### `WeeklySummary` (`ST.weeklySummaries[]`, built by `buildWeeklySummary()`, `js/app.js:2304-2382`)

A denormalized snapshot computed once and archived — not recomputed from raw data after archiving. Fields: `weekOf, phase, nextPhase, nextFocus, raceWeeks, sessionsDone, planned, improvements: [string], prs: [string], hrvPts: [number], hrvAvg, hrvBase, soreAvg, fatAvg, readLine, runKm, tonnes, note, insight`.

### Program-generation data (not user data — regenerated, not persisted separately)

`EXERCISES` (`js/program.js:27-87`, ~54 entries) — static exercise library merged with `INSIGHTS` (`js/program.js:97-152`) at module load (`js/program.js:153`). Each entry: `{ name, group: 'lower'|'upper', mode: 'reps'|'time'|'carry'|'bw', perSide?, rest, rpe: [lo,hi]|null, wu?: 'bar'|'bw'|'machine', swaps: [exId], cue, why, deep, taperWhy? }`.

`MUSCLE_MAP` (`js/program.js:163-181`) — `exId → muscle[]`, tags from a fixed vocabulary of 10 (`quads glutes hams calves adductors hipflex chest back shoulders core`).

`STRETCHES` (23 entries, `js/program.js:191-219`) and `PREPS` (25 entries, `js/program.js:350-379`, merged with `PREP_INSIGHTS` at `js/program.js:416`) — the static post-session and pre-session movement libraries respectively, each `{ id, name, muscles, perSide, hold|work, instr, why?, deep? }`.

`TEMPLATES` (`js/program.js:524-561`, 20 named session templates) and `RACES` (2 hardcoded entries, `js/program.js:4-7`).

---

## 4. Gaps and rough edges

**Error handling** is better than average for a solo project (the view-level error boundary at `js/app.js:492-501` is real and reachable) but is uneven elsewhere:
- Network failures for Strava (`js/app.js:835-837`) and Garmin import (`js/app.js:916`) are caught and surfaced, but via `alert()` in the Garmin case and `toast()` in the Strava case — inconsistent (see §2).
- `localStorage.setItem` in `save()` (`js/app.js:108`) is **not** wrapped in try/catch, unlike `loadState()` (`js/app.js:85-95`) which is. If storage is full or blocked (private browsing on some browsers, quota exceeded after months of Strava activity caching), a `save()` call will throw uncaught, which — given `save()` is called from nearly every mutating handler — could surface as an unhandled exception rather than a graceful message. I did not reproduce this (would require actually filling storage), but it's a real asymmetry in the code as written.
- JSON import validation is minimal: `if (!s.schemaVersion || !s.sessions) throw new Error('not a RunStrong backup')` (`js/app.js:2939`) — a file with those two keys present but garbage inside them would pass this check and get run through `migrate()`, with unpredictable results depending on what's malformed.

**Tests exist and pass, but cover only the pure logic layer.** `tools/test-progression.js` (276 assertions), `tools/test-stretch.js` (471 assertions), and `tools/test-warmup.js` (1955 assertions, verified passing this session) exercise `js/program.js` exhaustively and are genuinely rigorous — matrix coverage across every phase × RPE-delta combination, every template × budget combination, degenerate inputs (empty loads, zero budget, null opts). **None of the three touch `js/app.js` at all.** There is no test coverage for: state migrations, `localStorage` persistence, the render functions, any DOM/event-handler behaviour, the Strava/Garmin integration logic, or the deload radar / weekly-summary / insights analysis functions in `js/app.js`. `tools/serve.js` is a manual dev server for browser-driven testing, not automated. This means the entire imperative half of the app — everything in `js/app.js` — is verified only by manual use.

**Performance:** the codebase shows evidence of *active* performance work rather than neglect — several comments document specific measured regressions and their fixes (e.g. `fmtDate` memoization after profiling found 45ms of an 82ms render, `js/program.js:600-606`; the `exHistoryIndex()` cache after finding it was "the single most expensive thing in the app", `js/app.js:152-164`; the `activityIndex()` cache after measuring 56ms/7.7ms costs, `js/app.js:924-939`). The remaining risk is architectural rather than a specific bug: `render()` does a full `innerHTML` replace of the whole app on every state change (`js/app.js:493`), so cost scales with total DOM size of whichever view is showing, not with what changed. For a single-user app with bounded data (~9 weeks of program, capped activity cache, capped weekly-summary archive) this has apparently not become a problem in practice, but it's a ceiling worth knowing about before adding a view with substantially more DOM (e.g. a full year of daily entries rendered as rows).

**Accessibility:** see the detailed list in §2's half-built section — several `UX_REVIEW.md` findings (non-semantic `<div>` tap targets, missing `<h1>`s on 5 of 7 main views, `user-scalable=no`, un-labelled toggle switches, un-labelled install-banner dismiss button) were re-verified against the current code and are still open. Color usage was not re-measured for contrast this session (no browser environment available), but the token values in `css/styles.css:4-12` match what `UX_REVIEW.md` describes as already fixed (`--acc-d: #147638`), so I have no reason to doubt the previously-measured 4.85:1 ratio still holds, just no independent re-measurement.

**Fragile / band-aid patterns worth knowing about before extending:**
- The `RACE_CHECKLIST` array (`js/program.js:564-573`) is indexed positionally into `ST.races[key].checklist`. Any future edit to that array's order or length will silently corrupt existing users' checked-state (§3).
- `swapExercise()`'s known simplification around already-logged sets (§2, §3) — a real correctness gap in a feature (per-exercise-variant history) the whole progression engine depends on.
- `phaseKeyFromLabel()` (`js/program.js:772-782`) maps free-text phase-label strings (constructed in `buildProgram()`, `js/program.js:622-678`, e.g. `'Build — peak load'`, `'Geelong mini-taper'`) back to policy keys via regex substring matching. This is a stringly-typed coupling between two functions that must be kept in sync by convention — the test suite does guard it (`tools/test-progression.js:172-187`, "every week the program generates must resolve to a real policy"), which meaningfully de-risks it, but a new phase label added to `buildProgram()` without a corresponding regex branch would silently fall through to `'build'` rather than erroring.
- `APP_VERSION` (`js/app.js:114`) and `sw.js`'s `CACHE` string (`sw.js:2`) must be bumped together by convention/comment discipline (`js/app.js:114`: "keep in step with the sw.js CACHE bump each deploy") — there is no automated check that they match, and a missed bump would mean the service worker keeps serving stale JS after a deploy.
- `ST.settings.seenWhy` is written but (as far as I can find) never read — likely inert state left over from a removed or never-finished conditional-display feature (§3).

**Notification permission timing** (§2) is the one item explicitly flagged in `UX_REVIEW.md` as unfixed (Medium #7) that I independently reverified as still true in the current code — it's a real, small UX rough edge, not a stale claim.

---

## 5. Constraints any new feature must live within

These are inferred from consistent patterns across the whole codebase, not stated in a single design doc (there isn't one) — but they are consistent enough, and reinforced explicitly enough in code comments and the `WARMUP_PROMPT.md`/`UX_REVIEW_PROMPT.md` task briefs, that I'm confident treating them as real boundaries rather than incidental choices.

1. **No backend, no build step, no dependencies.** Everything is two hand-written classic-script files (`program.js`, `app.js`) plus a stylesheet, loaded directly by `index.html` with no bundler, transpiler, or package manager anywhere in the repo. `program.js`'s only concession to tooling is the `module.exports` guard so Node can `require()` it for tests (`js/program.js:947-957`) — that guard is written to be a no-op in the browser, preserving "plain classic script" status. Any new feature should assume this stays true: no npm install, no `<script type="module">` split unless the whole app moves to it deliberately.

2. **All state is client-side and local to one device.** `localStorage` is the only persistence layer; there is no server, no sync-across-devices story, and no accounts. The Settings footer says it outright: "all data stays on this device" (`js/app.js:2887`). Any new feature that stores data must go through `ST` + `save()`, follow the existing additive-migration convention (`MIGRATIONS`, `js/app.js:27-71`), and must not assume data exists anywhere but the one browser it was created in. The only two exceptions — Strava and Garmin CSV — are both explicitly *importing external data in*, never *exporting the user's training data out* to a third party service the app controls.

3. **Offline-first is load-bearing, not aspirational.** The service worker precaches everything needed to run with zero network (`sw.js:3-12`), and `UX_REVIEW.md` independently verified this by killing the dev server and confirming all four tabs still worked with data intact. Any new feature must not introduce a hard dependency on a network call for core functionality — Strava/Garmin sync is correctly modelled as optional enrichment that degrades gracefully offline (`sw.js:34` explicitly lets Strava calls bypass the cache rather than trying to make them work offline, which is the right call for a genuinely online-only feature).

4. **Pure logic lives in `program.js`; state/DOM/timers live in `app.js`.** This separation is deliberate and enforced by the fact that `program.js` has zero references to `document`, `window`, `localStorage`, or `ST` anywhere in it (verified — it's pure functions and static data), which is exactly what makes it possible to unit-test with a dependency-free Node script. `WARMUP_PROMPT.md` states this split as an explicit instruction for the last major feature added ("Vanilla JS. No dependencies, no build step. Pure logic in `program.js`, views in `app.js`.") and the resulting code (`PREPS`/`prepRoutine` in `program.js`, `startLiftPrep`/`startRunPrep` in `app.js`) follows it exactly. A new feature with any nontrivial logic should follow the same split so it stays testable the same way.

5. **No notification permission is requested as a standalone ask** — it's requested opportunistically inline with starting a workout (`js/app.js:1429-1433`), not via a dedicated "enable notifications" flow, and the app's only use of it is a best-effort background rest-timer alert. There's no evidence anywhere in the code of push notifications, marketing notifications, or any notification use beyond that one narrow case. A new feature should not add a second, separate permission-request flow without addressing the existing UX gap (no explanatory copy) rather than compounding it.

6. **Every new feature that makes a claim about training benefit is expected to cite evidence and be honest about what it doesn't prove.** This isn't a technical constraint but it's an extremely consistent content pattern: `program.js`'s progression engine (`js/program.js:680-742`) and the warm-up/prep library (`js/program.js:301-339`) both carry numbered literature references with each rule stating which reference it rests on, and `WARMUP_PROMPT.md` explicitly required the post-run stretch copy to avoid overclaiming injury-prevention benefits it doesn't have. Any new feature that makes a physiological or training claim in its UI copy should match this bar — cite what's known, say plainly what isn't.

7. **Two hardcoded races define large parts of the schedule/UI** (`RACES` in `js/program.js:4-7`: Geelong 2026-09-20 as B-race, Melbourne 2026-10-11 as A-race). `buildProgram()` (`js/program.js:622-678`) hand-lays-out each of the 9 weeks' `layouts[]` around these two specific dates, and `ST.races` is keyed literally by `'geelong'`/`'melbourne'` throughout `app.js` (race countdowns, checklists, results, maintenance-mode trigger on Melbourne completion). This is not a generic "N races" system — adding a third race, or reusing this app for a different race calendar, would require editing `program.js`'s program-generation code directly, not just data configuration. Worth treating as a hard architectural boundary rather than a parameter to pass in.

8. **Single active session at a time.** `ST.activeSessionId` is a single scalar, not a list (`js/app.js:22`), and the session UI (`vSession`) assumes exactly one workout in flight. Any feature involving concurrent or overlapping session state would need real redesign, not an additive tweak.

---

## Summary counts

- **~30 features** catalogued in §2 (24 fully working, 6 with a genuine partial/half-built or reverified-still-open gap, 1 piece of unused tooling).
- **9 top-level state entities** in the persisted schema (`settings`, `program`, `sessions`/`Session`/`ExerciseInSession`/`Set`, `runs`, `fitness`, `strava`/`Activity`, `weeklySummaries`, `races`, `maintenance`, `routines`), plus 5 program-generation data structures (`EXERCISES`, `MUSCLE_MAP`, `STRETCHES`, `PREPS`, `TEMPLATES`) that are static/regenerated rather than user data.
- All three test suites (`tools/test-progression.js`, `tools/test-stretch.js`, `tools/test-warmup.js`) run clean at audit time: **276 + 471 + 1955 = 2,702 assertions passing**, zero failures.
