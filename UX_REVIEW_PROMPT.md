# Prompt: Complete UX & UI review of RunStrong

Paste everything below the line into a fresh Claude Code session started in `C:\Users\rothd\runstrong`.

---

You are doing a **complete UX and UI review of RunStrong**, a personal PWA at `C:\Users\rothd\runstrong`. Review only — **do not change any code, CSS, or content.** The deliverable is a findings report, not a patch.

## What the app is

RunStrong is a single-user, offline-first strength-training PWA supporting half-marathon prep for two races: Geelong Half (B race, 2026-09-20) and Melbourne Half (A race, 2026-10-11). No build step, no framework, no backend. Vanilla JS, string-template rendering, `localStorage` for all state.

- `index.html` — shell: `#app`, `#modal`, `#flash`
- `js/app.js` (~2700 lines) — state, migrations, timers, progression logic, and every view
- `js/program.js` (~700 lines) — program, exercise, and race data
- `css/styles.css` (~320 lines) — the whole design system, tokens in `:root`
- `sw.js`, `manifest.json`, `fresh.html` — PWA plumbing and a force-update escape hatch
- `tools/serve.js` — static dev server

Views, all rendered by `render()` in `js/app.js`: `vHome` (Today), `vSchedule` (Plan), `vSession` (active workout), `vStretch`, `vSummary`, `vProgress`, `vExDetail`, `vFitness`, `vSettings`. Bottom tab bar has four tabs: Today, Plan, Progress, Settings.

## The usage context that decides every judgement

This is not a desktop app and it is not used calmly. Judge every screen against how it is actually used:

- **One phone, one hand, portrait, installed to the home screen.** The phone is often on the gym floor or a bench, tapped by someone standing over it.
- **Mid-workout**, out of breath, sweaty hands, often between sets with a rest timer running.
- **Glanceable at arm's length** — the next thing to do should be readable without picking the phone up.
- **Dark gym lighting**, sometimes bright outdoor light for runs.
- **Offline is normal.** Gyms have no signal.
- One user, months of accumulated data, ~5 sessions a week through a training block.

A finding that is technically correct but irrelevant to that context is noise. Say so and drop it.

## How to run it

Start the dev server and drive it in the browser pane at a **mobile viewport** (375×812, dark scheme):

```bash
node tools/serve.js 8317
```

Then open `http://localhost:8317`, resize to mobile, and actually click through. Do not review from source alone — read the code to explain *why* something is wrong, but find the problems by using the app. Screenshot anything you flag visually.

To reach states you cannot reach by clicking, seed `localStorage` under the key `runstrong.db` from the console (`defaultState()` and the `MIGRATIONS` map in `js/app.js` show the shape), then reload. **Snapshot the existing db first and restore it when you are done — that is the user's real training data.**

## States you must exercise, not just the happy path

1. **First run / empty state** — no sessions, no history, no fitness data. Do Progress, Trends, and Exercise Detail degrade gracefully or look broken?
2. **A live session** — start one, log sets, trigger the rest timer, let it run out, skip it, swap an exercise, add a note, finish. Watch scroll position, the elapsed clock, and whether the next action is ever ambiguous.
3. **Stretch flow and Summary** immediately after a session.
4. **Rest timer running while navigating away** and back, and with the app backgrounded.
5. **Race-adjacent states** — taper phase, race week, race day (`d === 0`), an unlogged past race, recovery/deload mode, and maintenance mode (`ST.maintenance.active`, which retires the race clocks).
6. **Long or degenerate data** — a very long exercise name, a 20-exercise session, months of history in the Progress charts, a lift with no valid e1RM.
7. **Offline** — kill the server with the PWA loaded and navigate every tab.
8. **The error view** — `render()` catches view crashes and shows a "Something broke" card. Judge that as a real screen.

## Review dimensions

Cover all of these. Ground every finding in a specific screen and a specific line.

**Information hierarchy & glanceability** — On each screen, what is the single most important thing, and is it the biggest and brightest? Home especially: does it answer "what do I do right now?" in under two seconds? Is there competition between race countdowns, guidance cards, and the primary action?

**Task flow & friction** — Count taps for the core loops: start today's workout, log a set, finish a workout, check whether a lift is progressing. Flag any tap that shouldn't be needed, any dead end with no obvious next step, and any place the user must remember something the app already knows.

**Touch targets & thumb reach** — The CSS claims a 44px minimum everywhere, including `.linkbtn` and `.mini`. Verify that in the rendered DOM, not the stylesheet. Check spacing between adjacent destructive and non-destructive actions, and what falls in the bottom third (easy thumb reach) versus the top corners.

**Visual design & consistency** — Audit against the `:root` tokens. Find hardcoded colors, one-off paddings, and inconsistent card and border treatments. Check that accent colors carry consistent meaning (`--acc` green, `--run` blue, `--gold` A-race, `--red`/`--warn` danger). Check typographic scale, alignment, and vertical rhythm across the ~150 classes.

**Contrast & legibility** — Compute actual contrast ratios for the dark palette, especially `--dim` (#8b96a5) on `--bg2`/`--bg3`, and small text (`.small`, `.race-tag`, `.card-sub`). Flag anything below 4.5:1 for body text or 3:1 for large text. Judge legibility at arm's length, not nose distance.

**Feedback & system status** — Every state change should be visible: set logged, rest started and ended, session saved, data imported, update available. Assess the toast, the flash, vibration, and the chime as one coherent feedback system. Is anything silent that shouldn't be, or noisy that should be silent?

**Error prevention & recovery** — Destructive actions (delete, reset, downgrade, discard session): are they confirmed proportionally? Is there any undo? What happens on a mis-tap mid-set?

**Copy & tone** — Labels, kickers, empty states, error text. Is it consistent, scannable, and free of jargon that has to be decoded mid-set? Flag ambiguity ("Plan" vs "Schedule", "Progress" vs "Trends"), inconsistent capitalization, and emoji carrying meaning on their own.

**Accessibility** — Semantic elements vs `div`s with `onclick`, focus order and visible focus, ARIA on the tab bar and modal, labels for icon-only buttons, `aria-live` for the timer, `user-scalable=no` (a real a11y cost — is it justified here?), and whether animations respect `prefers-reduced-motion`.

**PWA & platform fit** — Safe-area insets on notched phones, status bar treatment, cold-start appearance, the update and refresh experience, and whether the installed app ever shows something a browser tab wouldn't.

**Data visualization** — The charts in Progress, Trends, and Fitness: are axes labeled, are they readable at 375px, and do they handle 1 point, 0 points, and 200 points?

## Output

Produce a single report at `UX_REVIEW.md` in the repo root, with:

1. **Verdict** — 5–8 sentences. What kind of app this currently is, what it gets right, and the one or two changes that would most improve it.
2. **Findings**, grouped by severity: **Critical** (blocks or breaks a core task), **High** (real friction on something done every session), **Medium** (inconsistency or polish that compounds), **Low** (nits). Ordered by impact within each group.

   Each finding gets: a one-line title, the screen, `file.js:line`, what the user experiences, why it matters *in the gym context*, and a concrete suggested fix. Reference a screenshot for anything visual.
3. **What's working** — a real section, not a courtesy. Name the specific decisions that are right, so they don't get refactored away.
4. **Prioritized shortlist** — the top 10 changes by impact-to-effort ratio, as a table with an effort estimate (S/M/L).

Be specific and be honest. "Improve the hierarchy" is not a finding; "the race countdown occupies the top 20% of Today but is never actionable, pushing the start-workout button below the fold on a 375×667 screen" is. If an area is genuinely fine, say so in one line rather than manufacturing findings. Cap the report at what a person would actually read — depth over volume.

When the report is done, restore the `localStorage` snapshot you took and confirm the app still loads with the user's real data.
