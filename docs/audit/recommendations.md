# RunStrong — Recommendations

Synthesis of `docs/audit/current-state.md` (internal codebase audit, `APP_VERSION = 'v25'`, `SCHEMA_VERSION = 9`) against `docs/audit/market-research.md` (outside-view market research on Strong, Hevy, Fitbod, Boostcamp, Strava, Whoop, Ladder, Juggernaut AI, Caliber, and adjacent apps). Both source files are treated as ground truth; no additional code exploration was done for this document.

---

## 1. Feature coverage table

| # | Feature / mechanic (source: market-research.md) | Status | Detail |
|---|---|---|---|
| 1 | Fast set/rep/weight logging mid-workout | **ALREADY BUILT** | `js/app.js:1445-1527` (`vSession`) + stepper/tap-to-type UI, `js/app.js:1614-1661` |
| 2 | Rest timer (auto-start, per-exercise) | **ALREADY BUILT** | In-workout rest timer, `js/app.js:1445-1527`; background notification best-effort, `js/app.js:231-242` |
| 3 | Exercise library with instructions/videos | **PARTIAL** | `js/program.js:27-87`, `EXERCISES` (~54 entries) with `cue`/`why`/`deep` text fields. Missing: no video/image content at all; library is far smaller than competitors' (54 vs. Fitbod's 1,600+), though intentionally scoped to this program |
| 4 | Workout history / progress charts (volume, 1RM, PR tracking) | **ALREADY BUILT** | Progress · Log tab, `js/app.js:2226-2301`; PR detection, `js/app.js:2033-2066` |
| 5 | Plate calculator | **MISSING** | No plate-math code anywhere in the audit |
| 6 | Warm-up calculator (percentage-based ramp sets to working weight) | **PARTIAL** | `js/program.js:301-521` (`PREPS`/`prepRoutine`) is a dynamic *movement-prep* warm-up (mobility), not a loading-percentage ramp-up calculator to the day's working weight — different mechanism, same word |
| 7 | Supersets / circuits with smart scrolling | **MISSING** | No mention in the feature inventory or data model; `ExerciseInSession` (§3 of current-state.md) is a flat list with no pairing concept |
| 8 | RPE / RIR tracking per set | **ALREADY BUILT** | `js/program.js:680-913` (`nextPrescription`/`PHASE_POLICY`); `Set` model carries `rpe` |
| 9 | Custom routines / follow named structured programs (5/3/1, PPL, GZCLP, etc.) | **NOT APPLICABLE** | current-state.md §5 constraint 7: the program is hand-laid-out around two hardcoded races and is explicitly "not a generic N races system... a hard architectural boundary, not a parameter to pass in" |
| 10 | Offline logging / no-connectivity resilience | **ALREADY BUILT** | `sw.js` cache-first precache; current-state.md §5 constraint 3 ("offline-first is load-bearing, not aspirational") |
| 11 | Cross-device sync / cloud backup | **NOT APPLICABLE** | current-state.md §5 constraint 2: "all state is client-side and local to one device," no backend exists at all (§1) |
| 12 | Body measurement / progress photo tracking | **MISSING** | No such fields anywhere in the `ST` data model (§3) |
| 13 | GPS run tracking with pace/splits/route map | **PARTIAL** | Manual run logging with splits, `js/app.js:662-737`; Strava/Garmin merged view, `js/app.js:923-978`. The app itself never captures GPS — it only imports it |
| 14 | Free tier that isn't crippled | **NOT APPLICABLE** | No monetization or tier system exists; this is a personal single-user app, not a commercial product |
| 15 | Strong — minimalist logging (design ethos) | **ALREADY BUILT** | Whole app is a two-file vanilla-JS tool, arguably more minimal than Strong itself (§1, §5 constraint 1) |
| 16 | Strong — one-time-purchase pricing | **NOT APPLICABLE** | No monetization/pricing model exists |
| 17 | Hevy — social feed of friends' workouts | **NOT APPLICABLE** | current-state.md §5 constraint 2, no backend/accounts/social graph |
| 18 | Hevy — algorithmic program suggestions | **ALREADY BUILT** | `js/program.js:680-913`, RPE-autoregulated progression |
| 19 | Fitbod — fully automated per-session generation adapting to prior performance/recovery/equipment | **PARTIAL** | Load/weight progression is fully automatic (`nextPrescription`); exercise *selection* is fixed per template, not regenerated per available equipment — manual swap exists (`js/app.js:1735-1750`) but isn't automatic |
| 20 | Fitbod — 1,600+ exercise library | **MISSING (by scale)** | `js/program.js:27-87`, ~54 entries — intentionally scoped, not a gap in intent |
| 21 | Boostcamp — curated library of 100+ named community programs | **NOT APPLICABLE** | Same as row 9, contradicts §5 constraint 7 |
| 22 | Strava — kudos/comments/segments/leaderboards | **NOT APPLICABLE** | §5 constraint 2, no backend/social graph |
| 23 | Whoop — continuous Recovery/Strain/Sleep score from 24/7 wearable | **PARTIAL** | HRV/RHR/VO2max morning check-in + readiness banding exists (`js/app.js:1037-1139`, `322-362`) but relies on manual/imported daily entries, not continuous passive sensor fusion, and there is no proprietary hardware |
| 24 | Ladder — live coach-programmed audio-guided workouts | **NOT APPLICABLE** | Requires an ongoing content-production pipeline / coaching business |
| 25 | Juggernaut AI — adaptive week-to-week programming + meet-day advisor | **ALREADY BUILT** | `js/program.js:680-913` (adaptive periodization/RPE autoregulation) + `js/app.js:1219-1269` (race-week checklist, race result logging) serve the same function for RunStrong's two races |
| 26 | Caliber — human 1:1 coaching, nutrition targets, results guarantee | **NOT APPLICABLE** | Requires a coaching marketplace/ops business + nutrition domain entirely outside scope |
| 27 | Setgraph/JEFIT — extreme minimalism / deep instructional content | Minimalism: **ALREADY BUILT**; instructional depth: **PARTIAL** | Same citation as row 3 |
| 28 | Streak counters tied to a visible calendar/heatmap | **MISSING** | No streak/heatmap concept anywhere in `ST` or the feature inventory |
| 29 | Weekly recap pushed on a fixed schedule | **ALREADY BUILT** | `js/app.js:2304-2440`, auto-offered once/week via `weeklySummaryDue`, `js/app.js:2390-2403` |
| 30 | Social feed / kudos-style reactions | **NOT APPLICABLE** | Same backend/social-graph constraint |
| 31 | Adaptive next-workout generation instead of static plan | **ALREADY BUILT** | `js/program.js:680-913` — the entire point of the RPE-autoregulated engine |
| 32 | Daily biometric score that changes behavior (Whoop-style) | **ALREADY BUILT (close analog)** | Readiness check-in → guidance banding (`js/app.js:322-362`, `1315-1374`) + deload radar (`js/app.js:414-447`) already drive daily go/lighter/rest decisions. Difference from Whoop: manual/imported entry, not continuous passive sensing |
| 33 | Named real-coach programs with progression logic | **NOT APPLICABLE** | Duplicate of rows 9/21, contradicts §5 constraint 7 |
| 34 | Streak-at-risk re-engagement push notification | **MISSING** | Any build must respect §5 constraint 5 (no second standalone permission-request flow) |
| 35 | In-ear/audio-guided live coaching | **NOT APPLICABLE** | Content-production pipeline, out of scope |
| 36 | [Anti-feature avoided] Requiring internet connectivity to log a workout | **ALREADY BUILT (avoided)** | `sw.js` cache-first + §5 constraint 3 |
| 37 | [Anti-feature avoided] Data lock-in / poor export options | **ALREADY BUILT (avoided)** | `js/app.js:2903-2945`, JSON export/import, CSV export |
| 38 | [Anti-feature] Excessive/irrelevant push notifications | **PARTIAL — mostly avoided, one open gap** | Notification use is narrow (rest-timer only, §5 constraint 5), but the existing ask has zero explanatory copy (`js/app.js:1429-1433`) — see Fix list |
| 39 | AI form-checking via phone camera (computer vision) | **MISSING** | No CV/ML code anywhere; would require a model dependency, contradicting §5 constraint 1 (no dependencies) |
| 40 | GLP-1-aware programming mode | **NOT APPLICABLE** | Single-user app built for one runner's two-race prep, not a general-audience content play |
| 41 | Conversational/LLM-based 24/7 coaching chat | **MISSING** | Would introduce a network-dependent, cost-bearing external API call, in tension with §5 constraints 1 and 3 |
| 42 | Readiness/recovery metrics moving into mainstream logging apps | **ALREADY BUILT** | RunStrong already has HRV/RHR/VO2max + readiness banding + deload radar (`js/app.js:1037-1139`, `322-362`, `414-447`) — ahead of this trend, not behind it |
| 43 | Deeper cross-platform health data interoperability (Garmin/Apple Health/Health Connect) | **PARTIAL** | Garmin CSV import + Strava OAuth exist (`js/app.js:739-921`); no native HealthKit/Health Connect API access, which isn't available to a dependency-free PWA without a native wrapper (tension with §5 constraint 1) |
| 44 | Big-tech LLM coaching becoming table stakes | **NOT APPLICABLE** | Market-dynamics observation, not a buildable feature (market-research.md itself marks difficulty N/A) |
| 45 | Wellbeing-oriented alternative to streak pressure (Gentler Streak) | **NOT APPLICABLE (yet)** | Moot until/unless a streak feature (row 28) is built; noted as a design consideration for that recommendation below |

**45 rows.**

---

## 2. Recommendations, in priority order

### 1. Plate calculator
- **User problem:** mid-set, under fatigue, the user has to do mental math to figure out which plates go on the bar for a prescribed weight — friction at exactly the moment speed matters most.
- **Why it matters:** market-research.md, Table Stakes — "Plate calculator / warm-up calculator... now expected in nearly every serious lifting app (Hevy, HeavySet, Barley, Bar Is Loaded as standalone even exists solely for this) — its absence is a noted gap." This is row 5 in the coverage table, tagged MISSING.
- **What it touches:** pure arithmetic given bar weight + available plates; belongs in `js/program.js` per current-state.md §5 constraint 4 ("pure logic lives in `program.js`"), surfaced from the weight stepper in `vSession` (`js/app.js:1614-1661`) where `prescWeight` is already computed.
- **Effort:** Small — self-contained pure function, trivially unit-testable the same way `tools/test-progression.js` already tests `program.js`.
- **Verdict:** High impact / low effort — do first.

### 2. Home-screen streak / consistency heatmap
- **User problem:** nothing today shows the user their consistency at a glance, so there's no visible reinforcement of the momentum that's actually accumulating session to session.
- **Why it matters:** market-research.md, Retention Mechanics — quoted directly: "by far the thing I like the most is the streak counter on the dailies... quite rewarding to see you've done your morning light workout 120+ days in a row," framed as the mechanic that "replac[es] willpower with a loss-aversion hook once novelty fades" — exactly the post-novelty churn window RunStrong has no defense against today.
- **What it touches:** fully derivable from existing `ST.sessions`/`ST.runs` (current-state.md §3) — no new persistence needed. Home view is `vHome`; could follow the same computed-cache pattern the audit already documents for performance (`_mergedAllCache`, `activityIndex()` at `js/app.js:941-956`).
- **Caveat (constraint):** a "streak at risk" notification (coverage row 34) must **not** become a second standalone permission-request flow — current-state.md §5 constraint 5 is explicit that no new feature should add a second permission ask without first addressing the existing unexplained one (§2 half-built list, `js/app.js:1429-1433`). Recommend shipping the heatmap with an **in-app banner only** first; a push-notification version should wait on Fix item 3 below.
- **Effort:** Small–medium.
- **Verdict:** High impact / low-medium effort — do second.

### 3. Richer exercise instructional content (text/diagram, not video)
- **User problem:** on an unfamiliar swap variant or a new exercise, the user gets only a short cue/why/deep text block with no visual reference.
- **Why it matters:** market-research.md, Table Stakes — "JEFIT's loyalty is tied to its 'extensive exercise database with instructional content' for newer lifters; Fitbod users cite the 'exercise library, muscle map' as a core positive."
- **What it touches:** extends the existing `EXERCISES` entries (`js/program.js:27-87`), which already carry `cue`/`why`/`deep` fields — additive content, not a new subsystem.
- **Effort:** Medium, but mostly content-authoring time, not code. Full video is explicitly rejected below (see §3) — content must stay static/bundled to respect §5 constraints 1 and 3 (no dependencies, offline-first).
- **Verdict:** Medium impact / medium effort — third.

### 4. Equipment-aware / smarter exercise-swap suggestions
- **User problem:** the swap feature exists but gives no guidance on *which* alternate variant fits the current context (equipment unavailable, joint aggravation, etc.) — the user has to already know the answer.
- **Why it matters:** market-research.md, Differentiators — Fitbod's headline differentiator is workouts that adapt to "available equipment"; RunStrong has the swap mechanism (coverage row 19, PARTIAL) but not the adaptive layer around it.
- **What it touches:** builds on `swapExercise()` (`js/app.js:396-408`) and the `swaps` arrays already in `EXERCISES`.
- **Blocking dependency:** current-state.md flags a real correctness bug in exactly this code path — swapping mid-session can misattribute already-logged sets to the new variant (`js/app.js:396-408`, §2/§4 of current-state.md). **This must be fixed (Fix item 1 below) before this recommendation is built**, or the new feature would compound a known data-integrity gap in the per-variant history the whole progression engine depends on.
- **Effort:** Medium, sequenced after the bug fix.
- **Verdict:** Medium impact / medium effort, gated — fourth.

**4 recommendations.**

---

## 3. What we deliberately rejected, and why

- **Social feed / friends' activity / kudos (Strava, Hevy)** — breaks current-state.md §5 constraints 1 and 2 outright: no backend, no accounts, no server-side social graph exists or is meant to exist. Building this would mean standing up a backend the whole architecture is deliberately built to avoid.
- **Cross-device cloud sync / backup** — breaks §5 constraint 2 directly: "all state is client-side and local to one device... no server, no sync-across-devices story, and no accounts." The Settings footer says this outright in-app.
- **Named community program library (Boostcamp-style) or a generic "build any routine" system** — contradicts §5 constraint 7: the program is hand-laid-out around two specific hardcoded race dates, explicitly documented as "a hard architectural boundary rather than a parameter to pass in." Generalizing the program engine to support arbitrary routines is a different app.
- **One-time-purchase or subscription pricing (Strong's model)** — no monetization exists and none is implied by anything in the audit; this is a personal tool, not a product with a business model.
- **Live coach-programmed audio-guided workouts (Ladder)** — requires an ongoing content-production pipeline and named-coach relationships; wildly out of scope for a solo-maintained two-file vanilla-JS app.
- **Human 1:1 coaching marketplace with nutrition targets (Caliber)** — requires a coaching marketplace/ops business plus an entire nutrition-tracking domain that doesn't exist in the app today.
- **Continuous wearable-driven Recovery/Strain scoring requiring proprietary hardware (Whoop)** — no hardware exists or is implied; more importantly, RunStrong's manual/imported HRV/RHR/VO2max check-in (coverage row 23/32) already delivers the same behavioral function — a daily readiness signal driving training decisions — without requiring the user to buy a wearable.
- **AI form-checking via phone camera (computer vision)** — breaks §5 constraint 1 (no dependencies): CV form-checking needs a bundled model, which contradicts the app's zero-deps, zero-build-step architecture and would bloat the offline-install size. Market-research.md itself is candid that current CV form-checkers are "fragile in consumer environments" — a bad first bet even ignoring the constraint conflict.
- **Native in-app GPS run tracking / route mapping** — large effort duplicating a capability the app already gets, effectively for free, via the working Garmin CSV import and optional Strava sync (coverage row 13, PARTIAL only in the narrow sense that the app doesn't *capture* GPS itself). Not worth rebuilding infrastructure that import already delivers.
- **Body measurement / progress photo tracking** — targets physique-focused users. RunStrong's entire design center — RPE-autoregulated periodization tied to two specific races — is performance-focused, not aesthetics-focused, and nothing in the audit suggests this user tracks body composition. It would also require a new persistence layer: current-state.md is explicit that `localStorage` is the *only* store (§1, §5 constraint 2) and there is zero IndexedDB usage anywhere — photos don't fit that model without real architecture surgery.
- **GLP-1-aware programming mode** — a general-population content play (market-research.md, Emerging Trends); irrelevant to a single-user app built around one runner's two races.
- **Conversational/LLM-based 24/7 coaching chat** — introduces a paid, network-dependent external API call in direct tension with §5 constraints 1 (no dependencies) and 3 (offline-first is load-bearing). It also carries real liability in giving unsupervised physiological advice, cutting against the codebase's own evidence-citing content discipline (§5 constraint 6: "cite what's known, say plainly what isn't").
- **Deep native HealthKit / Health Connect integration** — not accessible to a dependency-free PWA without a native wrapper (Capacitor/Cordova-class tooling), which would itself violate §5 constraint 1. Garmin CSV import + Strava OAuth already cover the practical need.
- **Supersets/circuits with smart scrolling** — no evidence anywhere in the audit that the current 20 named session templates (`js/program.js:524-561`) use paired-exercise structures; the data model (`ExerciseInSession`) is a flat list with no pairing concept. Adding this would require real data-model surgery for a single user whose entire 9-week program is already fully authored around straight sets — speculative complexity with no demonstrated need.
- **Free-tier/paywall packaging** — not applicable; no monetization exists to design a free tier against.

---

## 4. Fix before building anything new

Ordered by severity. The first item is the audit's one confirmed **data-correctness bug** and outranks every recommendation above.

1. **[DATA-CORRECTNESS BUG] Exercise swap mid-session misattributes already-logged sets.** `swapExercise()` (`js/app.js:396-408`) reassigns `e.exId` to the new variant unconditionally. If 1+ sets were logged against the *original* exercise before swapping, those completed sets stay in the array and get silently attributed to the *new* exercise once `e.exId` is reassigned — the code's own comment acknowledges this as a known simplification. The swap button is rendered with no guard disabling it once sets are logged, so this is reachable through normal UI use, not just a theoretical edge case. This corrupts the per-variant history that the entire RPE-autoregulated progression engine depends on. **Fix before Recommendation 4, and before any other feature that reads exercise history.**
2. **`save()` has no try/catch around `localStorage.setItem`** (`js/app.js:108`), unlike `loadState()` which does (`js/app.js:85-95`). `save()` is called from nearly every mutating handler in the app; under quota-exceeded conditions or private-browsing storage restrictions, a `save()` call throws uncaught — risking silent data loss or an unhandled crash mid-workout. This is a data-loss risk, not a cosmetic issue, and should rank second only to the swap bug.
3. **Notification permission is requested with zero explanatory copy**, still true at `js/app.js:1429-1433` — it fires the instant "Start" is tapped on a lift session with no framing of what it's for. Flagged in `UX_REVIEW.md` (finding #7) and reverified as still open in current code. Fix this **before** building Recommendation 2's streak-at-risk notification, since that feature would otherwise compound an already-unexplained permission ask.
4. **`alert()`/`confirm()` inconsistency in import/restore flows** (`js/app.js:916`, `2897`, `2941-2942`) — these use blocking `alert()` while the rest of the app uses the purpose-built non-blocking `toast()` (`js/app.js:116-128`). Jarring UI-class inconsistency in exactly the error-recovery paths where a calm, on-brand UI matters most.
5. **Accessibility backlog** (batch these together, and do it before shipping Recommendation 2's new home-screen UI so the new surface doesn't inherit the same debt): missing `<h1>` on 5 of 7 main views; `user-scalable=no` (`index.html:5`); non-semantic `<div onclick>` tap targets (`.exlist-row`, `.stepval`, `.ex-why`, `.restbar`); Settings `.toggle` buttons with no `role="switch"`/`aria-checked`; install-banner dismiss button with no `aria-label`.
6. **Insights tab is a wall of near-empty "not enough data yet" placeholders on a fresh install** (~1,213px of eight stacked cards per `UX_REVIEW.md` finding #14, structurally unchanged at audit time). Half-built first-run experience — worth collapsing or deferring low-signal cards before adding more Progress-tab surface area (e.g., a future streak heatmap living nearby).
7. **`RACE_CHECKLIST` positional-index fragility** (`js/program.js:564-573`) — `ST.races[key].checklist` is keyed by array index, not a stable ID. Not a live bug today, but any future reorder/insert into that array silently corrupts existing users' checked-state. Convert to stable IDs before touching race-week content again.
8. **JSON import validation is minimal** (`js/app.js:2939`: `if (!s.schemaVersion || !s.sessions) throw ...`) — a malformed-but-matching file passes straight into `migrate()` with unpredictable results. Tighten before leaning on import more (e.g., before any future data-portability push).
9. **`APP_VERSION`/`sw.js` `CACHE` string require manual bump-in-lockstep** (`js/app.js:114`) with no automated check — process risk of silently serving stale JS after a deploy.
10. **`ST.settings.seenWhy` is written but never read** (`js/app.js:2203`) — trivial dead-state cleanup, lowest priority.

---

## 5. Build sequence

**First — stabilize the data layer.** Fix the swap-attribution bug (Fix #1) and add the missing try/catch in `save()` (Fix #2). These are the two real data-integrity/data-loss risks in the codebase. *Unlocks:* everything downstream that reads session/exercise history — including the streak heatmap (counts sessions) and the equipment-aware swap recommendation — can now trust the data it's built on, instead of quietly inheriting corruption.

**Second — ship the small, self-contained wins.** Plate calculator (Recommendation 1), notification-copy fix (Fix #3), and `alert()`/`confirm()` cleanup (Fix #4). None of these touch the data model; all are additive UI/content changes. *Unlocks:* a clean, consistent notification-permission story — a prerequisite before adding any second use of that permission — and closes out the cheapest, highest-visibility gaps from the coverage table.

**Third — build the retention mechanic, and clear the accessibility backlog while touching the same surface.** Home-screen streak/consistency heatmap (Recommendation 2, in-app-only notification first) plus the batched accessibility fixes (Fix #5), since the heatmap adds new home-screen UI anyway. *Unlocks:* a validated, evidence-backed retention mechanic (per market-research.md's Retention Mechanics section) sitting on a now-clean accessibility and notification foundation, rather than adding more UI on top of the existing debt.

**Fourth (stretch) — richer content and adaptive intelligence.** Richer exercise instructional content (Recommendation 3) and equipment-aware swap suggestions (Recommendation 4), now that swap data integrity is fixed and the UI/notification/accessibility foundation is solid. *Unlocks:* the two remaining PARTIAL-status market gaps (exercise library depth, Fitbod-style equipment-aware adaptation) without building on top of any known-broken code path.
