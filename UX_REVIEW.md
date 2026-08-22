# RunStrong — UX & UI review

Reviewed at `v21` (schema v8) on 2026-08-22, running locally at 375×812, dark, mobile viewport.

**Method note.** The in-app browser pane could not be displayed, so screenshots were unavailable. Instead of visual capture I measured the rendered DOM directly — element geometry, scroll positions, computed contrast ratios, tap-target sizes — and drove the app through its own handlers (`beginSession`, `logSet`, `startStretch`, `autoPromptRun`) rather than synthetic taps. Every number below is measured, not estimated. The test profile was seeded locally and started empty; your real training data lives on your phone and was never touched.

---

## Verdict

This is a genuinely well-built training app, and unusually thoughtful for a single-user project. The design system is coherent, the empty states are specific rather than blank, offline works perfectly, and there is a real error boundary that keeps you in the app when a view crashes. Several decisions — the one-hero-number exercise header, the RPE nudge that replaced a blocking `alert()`, preserving scroll position when a set is logged — are the kind of thing that only comes from actually using an app in the environment it was built for. The gym context has clearly driven the design.

Two things undercut all of that. First, opening the app does not show you the app: a queue of modal sheets stands between you and the Today screen, one per unlogged run, every single launch — and the fastest way to clear it writes false data. Second, on the screen where you spend the entire workout, the button you press twenty-one times a session sits over 300px below the fold, while the space above it is spent on reference material you read once. Fix the launch path and the session layout and this goes from a good app you work around to one that disappears into the workout.

---

## Status: all ten shortlist items applied (v22 → v23)

The findings below describe the app **as reviewed at v21**. Every item on the prioritised shortlist has since been applied and verified; each is marked ✅ in place.

### v23 — the three structural items

| Item | Change | Measured result |
|---|---|---|
| 1 | `autoPromptRun()` now fires **at most one sheet per launch**, only for today or yesterday. The chaining calls in `saveRun` / `saveStravaFeel` / `skipRun` are gone. Anything older is a passive "N runs not logged" card on Today | Cold start with 4 unlogged runs: **5 sheets → 2** (check-in + one recent run), then Today. The other 3 became a card |
| 2 | Session screen reordered: the current-set panel now sits directly under the hero, with *last time / cue / why / swap / pending sets* moved below it into `.ex-ref`. Inside the panel, **Log** moved above the optional note field | **Log button 1124 → 691** (bottom edge 752). Fully above the fold at 375×812, first set and steady state |
| 8 | `go()` pushes history state; `popstate` walks back through views. Leaving an active workout confirms first | Back navigates progress → schedule → home. In-session Back prompts; declining stays put, accepting leaves with the session saved and resumable |

Plus a short-viewport density pass (`@media (max-height: 700px)`) for iPhone-SE-class screens, where the reorder alone left the Log button 85px short: **85px → 25px**, with no touch target dropping below 44px.

### v22 — the seven S-effort items

| Item | Change | Verified |
|---|---|---|
| 3 | Unset weight renders as a dashed "tap to set" field, `role="button"`, 58px tall; tapping opens an empty numeric input rather than seeding `0` | ✅ |
| 4 | Rest bar surface now adds +30s; skip is an explicit 52×44 button; bar is `role="timer"` | ✅ |
| 5 | `.backbtn` 30×53 → **48×53** | ✅ |
| 6 | `#modal` is `role="dialog" aria-modal="true"`, labelled from its `<h2>`, focus moves to the sheet, focus trapped on Tab, Escape closes | ✅ |
| 7 | `toast()` is `role="status"`; off-screen `#live` region announces rest-done; `#flash` is `aria-hidden`; tab bar has `aria-current` **and** an inset rule so active state isn't colour-only | ✅ |
| 9 | Entering Plan scrolls the current week to the top (measured: `scrollY` 422, week top at 12px) | ✅ |
| 10 | `--acc-d` `#16843f` → `#147638`, lifting the primary button from **4.05:1 → 4.85:1** | ✅ |

Regression at v23: all views render, both test suites pass (276 + 471 assertions), console clean, full session → stretch → summary loop works, and **offline verified again with the server stopped** — all four tabs, data intact. `APP_VERSION` and the `sw.js` cache are bumped together.

Three things worth knowing:

- **Item 2 is not fully solved on the smallest phones.** At 375×812 the Log button clears the fold outright. At 375×667 it's still **25px short** after the density pass — most of the button is visible, but the last sliver needs a nudge. Closing it completely would mean either shrinking RPE buttons below 44px or cutting the warm-up ramp, and neither trade is worth it.
- **Item 1 changes what "skip" means.** Because the queue no longer chains, "I didn't do this run" is now a deliberate choice rather than the fastest way through a stack of sheets. The backlog card is ignorable by design — if you want the app to nag harder about old runs, that's a different decision.

- **A bug in the first cut of item 6.** `MutationObserver` callbacks coalesce, so a close-then-open in a single task — exactly what `autoPromptRun()` does when chaining run sheets — left the new sheet carrying the previous sheet's `aria-label` and never gave it focus. The observer now keys off the `.sheet` element rather than the class edge. Caught and fixed during verification.
- **The only sub-44 target left app-wide** is the install banner's `✕` at 37×44 (finding #20). It's outside the agreed batch, so it stands.

---

## Critical

### 1. Cold start buries the app behind a queue of modal sheets
✅ **Fixed in v23.** **Screen:** Today · [`js/app.js:1040`](js/app.js:1040) (`autoPromptRun`), [`js/app.js:946`](js/app.js:946) (`checkInDue`), [`js/app.js:987`](js/app.js:987), [`js/app.js:992`](js/app.js:992)

Measured on a fresh open with four unlogged run days behind it, the app presented **five sheets in a row** before the Today screen was reachable:

```
Morning check-in → Easy Run Aug 14 → Long Run Aug 16 → Hard Run Aug 19 → Easy Run Aug 21 → Today
```

`saveCheckIn` and `skipCheckIn` both end by calling `autoPromptRun()`; `saveRun` and `skipRun` do the same. Each dismissal therefore summons the next sheet. `autoPromptRun` scans *every* program day for unlogged runs with no lower bound, so the queue grows one sheet per missed run and never ages out.

There is an escape — `Cancel` calls `closeModal()` alone and breaks the chain — but it records nothing, so the identical stack returns on the next launch. The two prominent buttons both continue the chain, and the one that clears an item fastest is **"I didn't do this run"**, which writes `{skipped: true}`. The path of least resistance actively falsifies the training log.

**Why it matters in the gym:** You open the app standing at the rack. You want one thing: today's workout. Instead you dismiss five sheets about runs from last week. After a holiday or an injury week this is worse, not better.

**Fix:** Bound the queue to *one* prompt per launch, and only for yesterday and today. Move older unlogged runs to a passive, dismissible "3 runs need logging →" row on Today that deep-links into the Plan tab. Never chain a sheet to another sheet. If the chain stays, `skipRun` needs to be visibly distinct from "not now" — right now they are the same tap weight.

---

## High

### 2. The button you press 21 times a session is 300px below the fold
✅ **Fixed in v23.** **Screen:** Session · [`js/app.js:1259`](js/app.js:1259)–[`1262`](js/app.js:1262)

Measured at 375×812, steady state (set 2 of 5, no first-run copy), page height 1474px:

| Element | Y position | Visible on load? |
|---|---|---|
| Exercise name | 111 | ✅ |
| Hero number | 179 | ✅ |
| Pending set list | 476 | ✅ |
| Current set card starts | 685 | ✅ (top edge only) |
| **RPE row** | **952** | ❌ 140px below fold |
| **✓ Log set** | **1124** | ❌ **312px below fold** |

The first-time layout is worse (Log set at 1152, ramp card and warnings added). On an iPhone SE at 375×667 add another 145px of deficit.

Above the fold sits: the hero number, the prescription reason, the warm-up ramp, the "Last time" line, a form cue, the "Why this helps your half" expander, the swap button, and a list of pending sets rendered as rows. Almost all of it is read once per exercise. Below the fold sits everything you touch on every set.

`render()` correctly preserves `scrollY` for the session view, so you don't get bounced after logging — the scroll cost is paid once per exercise rather than per set. But you still start every exercise scrolled wrong.

**Why it matters in the gym:** Phone on the bench, 90 seconds of rest, sweaty hands. The action is never where your thumb already is.

**Fix:** The highest-leverage change in the app. Either (a) make the current-set panel sticky to the bottom of the viewport so weight/reps/RPE/Log are always in the thumb zone, with the reference material scrolling behind it, or (b) collapse the pending-set list to a single line (`3 of 5 left`) and move ramp/cue/why behind the existing `.ex-why` disclosure pattern. Option (a) is the real fix.

### 3. Mid-workout, the only way out is a 30px chevron in the top-left corner
✅ **Fixed in v22.** **Screen:** Session · [`js/app.js:1265`](js/app.js:1265)

`vSession()` deliberately omits `navBar()`, so the tab bar is gone during a workout. The sole exit is `.backbtn` — measured **30×53px**, below the 44px minimum on the width axis, and positioned in the top-left, the hardest point to reach one-handed on a 375px-wide phone.

It does carry `aria-label="Back to Today"` — the labelling is right, the size and placement aren't.

**Why it matters:** Checking the plan or a past lift mid-session means a precise stretch to the far corner. Miss it and you hit the progress bar, which does nothing.

**Fix:** Widen to ≥44px and add horizontal padding. Consider a persistent bottom-anchored "Today" affordance during sessions rather than relying on the corner.

### 4. The entire rest bar is a "skip rest" target, with no undo
✅ **Fixed in v22.** **Screen:** Session · [`js/app.js:1297`](js/app.js:1297)

The rest bar is a fixed, full-width, **73px-tall** element whose *entire surface* carries `onclick="skipRest()"`. It contains no buttons — only the text "tap to skip". `skipRest()` clears the timer immediately: no confirmation, no undo, no way to add time back.

It is anchored to the bottom of the viewport, which is exactly where you scroll to reach the Log set button (finding #2). While rest runs, the bottom 73px of scrollable content sits underneath a destructive full-bleed target.

**Why it matters:** One sloppy thumb near the bottom edge silently ends your rest period. Between heavy sets that's a real training cost, and there's no way to tell it happened except the bar vanishing.

**Fix:** Make skip an explicit ≥44px button inside the bar. Give the rest of the bar a `+30s` action instead — extending rest is the more common need. At minimum, make skip recoverable.

### 5. First time on a lift, the weight stepper starts at 0
✅ **Fixed in v22.** **Screen:** Session · [`js/app.js:1240`](js/app.js:1240), [`js/app.js:1385`](js/app.js:1385)

With no history, `prescWeight` is `null`, so the seed falls through to `0`. With the (correct, evidence-based) 1kg default increment, dialling in a 40kg overhead press is **40 taps on `+`**.

Tap-to-type exists and works well, but it's advertised as dim 400-weight small print appended to the field label — `Weight (kg) · tap number to type` — and the number itself has no affordance suggesting it's editable.

The hero also reads `—  kg × 5 @ RPE 7 · pick a starting weight below` and, measured after logging a real 40kg set, **still reads `—`** for the rest of that first session. The one number designed to be readable from the floor is blank exactly when you're least sure what to lift.

**Why it matters:** This is every exercise's first session — five lifts on day one, and again whenever you swap in a variant.

**Fix:** Seed from the same-session previous set (the logic at `js/app.js:1240` already does this for set 2+ — it's only set 1 of a first-ever exercise that starts at 0). Make the stepper value look like an input. Once a set is logged, let the hero show that weight instead of `—`.

### 6. The Android back button exits the app mid-workout
✅ **Fixed in v23.** **Screen:** All · no `popstate` handling anywhere in `js/app.js`

Navigation is pure JS state (`view = {name}` + `render()`), with no `history.pushState` and no `popstate` listener. In an installed PWA on Android, the hardware Back button therefore has nothing to pop and leaves the app.

Session state is saved continuously, so nothing is lost and the workout resumes — but the app vanishing mid-set is alarming and costs a relaunch (which then lands you in the modal queue from finding #1).

**Fix:** Push a history entry in `go()` and handle `popstate` to walk back through views. Guard the session view so Back asks before leaving a workout.

---

## Medium

### 7. Notification permission is requested at the worst possible moment
[`js/app.js:1207`](js/app.js:1207) — `beginSession()` fires `Notification.requestPermission()` the instant you tap Start, with no explanation. The user is mid-flow, about to lift, and gets an OS dialog whose purpose (rest-timer alerts when the app is backgrounded) is never stated. A denial is permanent and silently disables `scheduleBgNotify` forever. Ask after the first rest timer completes, with one line of context.

### 8. The active tab is indicated by colour alone ✅ *(fixed in v22)*
`.tabbar button.active { color: var(--acc) }` is the only differentiator — no weight change, no indicator, no `aria-current`. Fails WCAG 1.4.1 and is genuinely harder to read at a glance in a dark gym. Add a top rule or a filled icon state, plus `aria-current="page"`.

### 9. Nothing is announced to a screen reader ✅ *(fixed in v22)*
Zero `aria-live` regions in the app. The rest countdown, the session elapsed clock, and every `toast()` message are visually-only. `toast()` ([`js/app.js:96`](js/app.js:96)) creates a bare `div` with no `role="status"`, so every confirmation in the app — set logged, run saved, backup restored — is silent. One `role="status"` on the toast element and `aria-live="polite"` on the timer covers most of it.

### 10. The modal is not a dialog ✅ *(fixed in v22)*
`#modal` has no `role="dialog"`, no `aria-modal`, no focus trap, and no Escape handler (the only `keydown` listener in the app is the Enter-to-commit on tap-to-type). Focus stays on whatever was behind the sheet. Given how much of this app runs through sheets — readiness, check-in, run log, swap, next-exercise, race kit — this is the single highest-value a11y fix.

### 11. No page has an `<h1>` except the session screen
Today, Plan, Progress, Settings and Summary render **zero** heading elements. `.phase` and `.card-title` are styled `div`s. Document structure is invisible to assistive tech and to any future "jump to content" affordance.

### 12. Several primary tap targets are non-semantic `div`s
Measured: `.exlist-row` (every lift row in Progress, both race-kit rows), `.card.action` (the Resume-workout card on Today), `.stepval`, `.restbar`, `.ex-why`. None are focusable or announced as interactive. Most are already sized correctly — they just need to be `<button>`s.

### 13. The Plan tab is 3,264px with no auto-scroll to the current week ✅ *(fixed in v22)*
[`js/app.js:1817`](js/app.js:1817) renders all nine weeks flat, and `go()` always resets scroll to 0. The current week gets an accent border but you land on Week 1. It's mild now (you're in Week 2) and gets progressively worse — by Week 8 finding today means scrolling ~2,500px. Scroll `.wk.cur` into view on entry, or collapse past weeks.

### 14. On a fresh install, the Insights segment is entirely placeholders
Measured 1,213px of eight stacked "not yet" modules: Insight of the week, Strength trajectory, PR book, Aerobic engine, and four Cause & Effect cards, all variations of "keep logging". The individual messages are good — specific and quantified ("Needs 6 more runs with heart rate, have 0"). Eight of them in a column is a wall. Show one summary card until at least one module has real data.

### 15. The primary button misses 4.5:1 ✅ *(fixed in v22)*
`--fg` (#e8edf4) on `--acc-d` (#16843f) = **4.05:1**. `.btn.primary.big` at 1.1rem/18.7px bold clears the large-text threshold, but plain `.btn.primary` at 1rem/17px bold does not. Darkening `--acc-d` slightly or lightening the label fixes the most-pressed button in the app.

Worth stating plainly: **the rest of the palette is fine.** `--dim` (#8b96a5), which I expected to fail, measures 6.31 / 5.70 / 5.02 on `--bg` / `--bg2` / `--bg3` — comfortably over 4.5:1 everywhere it's used. `--run` 6.73, `--red` 6.18, `--warn` 7.55, `--gold` 10.24, `--acc` 9.81. No changes needed.

### 16. Empty charts render as zero-bars while empty lists get real messages
In Progress · Log with no data, the weekly-km chart renders nine unlabelled columns and the lifting-volume chart renders nine `0.0` bars — but the lift list below correctly says "No workouts logged yet. Charts appear here after your first session." Same screen, two different empty-state philosophies. Give the charts the list's treatment.

### 17. `user-scalable=no` blocks pinch-zoom app-wide
`index.html:5`. The intent is clear and defensible — `touch-action: manipulation` is already applied to buttons and set rows to stop double-tap zoom nudging the page mid-set, which is the actual problem being solved. But the meta-tag is the blunt version and it removes zoom everywhere, including the dense Progress charts and the Settings text. The `touch-action` rules do the real work; consider dropping `user-scalable=no` and keeping them.

### 18. No `prefers-reduced-motion` support
`#flash` is a **full-viewport bright-green overlay that pulses three times** when rest ends, plus the `nudge` keyframes on the RPE row and several transitions. Nothing is guarded. The flash is a deliberate, well-judged design decision — it needs to be visible from the floor — but a `@media (prefers-reduced-motion: reduce)` block that swaps the pulse for a static fill would keep the function and drop the vestibular risk.

### 19. `alert()` for import, toast for everything else
[`js/app.js:2596`](js/app.js:2596) uses `alert('Import complete ✓')` and `alert('Import failed: ...')`, while the rest of the app has a well-built toast system. Native `confirm()` for destructive actions is right and consistent — it's specifically the success/failure *notifications* that break the pattern.

### 20. Install banner dismiss is 36px
`.mini.dim ✕` measured 36×44 — the only sub-44 target outside the session screen. It's also `✕` with no `aria-label`.

### 21. Toggles are buttons labelled with their state
`.toggle` renders `ON`/`OFF` as its own label, so it's ambiguous whether the text is the current state or the action. Colour disambiguates it, which brings back finding #8's problem. `role="switch"` + `aria-checked` fixes both the ambiguity and the a11y gap.

---

## Low

- **The hero stays `—` after you've logged sets** on a first-time lift (see #5). It's the one number meant to carry the screen.
- **Naming collisions:** the tab is "Plan", the button on it is "Why this plan?", and the data object is `program`. "Progress" contains segments called "Log" and "Insights" while Today has a "Deload radar" — four different vocabularies for looking at your own data.
- **Session header metrics are 0.78rem** (`.prog-txt`): `12/21 sets · ~34 min left · ⏱ 8:42`. Three useful numbers rendered at the smallest size on a screen you read at arm's length.
- **`moveEx()` preserves scroll position**, so tapping "Next ›" while scrolled to the Log button lands you mid-card on the next exercise, past its hero number. Correct behaviour for logging, wrong for exercise changes.
- **`.mini` buttons are 44px tall but visually ~26px** (padding does the work). The hit target is right; the visual affordance undersells it.

---

## What's working

These are specific decisions worth protecting from future refactors.

- **Offline is genuinely complete.** Verified by stopping the server and reloading: all four tabs rendered, all data intact, no degradation. The cache-first service worker plus `localStorage` does exactly what a gym app needs.
- **Empty states are quantified, not blank.** "Log 2 more morning check-ins to see the HRV chart." "Needs at least 3 lift sessions in each bucket — after a 10 km+ run: 0, other days: 0." Almost every module tells you precisely what unlocks it. This is better than most commercial apps.
- **The error boundary is a real screen.** Forced a synthetic crash in `vProgress`: it kept the tab bar, made the error text selectable (`-webkit-user-select: text` deliberately re-enabled against the global `none`), explained that data was safe, and offered a route home. Most apps freeze.
- **The stretch screen is the best-designed screen in the app.** Measured 812px in an 812px viewport — the only screen that fits exactly, with zero scroll. 77px countdown, 60px buttons, one instruction centred. Build the session screen like this.
- **Touch targets are almost universally honoured.** The 44px comment in `styles.css` is not aspirational: across every view, only two elements miss it (`.backbtn` at 30px wide, `.mini.dim ✕` at 36px). `.linkbtn` and `.mini` really do get the height despite looking secondary.
- **Long content degrades cleanly.** A 62-character exercise name wrapped to three lines with no horizontal overflow and pushed the layout down by only 71px.
- **Destructive actions are proportionally gated.** `resetAll()` requires two confirmations; Strava disconnect, maintenance switch, and clearing synced activities each confirm once and each explains what is *not* affected. The danger zone is isolated at the bottom of Settings.
- **`keepScroll` on set logging** ([`js/app.js:406`](js/app.js:406)) — logging a set doesn't move the page. Exactly right, and clearly learned the hard way.
- **The RPE nudge replaced a blocking `alert()`** ([`js/app.js:1447`](js/app.js:1447)) — toast + flash the row + scroll it into view + haptic, instead of a dialog costing an extra tap. The code comment explains the reasoning. This is the right instinct throughout.
- **Migrations write a pre-migration backup** to a separate key before the v4→v5 schema change, recoverable and downloadable from Settings.
- **Guidance is framed against personal baselines, never absolutes**, capped at amber during taper, with "rest is a completely fine choice" in the red message. The tone is right.

---

## Prioritised shortlist

| # | Change | Impact | Effort |
|---|---|---|---|
| 1 | Cap the launch modal queue at one sheet; move the backlog to a passive Today row | Removes the worst friction in the app, every single launch | **M** |
| 2 | Make the current-set panel sticky to the bottom of the session viewport | Fixes the 312px scroll deficit on the app's core action | **M** |
| 3 | Seed set 1 of a first-ever exercise from history/prescription; make `.stepval` look editable | Kills a 40-tap first-run cost | **S** |
| 4 | Give the rest bar a real skip button; make the bar surface `+30s` | Stops accidental irreversible rest cancellation | **S** |
| 5 | Widen `.backbtn` to ≥44px | Only mid-workout exit, currently 30px in the worst corner | **S** |
| 6 | `role="dialog"` + `aria-modal` + focus trap + Escape on `#modal` | Highest-value a11y fix; the app is sheet-driven | **S** |
| 7 | `role="status"` on toast, `aria-live` on rest timer, `aria-current` on tab bar | Makes all feedback perceivable; fixes colour-only tab state | **S** |
| 8 | Add `popstate` handling so Android Back navigates instead of exiting | Stops the app vanishing mid-workout | **M** |
| 9 | Scroll `.wk.cur` into view on entering Plan | Cheap fix that gets more valuable every week of the block | **S** |
| 10 | Darken `--acc-d` to clear 4.5:1 behind `--fg` | The most-pressed button in the app | **S** |

Items 3–7, 9 and 10 are all **S** and together address one Critical-adjacent issue, two High findings and five Medium ones — that's the efficient first pass. Items 1, 2 and 8 are the structural work worth doing deliberately.
