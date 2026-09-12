# Prompt 1 of 2: Geelong becomes the A race — 8-day taper, Melbourne dropped

Paste everything below the line into a fresh Claude Code session started in `C:\Users\rothd\runstrong`. Ship this **today (Sat 2026-09-12)** — the changed plan has to be live before tomorrow's long run. A second, larger brief (`OFFSEASON_PROMPT.md`) covers everything after the race; do not start on any of that here.

---

You are changing the race plan in **RunStrong**, a personal offline-first PWA at `C:\Users\rothd\runstrong` (vanilla JS, no build step, no dependencies, `localStorage` state). Read `HYPERTROPHY_PROMPT.md` §"What the app is" for the file layout if you have not worked in this repo before.

## The decision that changed

The app currently knows two races (`RACES`, `js/program.js:4-7`): **Geelong Half, Sun 2026-09-20, tagged "B race"**, and **Melbourne Half, Sun 2026-10-11, tagged "A race"**. The whole 9-week `buildProgram()` (`js/program.js:920-977`) is laid out around Melbourne: week 6 is a "Geelong mini-taper", week 7 "Recover → rebuild", week 8 "Taper", week 9 "Melbourne race week".

**Melbourne is off. Geelong next Sunday is now the only race and the final race until February 2027.** The user then goes into an off-season (separate brief). So:

- Geelong gets a **real A-race taper**, not the B-race mini-taper the plan currently prescribes.
- The program **ends on Sun 2026-09-20**. Weeks 7–9 (Melbourne rebuild/taper/race week) are deleted, not re-labelled.
- Everything keyed on `'melbourne'` moves to `'geelong'` or is generalised to "the next race in `RACES`".

Today is **Saturday 2026-09-12**, the last day of week 5 ("Build — peak load"). The user did most of this week but missed 1–2 sessions. **Do not schedule make-up sessions.** A missed peak-week session eight days before a race is simply gone; adding it back into the taper is the classic mistake the taper literature warns about (see [T1] below). Tomorrow's long run is the first day that changes.

## The evidence the taper must rest on

House style: numbered refs in a header comment, each rule stating which ref it rests on (see the `PROGRESSION ENGINE` header in `program.js`). **Verify every citation yourself before writing it into the app.**

- **[T1] Bosquet L, Montpetit J, Arvisais D, Mujika I. "Effects of tapering on performance: a meta-analysis." *Med Sci Sports Exerc* 2007;39(8):1358–65.** The best-supported taper for endurance performance: training **volume cut 41–60%**, **intensity maintained**, **frequency maintained (≥80%)**, over ~8–14 days, progressive rather than step. Expected gain ≈ 2–3%. This is the shape of the week: shorter sessions, same paces, same number of days out running.
- **[T2] Mujika I, Padilla S. "Scientific bases for precompetition tapering strategies." *Med Sci Sports Exerc* 2003;35(7):1182–7.** Rationale for why the drop is in volume, not intensity — fatigue clears faster than fitness fades, and the intensity work is what keeps fitness from fading.
- **[T3] Bosquet L, Berryman N, Dupuy O, et al. "Effect of training cessation on muscular performance: a meta-analysis." *Scand J Med Sci Sports* 2013;23(3):e140–9.** Strength is retained for ~2–3 weeks without training. So the gym's job this week is only to stay crisp and avoid soreness: one or two very short heavy-ish exposures early in the week, then nothing. This is the same principle the existing `WHY_SCHEDULE` and `PHASE_POLICY.taper` already encode ("cut the volume, keep the weights") — reuse it, do not invent a second rule.
- **[T4] Burke LM, Hawley JA, Wong SHS, Jeukendrup AE. "Carbohydrates for training and competition." *J Sports Sci* 2011;29(S1):S17–27.** For a ~90-minute event, a modest carbohydrate load (roughly 7–10 g/kg/day over the final 24–36 h) is sufficient; a multi-day glycogen supercompensation protocol is not needed. Use this for the race-week checklist copy only (see `RACE_CHECKLIST` defaults, `program.js` ~line 861), do not build any nutrition feature.

## What to build

### 1. Geelong is the A race; Melbourne is removed

- `RACES` becomes a single entry: Geelong, `tag: 'A race'`, date unchanged. Remove Melbourne.
- `docs/audit/current-state.md` §5 point 7 calls the two hardcoded races "a hard boundary, not an oversight". That is being changed deliberately here. Do the minimum: one race, still hardcoded. The February race is added in the next brief, and that brief will also generalise `buildProgram()` to be race-date-anchored — **do not** do that generalisation now.
- Grep and fix every consumer. Known ones in `js/app.js`: `defaultState()` races shape (line 25) and the 6→7 migration (line 60); the result card's "What now?" gating (`r.key === 'melbourne'`, line 634); the "Program complete 🎉 … Hope Melbourne went fast" card (line 718); `if (key === 'melbourne') offerRecoveryMode();` (line 1391) → Geelong; the phase-hint copy table (lines 2663–2665); the weekly summary "N weeks to Melbourne" (line 2718) → "to the next race" derived from `RACES`; the hypertrophy sheet copy "After Melbourne the app offers this choice" (line 3233). In `js/program.js`: `WHY_SCHEDULE` (~line 882) narrative, the `phases` array and `layouts` in `buildProgram()`, the race-day `sub` copy ("the one it was all for" now belongs to Geelong), and the `raceProjection` per-race loop in `app.js:1278` should simply work with one race.
- `ST.races.melbourne` holds only an empty checklist for this user — delete the key in the migration rather than carrying a dead race around.

### 2. The new week 6 (Mon 14 → Sun 20 Sep) and tomorrow's long run

Build the week from [T1]–[T3]. The targets below are what the science supports; you own the exact copy and template choice, but explain any deviation.

**Tomorrow, Sun 13 Sep (still week 5):** the long run is currently the literal string `'~20 km'`. Eight days out from an A race, a 20 km run is too much volume. Change it to **~12–14 km easy with the final 3 km at goal half-marathon pace** — roughly 60–70% of the peak long run, and the last touch of race pace at distance. This is the first ~40% volume cut of the taper [T1].

**Week 6 layout** (`layouts[4]` in `buildProgram()`, replacing the current mini-taper), phase label `'Geelong taper — race week'` or similar. Check `phaseKeyFromLabel()` (`program.js:1079`): `/race week/` is tested before `/taper/` and maps to `PHASE_POLICY.raceweek` (`rpeAdj: -2`, "this is a primer"), which is too soft for Monday and Tuesday. Pick a label that resolves to `taper` (load frozen, `rpeAdj: -1`) and, if you want race-day-specific copy, key it on the race day, not the phase label. Say what you chose.

| Day | Prescription | Why |
|---|---|---|
| Mon 14 | Lift, **`lowerTaperB`** (squat 3×3 crisp + seated calf 3×10, ~26 min) | Last lower-body exposure, 6 days out. Intensity kept, volume ≈40% of peak, nothing that causes soreness [T1][T3]. The current `lowerTaperG` (Bulgarian split squats + single-leg RDL) is more eccentric/soreness load than an A-race week wants. |
| Tue 15 | Lift, **`upperTaperA`** (bench 4×4, pull-up 3×5, Pallof 3×10, ~28 min) | Last gym session, 5 days out. Upper body carries no running cost [T3]. |
| Wed 16 | Run, **sharpener**: 15 min easy → 5 × 2 min at goal HM pace / 2 min easy float → 10 min easy (~8 km) | Intensity is the thing the taper must keep [T1][T2]; this is the hard day at half its usual volume. |
| Thu 17 | **Mobility only** | "Nothing heavy within 3 days of the race" is already the app's rule (`WHY_SCHEDULE`, week-8 layout copy). |
| Fri 18 | Run, **easy 25–30 min + 4 × 20 s relaxed strides** | Frequency maintained, volume cut [T1]. Strides keep turnover without fatigue. |
| Sat 19 | **Rest, or 15 min shake-out + 3 strides**, then the existing "easy stretch + rollout" mobility copy | Optional and short. Race kit/checklist card surfaces here as it does now. |
| Sun 20 | 🏁 Geelong Half — replaces the long run | Race. |

Running volume Sun 13 → Sat 19 lands around 25–30 km versus a ~37 km normal week — a ~30–40% cut in the final 8 days on top of tomorrow's shortened long run. That is inside the [T1] window given only one week is available; say so in the `WHY_SCHEDULE` update rather than pretending it is the two-week ideal.

Update the `RUN` day subtitles for this week only with the actual content above (the generic `'Intervals / tempo — lifting stays out of the way'` is wrong for a taper week). Runs are logged via `openRunLog` keyed by date and merged with Garmin/Strava imports — none of that changes.

### 3. Program end and the "what now?" hand-off

- `buildProgram()` returns 6 weeks. `weekFor()`/`dayFor()`/`phaseLabel()` in `app.js:190-201` must handle dates past the last week the way they do today past Melbourne (the "Program complete" card at `app.js:718`). Re-word that card for Geelong.
- Logging the Geelong result (`openRaceResult('geelong')`) triggers `offerRecoveryMode()` exactly as Melbourne did. Leave the sheet's contents alone — the next brief redesigns it. Just make sure it opens.
- Weekly summaries (`weeklySummaries[]`, `showWeeklySummary`) that already exist for weeks 1–5 must render unchanged.

### 4. Migration and data safety

- `SCHEMA_VERSION` 12 → **13**, additive, comment style of the existing migrations. The precedent for a plan-structure change is migration `1 → 2` (`app.js:38`): `ST.program` is **stored, not recomputed**, so the migration rebuilds it from `buildProgram()`.
- `ST.sessions` and `ST.runs` are keyed by date, not by program week, so rebuilding the program must not touch them. Prove it: a session logged on a week-5 date must still show ✓ in the Plan tab after migration, and the adherence line in `vSchedule` must still count it. If any code looks a session up via its `tpl` and the program's day for that date (e.g. `upNext`, streak heatmap, notification context from v30), check it tolerates a date whose template changed.
- Delete `ST.races.melbourne` (see §1). Keep the `runstrong.backup.v4` snapshot untouched.

### 5. Tests and shipping

- `tools/test-*.js` are dependency-free; baseline today is **347 + 694 + 2294** assertions green (`node tools/test-progression.js`, `-stretch`, `-warmup`). Run them first, confirm, then again at the end.
- Add assertions (in `test-progression.js` or a new `tools/test-program.js` following the same pattern) that: `buildProgram()` has 6 weeks and ends 2026-09-20; week 6 Sunday is `kind: 'race'` for Geelong; no `kind: 'lift'` day falls within 3 days of the race; week 6's phase label resolves to the `taper` policy; `RACES.length === 1`. Fix any existing test that asserts 9 weeks or Melbourne.
- Bump `APP_VERSION` (`app.js:166`) and `sw.js` `CACHE` **together**: both are `v31`, this ships as **`v32`**.
- Open the app once via `.claude/launch.json` and check Home (today's card, race countdown, "Up next"), Plan (week 6 rows, race row, checklist), and Progress → Log still render with no console errors.
- Commit as `v32: Geelong is the A race — 8-day taper, Melbourne removed`.

## Constraints

- Vanilla JS, no dependencies, no build step. Pure logic in `program.js` (exported through the `module.exports` guard at the bottom), views in `app.js`.
- Reuse the existing taper machinery: taper `TEMPLATES`, `PHASE_POLICY.taper`, the `kind: 'mobility'` day type, `RACE_CHECKLIST`. Do not add a running-periodisation engine — the run days are titles and subtitles, keep them that way for this brief.
- Do not touch hypertrophy/maintenance code, the Progress tab, or add any plan-editing UI. All of that is `OFFSEASON_PROMPT.md`.
- Cite the evidence in a header comment above the week-6 layout, numbered, and only after checking the references yourself.
