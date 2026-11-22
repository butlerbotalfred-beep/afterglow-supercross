# Speed and acceleration retune (physics version 3) — 22 November 2026

At Michael's request the top speed drops from 169 to 162 km/h (`maxSpeed` 45 m/s) and acceleration rises 15% (`acceleration` 26.953125 m/s²). The physics version is 3, so best laps from versions 1 and 2 are archived.

The extra acceleration alone broke three things, each fixed here:

- **AI riders landing on the next face.** A rider who entered a rhythm lane short of its pace now sped up into the band of takeoff speeds that comes up short (25 to 31 m/s on a 34 m double). `src/takeoff.ts` works out, for every jump, the hardest landing at each takeoff speed, with the same step and rules as the physics. The AI aims for the fastest safe speed it can still reach before the lip, and stays 2 m/s clear of any crashing speed.
- **AI contact crashes.** The AI will not close on a much slower rider in its line at more than 5 m/s inside 25 m. Riders who rub in the air are pushed apart but keep their speed; before, a long brush in flight bled enough speed to drop a rider short of the landing.
- **Landing reward shrinking.** A missed landing is recovered faster with more acceleration, so the gap fell under the M1.2 targets (Dusk Valley 1.43%, Saltwind Coast 0.65%). `landingPenaltySlope` goes from 1.0 to 1.4 and `landingPenaltyMax` from 0.26 to 0.29, which puts the gaps back where M1.2 left them.

Results:

- **Field check (new, in CI).** `npm run field-check -- --check`: 60 all-AI races, 4, 5, 6 and 8 riders, relaxed, club and expert, all five circuits: 60 of 60 with no crash, no recovery and every rider finishing. The pace gate alone (four riders, club and expert) missed crashes in larger fields.
- **Race times.** `npm run pace-gate -- --baseline baselines/pace-v1.json`: all ten races are 0.4% to 1.2% faster than version 1, with 0 crashes and 0 recoveries. `baselines/pace.json` is regenerated with Michael's approval; the version 2 files are kept as `pace-v2.json` and `landing-v2.json`.
- **Landing reward.** `npm run landing-harness`: the rider who never pitches loses 1.82% on Dusk Valley, 1.10% on Red Mesa, 1.91% on Pine Summit, 0.87% on Saltwind Coast and 1.13% on Iron Quarry, 0 crashes. All meet the M1.2 targets (1.5% Dusk, 0.8% elsewhere).
- **Retired check.** M1.2 required the slope-matching rider to stay within 1.0% of the time before M1.2. A quicker bike cannot hold that, so the check was removed from `scripts/landing-harness.ts` with Michael's approval on 22 November 2026. The gap targets and the zero-crash check remain.
- **Tests.** 154 pass. `tests/npc.test.ts` fails without the takeoff and closing rules.
- **Review B.** The first version used a simpler rule (an AI rider off the pace rolled the lane). The independent review showed it slowed on-pace riders on Iron Quarry, caused contact crashes in 8-rider fields and left crashes in 5 and 6 rider fields, so it was replaced by the rules above.

# M1.2 Landing skill — 22 November 2026

Matching the bike to the landing now matters. A landing more than 0.10 radians off the slope costs speed (it used to be free up to 0.30), a clean downslope landing adds up to 3 km/h, and the HUD says CLEAN LANDING or FLAT LANDING. The lean crash check that could never fire is gone, and the physics version is 2, so best laps from version 1 are archived. At Michael's request the top speed also drops from 182 to 169 km/h; the fastest any circuit lets the Expert AI go is about 164 km/h, so no race time changes.

| Completion box | Result | Evidence |
| --- | --- | --- |
| A rider who never uses air pitch is at least 0.8% slower on every circuit, 1.5% on Dusk Valley | Pass | `npm run landing-harness -- --check`, 3 laps: Dusk Valley 1.59%, Red Mesa 1.09%, Pine Summit 1.81%, Saltwind Coast 0.87%, Iron Quarry 1.33%. Before: 0.03 to 0.12%. The check fails if any circuit drops under its target |
| Slope-matching rider's 3-lap time is within 1.0% of baseline on every circuit | Pass | Same command, against `baselines/landing-v1.json`: Dusk Valley +0.31%, Red Mesa -0.04%, Pine Summit -0.08%, Saltwind Coast -0.02%, Iron Quarry +0.02% |
| pace-gate at 1.0% passes with 0 AI crashes and 0 recoveries | Pass | `npm run pace-gate -- --tolerance 1 --baseline baselines/pace-v1.json`: 10 of 10, largest change +0.32% (Dusk Valley, Club), 0 crashes, 0 recoveries |
| The bonus never exceeds +3 km/h on any landing | Pass | The pace gate records the most speed any landing really added in each of the ten AI races and fails above the cap: largest 3.000 km/h. `tests/landing.test.ts` sweeps gradients from 0.05 to 1.2 at three speeds, and checks the bonus cannot pass the top speed or be earned off the track |
| A clean landing never puts a mid-band rider more than 2 km/h above the rhythm band | Pass | `tests/landing.test.ts`, last test: in each of the 25 rhythm sections a rider at the section's pace lands cleanly on its steepest downslope. The most any gains is 3 km/h, against the 7 km/h allowed (5 to the top of the band, plus 2) |
| The dead lean check is gone and every existing crash test still passes | Pass | `src/physics.ts` no longer has it; `tests/landing.test.ts` forces lean past 0.95 at touchdown with an impact over 7 and the rider stays up; `tests/crash.test.ts` passes unchanged |
| PHYSICS_VERSION is 2 and old records are archived | Pass | `tests/landing.test.ts`: a version 1 lap is no longer the time to beat and sits under `archived` |

## Tuning

- Penalty: starts at 0.10 rad and costs 1.0 of speed per radian beyond that. It levels off at 26% for one landing, which is the most the old rule ever charged, and is never less than the old rule. At 1.1 per radian the rider who never pitches comes up short and crashes once a lap in Pine Summit's rhythm run, so 1.0 is the steepest value that punishes without wrecking.
- Rebounds: a touchdown after less than 0.1 s in the air is a bounce, too quick to pitch for. The steep penalty levels off at 5% for it, so a bad landing is not charged in full a second time. Before this the review measured one bounce costing 22%.
- Bonus: only after 0.3 s or more in the air, only within 0.10 rad of the slope, only on the track, growing with the downslope and reaching the full 3 km/h at a gradient of 0.3. It cannot push the bike past its top speed.

## Mac Studio smoke tests

Run in a separate copy at commit e2e2b0e, the code as merged apart from this write-up. The live game was not touched.

| Test | Result |
| --- | --- |
| `npm test` | 150 of 150 |
| browser-smoke | 19 of 19. 58.2 fps with 1 human and 5 NPCs, 57.6 fps with 4 humans and 4 NPCs |
| touch-smoke | 13 of 13 |
| course-smoke | 5 of 5. 59.3 to 59.6 fps on all five circuits |
| hud-layout-check | 4 of 4 layouts clear |
| load-smoke, on a production build | 15 of 15 |
| prod-smoke with a layout export and import | 13 of 13, BUILD e2e2b0e |

## Code review (B)

An independent review found no blocking bug and nine points. All are addressed.

| Finding | Fix |
| --- | --- |
| A nose-high landing was charged again in full on its two-frame rebound, up to 22% for one bounce | Rebounds are limited to 5% (see Tuning). The harness targets still hold |
| The lean test would have passed with the old check still in place | It now forces lean past 0.95 at touchdown and asserts it |
| The rhythm-band test never had a rider at mid-band, and skipped a section per circuit | Rewritten: all 25 sections, a rider at the section's pace on its steepest downslope |
| The landing cue hid the rhythm pace hint on approach | The pace hint now wins |
| The pace gate checked the capped value, not the speed really gained | The rider records the speed the landing added, and that is what the gate checks |
| The bonus could pass the top speed for one frame, and was paid just off the track | Clamped to the top speed; on-track only |
| CLEAN LANDING / SPEED KEPT showed even when a heavy impact scrubbed speed | Such a landing gets no cue |
| `pace-gate` ignored or misread mistyped options, and `--write` skipped the crash and bonus checks | Unknown or incomplete options stop the run; `--write` refuses an unfit result |
| "No circuit lets the Expert AI pass 164 km/h" was a rounding short | Reworded to about 164 km/h |

Not changed: a landing that is nose-down past the slope is also called FLAT LANDING. Its advice, match the slope, is still right.

## Rhythm pace hints (re-checked)

A Club rider was ridden through all 25 rhythm sections before and after. Entry speeds moved by 0.4 km/h at most and mean speeds by 0.7 km/h at most, with one exception, so no pace hint was changed. The exception is Dusk Valley's Deep Whoops, where the AI lands slightly nose-high after the long first hop and now loses a few km/h on average through the section. A rider who matches that landing does not.

## Baselines

`baselines/pace.json` and `baselines/landing.json` now hold the version 2 numbers and CI compares against them exactly. The numbers from before this change are kept as `baselines/pace-v1.json` and `baselines/landing-v1.json`.

## Play review (D, about 10 minutes)

Ride 3 laps of Dusk Valley matching your landings, then 3 laps ignoring air pitch.

1. Is your best lap at least 1 second faster when you land well?
2. Does a clean landing feel rewarded?
3. Did any rhythm section become harder to ride cleanly than before?

# M1.1 Lap and sector timing — 22 November 2026

Every rider's laps are now timed to a thousandth of a second, split into four sectors. The HUD shows the running lap, last lap, best lap and a green or red difference at each sector; the results screen lists every rider's laps; and the best lap for each circuit and each custom layout is saved. Nothing about how the bike moves changed: the pace gate still matches exactly.

| Completion box | Result | Evidence |
| --- | --- | --- |
| Four sector times add up to the lap time within 0.001 s | Pass | `tests/timing.test.ts`, "four sector times add up": 3 laps each at 11.7, 30 and 48.9 m/s, largest difference under 0.000000001 s. Also checked for every rider of a whole simulated race |
| A mid-step gate crossing at 30 m/s is timed within 0.001 s | Pass | Same file, "a mid-step gate crossing at 30 m/s": measured error under 0.000000001 s against the exact answer, where one physics step is 0.0083 s |
| Laps are timed correctly across the start/finish seam | Pass | Same file, "laps are timed correctly across the start/finish seam": 3 laps, each 1600 m / 30 m/s = 53.333 s within 0.001 s. Two more tests cover a line crossed while briefly off the track and during a crash slide |
| A record is only replaced by a faster valid lap and survives a reload | Pass | Same file, "a record is only replaced by a faster lap and survives a reload", plus "only a person riding a clean lap unaided can set the saved best" |
| Editing a custom layout starts a fresh record for it | Pass | Same file, "editing a custom layout starts a fresh record for it"; renaming it, or toggling a jump's highlight, keeps the record |
| Changing PHYSICS_VERSION archives old records | Pass | Same file, "changing PHYSICS_VERSION archives old records": the old lap moves to `archived` and is no longer the time to beat |
| Timing display doesn't overlap any HUD element in four layouts | Pass | `npm run test:hud` (`scripts/hud-layout-check.mjs`): 1, 2 and 4 riders at 1280 x 720 and a phone at 844 x 390 are all clear, 138 box comparisons in total, including the busiest HUD (below) |
| pace-gate at 0% still matches exactly | Pass | `npm run pace-gate -- --tolerance 0`: 10 of 10 races at 0.000% with 0 crashes and 0 recoveries |

## Commands and results (final commit)

- `npm test`: 142 of 142 tests pass (17 of them in `tests/timing.test.ts`).
- `npm run pace-gate -- --tolerance 0`: 10 of 10 exact. `npm run landing-harness -- --check`: 5 of 5 circuits match.
- `npm run build:report -- --check`: every size budget passes.
- `npm run test:hud`: 4 of 4 layouts clear, in the cloud and on the Mac Studio.

## HUD layouts

Screenshots from the layout check are in the project files folder under `afterglow/m1.1/` (`hud-1-rider.png`, `hud-2-riders.png`, `hud-4-riders.png`, `hud-phone.png`, `results.png`). The check compares the timing panel's box with every other visible HUD element twice per layout: once as the game draws it after a lap, and once with the busiest HUD written in (times of ten minutes or more, a lap result with its difference, a crash notice and a practice target).

## Smoke tests on the Mac Studio (Apple M4 Max)

Run in a separate copy at commit 3eb55e1, the code as merged apart from this write-up and the smoke-test change below. The live game was not touched.

| Test | Result |
| --- | --- |
| `npm test` | 142 of 142 |
| browser-smoke | 19 of 19. 58.2 fps with 1 human and 5 NPCs, 57.6 fps with 4 humans and 4 NPCs |
| touch-smoke | 13 of 13 |
| course-smoke | 5 of 5. 59.2 to 59.6 fps on all five circuits |
| hud-layout-check | 4 of 4 layouts clear, 138 comparisons |
| load-smoke, on a production build | 15 of 15 |
| prod-smoke with a layout export and import | 13 of 13, BUILD 3eb55e1 |

One browser-smoke run failed its "terrain jump" check and passed on the next run. Repeating it showed this is not from this change: 6 of 6 passes on this branch and 5 of 6 on `main` before it. The check read the best jump height once after 10 seconds of riding, which comes out between 0.399 and 0.421 m depending on frame timing, against a mark of 0.4 m. It now keeps riding for up to 10 more seconds until a jump clears the mark. The mark itself is unchanged.

## Code review (B)

An independent review found one blocking bug and nine smaller points. All are fixed in this pull request.

| Finding | Fix |
| --- | --- |
| Blocking: a line crossed while briefly off the track, or during a crash slide, was timed when the rider got back, not when it was crossed. A lap could come out about a second short and be saved as the best | Held-back movement is now followed step by step, so each line is timed at the moment it was passed. Two new tests, which fail on the old code |
| An old tab could put away a best lap saved by a newer physics version | Only laps from an older version are archived; a newer one is left alone |
| A custom layout's record was reset by toggling a jump's highlight or by how the file was written | The record name is made only from what shapes the ground, in a fixed order |
| When the browser refused to store a lap, it was reported as a new best but forgotten | It now counts for the rest of the visit |
| Saving everything from a stale tab could undo another tab's faster lap | The faster lap is kept |
| The rule for which laps may be saved was untested | It is its own function with a test |
| The layout check missed the widest and busiest HUD states | It now measures those too |
| Results marked a shortcut lap as a rider's best or the race's fastest | Only valid laps are marked |
| The time to beat was not refreshed when another tab already held a faster lap | It is reloaded |
| `mac:update` could reinstall packages on every run if npm reported harmless extras | Only a missing or wrong-version package triggers it |

Not changed: all riders on one screen share one saved best per track, and practice laps count. Both are intended.

## Play review (D, about 5 minutes)

On the Mac, ride 3 laps of Saltwind Coast.

1. Are the times easy to read at speed?
2. After reloading the page, is your best lap still shown?

# M0.5 Hosted build — 21 November 2026

The game is hosted at **https://afterglow-supercross.vercel.app**. It is public, served over HTTPS, and Vercel rebuilds it on every merge to `main`. A new browser test drives a production build with a simulated gamepad, and `npm run mac:update` brings the Mac's copy level with `main` in one step. No game code changed.

| Completion box | Result | Evidence |
| --- | --- | --- |
| The hosted link loads over HTTPS with 0 console errors and 0 failed requests | Pass | `scripts/prod-smoke.mjs` run from the MacBook against the hosted link: served over HTTPS, 0 failed requests, 0 console errors, every request on the game's own address. A plain request with no login returns 200, so the link is public |
| A merge to main updates the hosted link automatically | Pass at set-up, confirmed again at merge | The hosted build shows BUILD 745509a, the commit `main` was at when the repository was connected; nobody uploaded it by hand. The merge of this pull request is the second proof: the stamp must change to the merge commit. That result is recorded in the build tracker |
| A simulated gamepad joins and starts a race on the production build | Pass | Same test, on the hosted link and on a local production build: the A button joins as rider 1 and readies, the Menu button starts the race, the gate drops, and the right trigger takes the bike to 24 km/h. The Menu press leaves no stray pause |
| After `npm run mac:update` the Mac and the hosted link show the same build stamp | Waiting on Michael | The command is tested (below), but the Mac Studio that runs the game service is not reachable from here. One command on that Mac; see the play review |
| A layout exported on the Mac address imports and rides on the hosted address | Pass | Same test with `--layout-from`: a layout is named and exported at the MacBook's own address, then imported at the hosted link, where its name appears, a test ride starts under that name, and it is in the hosted link's save |
| One full touch lap on the iPhone from the hosted link | Waiting on Michael | Play review |

## Browser test (`scripts/prod-smoke.mjs`)

Run on the MacBook (real graphics card) at commit f2a2df2:

- Hosted link, `--expect-stamp 745509a --layout-from http://localhost:5182/`: 15 of 15 checks, BUILD 745509a.
- Local production build, `--layout-from local`: 13 of 13 checks.
- `scripts/load-smoke.mjs` (now sharing the same small server): 15 of 15 checks.

The same run in the cloud against the local build also passes 13 of 13. The cloud cannot reach the hosted link (its network blocks it), so the hosted run always comes from a Mac.

The gamepad is a stand-in object returned by the browser's normal gamepad call, so the game's own joining, start and riding code runs unchanged. The test refuses unknown or empty options, so a mistyped command cannot quietly skip a check.

## Mac update command (`npm run mac:update`)

- On a copy that is behind `main`: pulled ba4cc18 to 745509a, reinstalled packages because the lock file had changed, and printed the commit it finished on (run in a scratch copy on Linux, where there is no service to restart).
- On a copy that is not on `main`: stopped with "this copy is on "m0.5-hosted-build", not main" and changed nothing (run on the MacBook).
- Uncommitted edits stop it the same way. Packages are reinstalled only when the lock file changed, because reinstalling takes the running game down until it finishes.

## Regular smoke tests on the MacBook (commit 294d4f9)

| Test | Result |
| --- | --- |
| browser-smoke | 19 of 19. 58.5 fps with 1 human and 5 NPCs, 58.2 fps with 4 humans and 4 NPCs |
| touch-smoke | 13 of 13 |
| course-smoke | 5 of 5. 59.2 to 59.7 fps, 421 geometries and 21 textures on every sample |

CI (type check, 125 tests, build with size budgets, pace gate exact, landing harness) is green on the pull request.

## Code review (B)

An independent review found no blocking bug and seven points, all fixed in f2a2df2:

| Finding | Fix |
| --- | --- |
| An empty or mistyped option skipped its check and still passed | Unknown options and options with no value stop the test |
| README commands for the test did not say Playwright is needed | They now carry the same prefix as the load test |
| `mac:update` reinstalled packages every time, taking the game down, with no advice if that failed | Reinstalls only when the lock file changed, and says how to recover |
| Failed requests and errors were watched on the first page only | Every page the test opens is watched |
| A fixed-length button press could fall between two slow frames | The button is held until the game reacts |
| The small server broke on folder names with spaces and crashed on a malformed address | Both fixed |
| Smaller points: the gate check could pass if the race never started; a timeout printed no summary; HTTPS was demanded of local addresses; a missing service gave a raw error | All fixed |

## Play review (D)

1. On the iPhone, open https://afterglow-supercross.vercel.app, choose iPhone / Touch controls and ride one full lap.
2. On the Mac Studio, in the game folder, run `npm run mac:update`. Reload the Mac's game page and compare the BUILD stamp at the top of the setup screen with the hosted link's. They should match.

# M0.4 Fast load — 21 November 2026

The download drops from 16.95 MB to 3.04 MB. Textures ship as WebP at their original resolution, three.js is its own file, the track editor downloads only when it is opened, and a loading screen shows until every texture is ready. No gameplay change.

| Completion box | Result | Evidence |
| --- | --- | --- |
| Shipped art totals 2.0 MB or less | Pass | 1.63 MB (was 15.56 MB). `npm run build:report -- --check` |
| dist totals 4.0 MB or less | Pass | 3.04 MB (was 16.95 MB). Same command |
| JavaScript to reach the setup screen is 260 KB gzipped or less | Pass | 199.5 KB in 2 files (game 43.5 KB, three.js 156.0 KB). The editor's 10.0 KB arrives later. Same command |
| No .png art requested at runtime and no /art/ absolute path in src (CI check) | Pass | The same command fails CI if src names a `.png` or an absolute `/art/` path, or if the build contains a PNG. The browser test also saw no PNG request |
| Editor code is not downloaded until Edit track is pressed (browser test) | Pass | `scripts/load-smoke.mjs`: no `track-editor` file requested before the press, one after, and the editor opens. CI also fails if the editor is part of the startup JavaScript |
| Loading bar shows until every texture is ready (test with a delayed network) | Pass | `scripts/load-smoke.mjs` holds every texture back and releases them one at a time. The loading screen covered the page before each release and was removed only after the last |
| Pace gate exact | Pass | 10 of 10 races at 0.000% with 0 crashes and 0 recoveries. Landing harness 5 of 5 |
| First load on the iPhone is at least 50% faster than the M0.1 measurement | Waiting on Michael | M0.1 measured 7 to 10 s. Timing comes from the play review below |

## Texture sizes

`node scripts/optimize-art.mjs` converts the PNG originals in `art-source/` to WebP in `public/art/`. Resolution is unchanged.

| Texture | Size | PNG | WebP | Quality |
| --- | --- | --- | --- | --- |
| dusk-sky-v3 | 1774 × 887 | 1.70 MB | 0.12 MB | 90 |
| dirt-clay-v2 | 1254 × 1254 | 4.56 MB | 0.64 MB | 82 |
| crowd-v2 | 2172 × 724 | 3.13 MB | 0.37 MB | 82 |
| jersey-height-v1 | 1254 × 1254 | 4.40 MB | 0.51 MB | 82 |
| Total | | 13.79 MB | 1.63 MB | |

The sky gets a higher quality because smooth gradients show compression first. `dusk-sky-v2.png` was not used by the game; it stays in `art-source/` and is no longer shipped.

## Browser test (`scripts/load-smoke.mjs`, 15 of 15 checks)

Run against the production build, served from a sub-folder address (`/games/afterglow/`) to prove nothing depends on the site root:

- The loading screen covers the page while textures are held back, and the page behind it cannot be used. Textures are released one at a time; after each the test waits for the page to count it (0 of 5 → 1 → 3 → 4) and the loading screen is still up. It is removed only after the last. The bar moves 20% → 36% → 68% → 84%.
- All textures are requested as WebP from the page's own folder. No PNG is requested.
- No track-editor file is requested before Edit track is pressed. After the press it downloads and the editor opens.
- Nothing fails to load, the console has no errors, and every request stays inside the page folder.
- With every texture stalled for ever, the loading screen gives up after its limit (30 s in the game, shortened to 2 s in the test) and the game is usable.
- If a script fails to download, the loading screen says "The game could not start. Reload the page to try again."

## Mac smoke run

MacBook (1440 × 900, Node 22) at the final commit b46e8b1, all on the first run: browser-smoke 19/19 (58.4 fps with 1 human + 5 NPCs, 58.3 fps with 4 humans + 4 NPCs), touch-smoke 13/13, course-smoke 5/5 at 59.3–59.7 fps with 421 geometries and 21 textures steady. The same three also passed at ff8a8c4, before the review fixes.

The production build was also opened there by hand (`vite preview`): it reaches the setup screen with the loading screen gone and no console errors, a race starts, sky, dirt, crowd and jerseys are textured, and Edit track downloads and opens the editor from both the setup screen and the pause menu.

## Independent review (B)

No blocking bug found. Findings and what was done:

| Finding | Action |
| --- | --- |
| If the game failed to start (no WebGL, or a script failed to download) the loading screen stayed on "Loading" for ever | Fixed: it now says the game could not start. Test added |
| A texture download that hangs would hold the loading screen for ever | Fixed: each texture stops being waited for after 30 s and still appears if it arrives later. Test added |
| Controllers and the keyboard could press setup buttons behind the loading screen, so a race could start unseen | Fixed: the page is inert and controller input is ignored until the loading screen has gone. Test added |
| The browser test only looked at the loading screen before each release, so an early removal could slip through | Fixed: it now waits for each texture to be counted and checks afterwards |
| Edit track from the pause menu left the race before the editor had downloaded, so a failed download lost the race | Fixed: the editor downloads first. On failure the race is untouched and the pause and setup screens say so. If the player moves on while it downloads, the editor does not pop open late |
| `build-report --write` wrote the baseline before `--check` could fail | Fixed: it writes last |
| `optimize-art --check` comment promised more than the code does; the three.js rule would not match Windows paths | Fixed both |
| Lossy WebP for the dirt and jersey bump maps needs a human look | Already part of the play review below |
| The loading browser test does not run in CI | Declined for now: CI has no browser installed. The budgets that can be checked without one (sizes, no PNG, editor split out) do run in CI |

## How "no gameplay change" was checked

- **Page HTML at nine points** of a scripted session matches the pre-M0.4 build, and every rider's final position and the race time match to full precision. The one difference: the editor's empty placeholder element is no longer in the page until the editor is first opened.
- **Pace gate and landing harness** exact, as above.

## What else changed

- All texture loading goes through `src/assets.ts`, which builds addresses from the page's own location (`BASE_URL`), and the build uses relative addresses throughout (`base: './'`).
- If the editor's download fails (offline), the setup screen says so and the next press tries again.
- New dev dependency: `sharp` 0.35.5, used only by `scripts/optimize-art.mjs`.

## Play review (D, about 5 minutes)

Before-and-after screenshots of the grid, a jump and a berm were captured from the same simulated moment at 2560 × 1440 (software renderer). Average pixel difference: 2.5, 3.5 and 4.7 out of 255. Question: can you see any loss of quality in the sky, dirt, crowd or jersey? Then time the first load on the iPhone again (M0.1: 7 to 10 s).

# M0.3 Session, save and seeded random — 21 November 2026

The race flow moves out of the browser file into a `RaceSession` class that takes its clock, input and screen from outside, so whole races now run in tests. A versioned save replaces the two separate storage keys. `PHYSICS_VERSION = 1` and a seeded random generator are in place for later milestones. No gameplay change.

| Completion box | Result | Evidence |
| --- | --- | --- |
| 12 or more new session tests: setup to countdown to racing to results, pause and resume, restart, pause on controller disconnect, the 60-second finish timeout, practice never ending | Pass | 17 tests in `tests/session.test.ts`. Each named case has its own test, and the races in them are real: the test rides a full lap on Dusk Valley with the physics running |
| Save tests: both legacy keys, corrupt data gives defaults, a newer version is left untouched, round trip | Pass | 12 tests in `tests/save.test.ts` |
| Seeded random tests: same seed gives the same sequence, different seeds differ | Pass | 5 tests in `tests/rng.test.ts`, including three pinned values so the sequence can never change unnoticed |
| 104 or more tests in total | Pass | 125 of 125 pass (91 before) |
| Pace gate exact | Pass | 10 of 10 races at 0.000% with 0 crashes and 0 recoveries. Landing harness: 5 of 5 circuits match |
| browser-smoke, touch-smoke and course-smoke pass on the Mac | Pass | Run on the MacBook (1440×900, Node 22) at the final commit 42e7a93, all on the first run. browser-smoke 19/19: 58.4 fps with 1 human + 5 NPCs and 58.3 fps with 4 humans + 4 NPCs. touch-smoke 13/13. course-smoke 5/5 at 59.7–59.9 fps on every course, 421–422 geometries and 21 textures across four course changes. The same three also passed at fc16371, before the review fixes |

## How "no gameplay change" was checked

- **Page HTML at nine points** of a scripted session is identical before and after, and so is every rider's final position and the race time to full precision (119.20000000004093 s). Same nine points as M0.2.
- **Pace gate and landing harness** are exact, as above. They use the physics directly, so this shows the physics files are untouched; the page comparison covers the race flow around them.
- **`RaceSession.step` is the old `step` function** with its variables moved onto the class. Sounds, countdown text, the pause menu and the results table are now callbacks, called in the same order as before.

## What the save does

- One key, `afterglow.save`, holds `{version, settings, layouts, records, career}`. Records and career are empty until the milestones that use them.
- **First run after this update:** there is no save yet, so the power-slide setting is read from `afterglow.slide-aggression.v1` and custom layouts from `afterglow.track-layouts.v1`. Checked in a real browser with both keys seeded: the slider showed the stored 35%, the stored custom layout loaded, and after a change the new save held both while the two old keys were byte-for-byte unchanged.
- **The old keys are never written or deleted**, so an older build still finds its data.
- **A damaged save** falls back to defaults (plus the old keys). On the next change a copy of the damaged text is set aside under `afterglow.save.damaged`, then it is replaced. Damaged parts of an otherwise good save are replaced one by one.
- **A save from a newer build** is never overwritten. This build uses defaults and the old keys. A settings change lasts for that visit only, and the editor says a layout could not be saved.
- **Blocked storage** (private windows): the game runs and nothing is kept. The editor says a layout could not be saved, as it did before.
- **Two tabs:** every change re-reads the save first and alters only its own part, so tabs do not overwrite each other, and anything in the save this build does not recognise is kept.
- **An older build, or a tab still running one,** keeps its own keys and does not see changes made in the new save.

## Independent review (B)

The reviewer compared the old and new race flow line by line and found no player-visible difference. Findings and what was done:

| Finding | Action |
| --- | --- |
| Two tabs could overwrite each other's changes, because each wrote its whole copy from page load | Fixed: each change re-reads the save and alters only its part. Test added |
| Parts of a save this build does not recognise were dropped on the next write | Fixed: they are kept. Test added |
| A damaged save was replaced with no copy kept | Fixed: a copy is set aside first. Test added |
| With blocked storage or a newer save, the editor closed as if the layout was saved | Fixed: saving throws, so the editor shows its "could not save" message. Tests changed to match |
| `Rng.int` could return one past the top with very large bounds (about 1 in 4 billion) | Fixed with a clamp. `int` now also rejects fractions and reversed bounds. Tests added |
| `pick` and `chance` tests were thin | Tests strengthened |
| `endRace` sets the phase before hiding touch controls (was after); lap count and difficulty are only stored once the device check passes | Declined: nothing reads those values in between |
| Review-mode switches and the browser glue in session.ts have no unit tests | Declined for this milestone: they need a browser. The page comparison and the three smoke scripts cover them |

## Noticed, not changed

The countdown shows "4" for its first 0.8 seconds (it runs 3.8 s and rounds up) before 3, 2, 1. The beeps are on 3, 2 and 1 only. This is how the game already behaved, so it is kept and the test records it.

## Where the code went

| File | Lines | What it holds |
| --- | --- | --- |
| src/game/race-session.ts | 204 | Phases, countdown, pause, controller-disconnect pause, finish rules, the fixed-step clock |
| src/game/session.ts | 801 | The browser around it: page, menus, controller joins, rendering, dev hooks (`window.__game` unchanged) |
| src/save.ts | 162 | Versioned save and the legacy read |
| src/rng.ts | 49 | Seeded random numbers |

## Play review (D, about 2 minutes)

A custom layout saved before this update still loads, and the power-slide setting is where you left it.

# M0.2 Reformat and split main.ts — 12 November 2026

Prettier 3.9.10 formats `src`, `tests` and `scripts` in one commit (cfab1de, listed in `.git-blame-ignore-revs`). Then main.ts is split into modules by moving code, not rewriting it. CI now runs `format:check` and `lint:lines`.

| Completion box | Result | Evidence |
| --- | --- | --- |
| main.ts is 120 lines or fewer | Pass | 10 lines: fonts, styles and `import './game/session'` |
| No line in src/ is over 140 characters (CI check) | Pass | `npm run lint:lines`, now a CI step |
| `format:check` passes in CI | Pass | `npm run format:check`, now a CI step |
| All 86+ tests pass with no test logic changed | Pass | 91 of 91 pass. Re-printing every test and script file with esbuild gives identical code before and after the format commit, apart from one object key in `scripts/controller-plugin.ts` that lost its quotes (`'Connection'` became `Connection`). |
| Pace gate exact | Pass | 10 of 10 races at 0.000% with 0 crashes and 0 recoveries |
| Production JS within 2% of baseline | Pass | 760.03 KB (206.12 KB gzip) against 758.55 KB, +0.2% (this includes smooth rendering from PR #3) |
| browser-smoke, touch-smoke and course-smoke pass on the Mac | Pass | Run on the MacBook (Apple M6, ANGLE Metal, 1440×900), Node 22, at 9fcc0e8 with PR #7. browser-smoke passed 19/19 checks on both runs: 58.5 / 58.3 fps with 1 human + 5 NPCs and 58.3 / 57.7 fps with 4 humans + 4 NPCs. touch-smoke passed 13/13. course-smoke passed 5/5 at 59.6–59.9 fps on every course, with 421 geometries steady. |

## Smoke run found an older bug (fixed in PR #7)

browser-smoke stage 4 ("gamepad join reaches four humans") failed on main. It also failed the same way on 9ad7310, before M0.2. The cause: after a race with several riders, lowering HUMAN RIDERS left those pads assigned and ready in hidden slots, so pressing A on them was ignored. PR #7 limits the lookup to visible slots. After that, all three smoke scripts pass.

## How "no behaviour change" was checked

- **Built JS after the format commit** is byte-identical to the build before it, apart from the build stamp.
- **Page HTML at nine points** of a scripted session is identical before and after the split, and so is every rider's final position and the race time to full precision. The nine points are: setup, a second course, countdown, racing, paused, results after a full 1-lap race, practice setup, practice and the track editor.
- **Every shader the GPU compiled** in a headless run (54 programs, including bloom and ambient occlusion) is identical before and after. The sky shader didn't compile in that short run, so its source text was compared directly instead, and it is also identical.
- **Long strings** are split into concatenated pieces (`'abc' + 'def'`). The splitting script checks that the pieces rejoin to the original text.
- **Nine long `${...}` expressions** were moved into named local values: two in hud.ts, one in setup-screen.ts, four in track-editor.ts and two in track-preview.ts.
- **Moved functions** that used to read main.ts variables now receive them as parameters (`HudContext`, `RenderContext`). Their bodies are otherwise unchanged.

## Where the code went

| File | Lines | What it holds |
| --- | --- | --- |
| src/main.ts | 10 | Entry point |
| src/game/session.ts | 906 | Race state, fixed-step loop, setup/pause/results flow, menus, controller joins, dev hooks (`window.__game` unchanged) |
| src/ui/setup-screen.ts | 154 | Page and setup markup, device slots, NPC options, controller status text |
| src/ui/pause-menu.ts, results-screen.ts, ride-settings.ts, dom.ts | 99 | Pause and results markup, ranking, shared settings controls, DOM helpers |
| src/ui/hud.ts | 202 | Race chrome, split-screen viewports, rider panels, mini map |
| src/render/renderer.ts | 99 | Renderer setup, resize and per-viewport drawing |

session.ts is still large because it owns the shared race state. Shrinking it further would mean changing how that state is passed around, which is more than a move. That belongs in a later milestone.

## Play review (D, about 5 minutes, on the Mac)

Xbox join, race one lap, pause and resume, editor move and save, test ride, iPhone touch lap.

# Smooth rendering between physics steps — 12 November 2026

Reported on 11 November: on Michael's MacBook the game read 60 fps on average (old build, served from the Mac Studio over Tailscale) but looked "very stuttery". Cause: physics runs at a fixed 1/120 s step and frames drew the raw physics state, so frames that ran an uneven number of steps jumped. Fix: riders and chase cameras are drawn between their last two physics poses (`src/render-interp.ts`). Physics is unchanged: `npm run pace-gate -- --tolerance 0` 10/10 exact, `npm run landing-harness -- --check` 5/5.

Play test, MacBook (Chrome, local dev server on the `smooth-rendering` branch, Dusk Valley, `?review=1`, Grid then Run): **120.0 fps, slowest 1% 9.4 ms, 0.0% uneven frames**, 761 draws per view. Michael: "it was much smoother".

Caveat: this run hit 120 fps, where each frame runs exactly one physics step, so it doesn't by itself separate the fix from the higher refresh rate. The earlier 60 fps run went over Tailscale, and its browser wasn't recorded. A 60 Hz run of this branch would isolate the fix.

---

# M0.1 Baseline and safety net — 11 November 2026

Build plan v2, Stage 0, milestone M0.1. No gameplay change. Measured in the cloud build environment (Node 22.23.4, Linux) on the commit this section ships in.

| Completion box | Measured | Command | Result |
| --- | --- | --- | --- |
| CI runs on every pull request and a failing test blocks the merge | Workflow `.github/workflows/ci.yml` runs on `pull_request` and on pushes to `main`. The repository was made public on 11 November 2026 so that a branch ruleset ("main", active) can require the check `Type check, tests, build, pace gate`. Proof: temporary PR #2 added a deliberately failing test; CI failed (run 42961149538) and GitHub reported the PR's merge state as `blocked`. PR #2 was closed unmerged | `gh api repos/.../pulls/2 --jq .mergeable_state` → `blocked` | Pass |
| All 86 existing tests pass in CI | 86 pass, 0 fail, about 9 s locally | `npm test` | Pass |
| pace-gate at 0% tolerance reproduces all ten baseline times, 0 crashes, 0 recoveries | 10/10 races exact, 0 crashes, 0 recoveries (table below) | `npm run pace-gate -- --tolerance 0` | Pass |
| landing-harness reproduces the baseline pitch gap (0.03 to 0.12%) | 0.09 / 0.03 / 0.12 / 0.03 / 0.06% (table below) | `npm run landing-harness -- --check` | Pass |
| baselines/build.json records 758.55 KB JS, 205.40 KB gzipped, and the dist/ total | 758.55 KB, 205.40 KB gzipped, dist/ 16,948,080 bytes (16.95 MB), art 15.56 MB, measured on commit 038508b before any change | `node scripts/build-report.mjs --write` | Pass |
| The setup screen shows the build stamp | `BUILD <short hash>` in the setup header, visible without scrolling at 1440 × 900 and at 844 × 390 (iPhone landscape). A `+` suffix means uncommitted local edits | Playwright against `vite preview` | Pass |
| Frame rate and load time on the Mac and the iPhone are recorded here | Measured by Michael on 11 and 12 November over Tailscale from another network (details below). iPhone: about 53 fps, first load 7 to 10 s. MacBook: 60 fps average but visibly stuttery. Mac Studio fps not yet measured | `?review=1`, Grid then Run; stopwatch | Pass. Michael chose on 12 November to count the MacBook now and add the Mac Studio as an extra row when he is next at it (box change approved under rule 1) |

## Pace gate: AI race winner, 3 laps, 4 NPC riders

| Circuit | Club (s) | Expert (s) | Plan baseline club / expert |
| --- | --- | --- | --- |
| Dusk Valley | 288.833 | 273.733 | 288.8 / 273.7 |
| Red Mesa | 190.442 | 176.583 | 190.4 / 176.6 |
| Pine Summit | 185.467 | 170.200 | 185.5 / 170.2 |
| Saltwind Coast | 158.050 | 144.650 | 158.1 / 144.7 |
| Iron Quarry | 201.408 | 187.058 | 201.4 / 187.1 |

All ten races: 4 of 4 finishers, 0 crashes, 0 recoveries. The committed `baselines/pace.json` was generated from the unchanged physics and agrees with the plan's independently measured table to its 0.1 s rounding. "Club" is the default NPC pace (internal pace factor 0.91).

## Landing harness: one rider, 3 laps, matching pitch vs pitch forced to zero

| Circuit | Matching (s) | No pitch (s) | Gap |
| --- | --- | --- | --- |
| Dusk Valley | 290.04 | 290.29 | 0.09% |
| Red Mesa | 190.18 | 190.23 | 0.03% |
| Pine Summit | 186.19 | 186.41 | 0.12% |
| Saltwind Coast | 158.41 | 158.46 | 0.03% |
| Iron Quarry | 201.57 | 201.68 | 0.06% |

0 crashes in all ten runs. Recorded in `baselines/landing.json`. M1.2 is expected to raise these gaps on purpose and will update that file with sign-off.

## Build size after this change

The build stamp adds about 0.1 KB of JavaScript (758.66 KB, 205.45 KB gzipped on this branch, locally and in CI; the exact figure moves by a few bytes with the commit hash). `baselines/build.json` keeps the pre-change numbers as the reference for later budgets.

## Device measurements (play review D)

| Device | Build | How reached | fps (average) | First load | Notes |
| --- | --- | --- | --- | --- | --- |
| iPhone | 038508b (Mac Studio dev server) | Tailscale, another network | about 53 | not timed | Looked smoother than the MacBook |
| iPhone | Dev server over Tailscale, another network (by elimination the MacBook's `smooth-rendering` copy on port 5180; not confirmed) | Tailscale | not read | 7 to 10 s by count | Dev-server load: about 56 separate module requests. M0.4 should re-time under the same conditions |
| MacBook (Chrome) | 038508b (Mac Studio dev server) | Tailscale, another network | 60 | not timed | "Not playable, very stuttery": fixed-step judder, see PR #3 |
| MacBook (Chrome) | `smooth-rendering` (PR #3), local | localhost | 120 | not timed | Slowest 1% 9.4 ms, 0.0% uneven frames, "much smoother" |
| Mac Studio | none yet | none yet | not measured | not timed | Michael has no physical access yet |

## Original instructions for the play review (D, about 5 minutes)

On the Mac (dev server, which is how the Mac service runs) and on the iPhone: open the game with `?review=1`, press Grid then Run, and read the frame rate the review panel shows. Time the first load on the iPhone with a stopwatch. The numbers go in the last row of the table above.

---

# Physical Xbox menu and editor verification — 23 October 2026

Verified with the user's Bluetooth Xbox Wireless Controller through the actual macOS controller feed in a separate 127.0.0.1 game session, without the simulated controller fixture.

- A assigned Player 1; two D-pad Up taps focused Ready.
- Seven further Up taps and A opened the editor; RB selected O2.
- Y marked O2 for test rides. Right-stick up/down input was received; opposing movement returned the obstacle to its starting station.
- X switched to turns, RB selected T2, and right-stick up moved it approximately 5 m north/south. The user confirmed they intentionally pushed upward; no axis-mapping fault was found.
- D-pad navigation changed T2's berm from Automatic to Low / 0.75 m, with matching inspector and live 3D preview. A further numeric adjustment changed height to 0.80 m.
- B focused Discard & close; A closed the unsaved test draft. Menu started the race, then paused it. The physical feed recorded B, and the user confirmed it resumed correctly. Subsequent throttle and Menu input were also captured.

No browser errors or warnings were recorded. Saved layouts were not modified. Screenshots: `output/xbox-physical-setup.png`, `output/xbox-physical-editor.png`. Input trace: `output/xbox-physical-menu-input.jsonl`. Capture stopped after the test. These checks cover the exercised menu/editor flows; file dialogs, every editor command, and every controller combination were not exhaustively retested on hardware. No code changes were necessary.

---

# Xbox start-screen, menu and editor navigation — 23 October 2026

Added a shared controller menu sampler for browser and native Xbox pads, with dominant-axis stick navigation, D-pad mapping, repeat delays and edge-only confirm/back/start. Menus now navigate actual UI controls and dispatch their existing handlers, preserve focus through rebuilt inspector fields, and visibly outline focus. The first A press joins/readies the rider without also activating a menu item; subsequent A presses operate menus. Riding button edges are consumed across menu transitions to prevent accidental reset/pause. Local Mac controller input starts automatically; hidden tabs do not operate menus.

Track editor supports LB/RB object selection, X object-kind switching, Y test highlights, right-stick movement with LT fine/RT fast increments, numeric/dropdown edits, insertion, undo, preview controls and save/test ride actions. B focuses the discard button rather than immediately losing a draft; Menu focuses test ride. Text entry and native file dialogs still use their normal controls.

**86 tests pass; production build passes** (existing bundle-size warning only). New tests cover standard native/browser mappings, deadzones/dominant axis, repeat/edge handling, disconnects, sparse pad indices, modifiers and held buttons across context changes. Logs: `output/controller-menu-tests.log`, `output/controller-menu-build.log`.

Browser verification used the visible dev-only simulated Xbox panel on isolated 127.0.0.1 storage. Verified A joins without starting; D-pad changes NPC pace; A opens editor; RB selects O2; right stick moves it 248→249 m; Y marks it; X selects turns; right stick moves T2; D-pad changes berm to 0.75 m and numeric height to 0.8 m; B/A discards only the test draft; Menu starts/pauses; pause slider changes 100→110→100%; B resumes without recovery; controller toolbar inserts a 24th obstacle and 51st turn. No browser errors/warnings. Screenshot: `output/xbox-menu-editor.png`. Native feed detected the user's Xbox, but no physical controller gesture was sampled in this turn. Saved user layouts were not modified.

---

# Local wreck recovery and forgiving track exits — 23 October 2026

Crashes now remount where the wreck settles, with nearby lane clearance and track-edge placement for off-track wrecks. Short excursions retain departure credit and are credited on re-entry up to 30 m of net forward course travel. Longer shortcuts automatically restore the original departure position and prior progress. Crashing and re-entering ahead cannot clear an outstanding shortcut. Removed checkpoint-reset handling and updated recovery HUD/instructions.

**81 tests pass; production build passes.** Coverage includes local wreck placement, occupied-lane avoidance, minor off-track crashes, forgiven exits, automatic shortcut returns, crash/shortcut interaction, timing-plane and finish-seam crossings, reverse travel, and multi-course NPC races. Two jump fixtures now seed their mid-course route history instead of teleporting a start-grid progress record.

Browser crash simulation verified AWKWARD LANDING followed by REMOUNTING AT WRECK in Double Alley; no browser errors/warnings. Screenshot: `output/wreck-remount.png`. Logs: `output/wreck-recovery-tests.log`, `output/wreck-recovery-build.log`.

---

# Stronger braking and brake slides — 23 October 2026

Ground braking increased from 24 to 36 m/s² before drag (+50%), with stronger fork compression and progressive nose dive. Steering plus brake now initiates a human rider brake slide without throttle or a downward pitch gesture. Brake pressure adds up to 65% to slip/pivot strength; the existing aggression setting scales both throttle and brake slides. The rear-wheel animation slows under braking instead of spinning faster. Straight braking does not initiate a slide; NPCs retain their planned grip trajectory. Air-brake nose torque remains unchanged. The live HUD identifies BRAKE SLIDE.

**73 tests pass; production build passes** (existing bundle-size warning only). Added regression coverage for stronger left/right slip and yaw, front loading, analog brake pressure, aggression scaling/off, straight braking, settling at rest, and airborne speed/yaw preservation. A flat 30 m/s stopping test confirms the new stopping distance is less than 75% of the previous model's. Existing all-course NPC, crash, editor and controller tests pass. Logs: `output/brake-slide-tests.log`, `output/brake-slide-build.log`.

Browser verification on isolated 127.0.0.1 practice: keyboard S + A after acceleration produced BRAKE SLIDE at 50 km/h with visible lean and front load. No browser errors/warnings. Screenshot: `output/brake-slide.png`. No physical Xbox input was sampled; mapped Xbox LT/left-stick combinations are exercised by the tests. Persistent launchAgent verified running on port 5173.

---

# Adjustable power-slide aggression — 23 October 2026

Added synchronized setup/pause sliders from 0–200%, step 10%, default 100%. The value scales rear-slip angle and extra yaw response; zero disables slide activation, and an existing slide smoothly settles when switched off. Human riders receive the selected value each physics step. Air handling and normal steering remain unchanged. The browser-local preference is persisted with safe defaults for unavailable or invalid storage.

**70 tests pass; production build passes.** New tests verify monotonic slip/pivot scaling at 0/50/100/150/200%, zero disabling activation, mid-slide adjustment without rider reset, identical airborne handling, and persisted/default/clamped settings. Browser check on isolated 127.0.0.1: setup 150% appeared in pause; pause Off persisted through reload back into setup. Restored test origin to 100%. No browser errors/warnings. Screenshot: `output/power-slide-setting.png`. Logs: `output/slide-setting-tests.log`, `output/slide-setting-build.log`.

---

# Progressive corner power slide — 23 October 2026

Rolling the left stick from horizontal steering into the lower-left/lower-right quadrant under throttle now engages a grounded power slide. Steering magnitude, downward deflection, throttle and speed scale the effect; braking suppresses it. The bike yaws faster than its travel direction, with signed rear slip, forward pitch load, lean, countersteering, rear wheel spin and stronger roost. Gesture release restores grip progressively. Airborne steering/pitch retain their previous behaviour; launch, crashes and recovery clear slide state. Pair-contact closing speed uses the actual slip-adjusted travel direction. HUD and setup controls describe the gesture.

**67 tests pass; production build passes.** Added tests cover both turn directions, simultaneous Xbox stick/trigger mapping, tighter pivot, actual travel/body yaw separation, nose dip, symmetric slip, deadzones and activation gates, grip recovery, crash/reset cleanup, and unaffected airborne pitch/yaw. Logs: `output/power-slide-tests.log`, `output/power-slide-build.log`.

Browser check on the original circuit in a temporary 127.0.0.1 practice session: keyboard W + A + E exercised the same ground control values, producing a visible POWER SLIDE HUD, forward rider posture and yaw/lean at 74 km/h. Screenshot: `output/power-slide.png`. Browser errors/warnings: none. No physical Xbox gesture was sampled in this turn; controller mapping is covered by automated tests. No saved layouts were changed.

---

# Left-stick gamepad steering and pitch — 23 October 2026

Gamepads now use left-stick X for steering and left-stick Y for nose dip/pull: forward lowers the nose, back raises it. Right-stick and LB pitch mappings were removed. RT/LT throttle/brake and keyboard/touch mappings remain unchanged. Setup instructions, airborne HUD hints, README and the existing course smoke script were updated.

63 tests and the production build pass. Regression coverage verifies simultaneous steering/pitch/throttle, analog response, both-axis deadzones, ignored right-stick/LB input, missing-axis neutrality, native macOS controller routing, and real double/triple takeoff nose dips driven through the new gamepad mapping. Logs: `output/left-stick-tests.log`, `output/left-stick-build.log`. No physical-controller session was performed in this turn.

---

# Per-turn berm heights — 23 October 2026

Added Automatic, Flat, Low (0.75 m), Medium (1.5 m), High (3 m), and custom 0–5 m bank heights per turn. Curvature selects the outside edge; a cosine blend tapers each override to the original banking at the neighbouring segment midpoints, including the lap seam. Defaults preserve existing tracks. Turn metadata follows insertion/deletion and round-trips through storage and JSON. Live preview labels and the new turn cross-section update with edits. Selection ribbons now sample across the bank instead of spanning it with one flat strip.

**63 tests pass; production build passes.** New tests verify requested outside-edge heights, unchanged center/inside and unrelated turns, smooth transitions and lap seam, finite preview geometry, persistence, legacy loading and malformed-height rejection. Logs: `output/berm-tests.log`, `output/berm-build.log`.

Browser checks on isolated 127.0.0.1 storage: low preset produces a valid 0.75 m input; flat and custom 3.25 m update the surface/status; saved custom height survives reload. Deleting T4 renumbers the berm-bearing T5 to T4 with its 3.25 m setting intact; undo restores T5. No browser errors/warnings. Screenshot: `output/editor-berm-heights.png`. This turn checked shared surface geometry and editor behaviour; it did not perform a full manual lap on every berm height.

---

# Selectable editor features and marked test rides — 23 October 2026

Added a checkered start line and direction arrow, numbered obstacle/turn map markers, matching 3D labels and surface highlights, per-obstacle replacement presets, edge-to-edge previous/next spacing, and saved practice highlight flags. Doubles/triples/whoops generate physical grouped mounds; selection refers to the logical obstacle rather than the expanded mound index. Legacy v1 layouts remain valid. Camera focus follows new selections and replacement types. Center-marker dragging preserves the grab offset.

**60 tests pass; production build passes.** Added regression coverage for circular neighbour spacing, movement without changing neighbours, impossible gaps, grouped geometry and finish-seam ramps, grouped round-trip serialization, persisted highlight flags, and invalid or excessive group settings. Existing geometry, preview, race, input and physics tests still pass. Logs: `output/obstacle-editor-tests.log`, `output/obstacle-editor-build.log`.

Browser verification used 127.0.0.1 with separate origin storage, leaving the user's localhost layouts unchanged. Replaced O1 with a triple, marked it, set the gap before O2 to 100 m (O1 moved from 10 to 50 m and opposite gap became 272.3 m), selected T5 directly on the map and moved its x coordinate to −96 m, observed the matching 3D curve and label, saved and reloaded the draft. Dragging O1's center marker by 10 pixels moved its start from 50 to 60.3 m without snapping; Undo restored it. Test ride displayed O1/TRIPLE signage, colored surface, minimap highlight and distance/ON OBSTACLE HUD. Switching to Race Night removed the test aids. Browser warnings/errors: none. Mobile gestures were not separately tested in this turn.

Screenshots: `output/editor-obstacle-selection.png`, `output/editor-obstacle-spacing.png`, `output/editor-turn-selection.png`, `output/editor-test-ride-markers.png`.

---

# Live 3D editor preview — 23 October 2026

Added a simultaneous 3D surface view alongside the overhead editor. Jump/turn dragging batches live rebuilds at 60 ms intervals and commits the latest position immediately on release; number edits, undo/redo, reset and imported drafts feed the same path. The preview samples the actual race height function and uses the existing clay material, course elevation and berm banking. Its coarser 1.5 m × 12-lane mesh has less than a quarter of the race mesh's vertex count. Stadium scenery is omitted for editing clarity and responsiveness.

Orbit, pan, zoom, focus-selected, side view and whole-track cameras work independently of the map. Close/reopen cancels pending rebuilds and render frames, disconnects resize/control listeners, disposes replaced geometries/materials/textures, and releases the preview WebGL context. Main race rendering remains separate. Invalid draft geometry keeps the last valid preview with an explanatory status.

**56 tests pass and production build passes.** New tests verify preview sample positions/heights/normals against the race surface on all five courses, reduced mesh budget, and preview response to unsaved turn/jump edits. Logs: `output/live-preview-tests.log`, `output/live-preview-build.log`.

Browser checks: changed opening jump height from 3.2 to 7 m and verified its 3D side profile; dragged it from 10 to 28.4 m; moved Turn 10 to change lap length from 2568 to 2607 m and observed the new bend in 3D; undo restored the original length. Focus, whole-track and side cameras rendered correctly. Closing and reopening restored the preview; discarding test edits preserved the saved layout. After preview disposal, normal keyboard riding reached 98 km/h with no browser warnings/errors. Final screenshot `output/track-editor-live-3d.png` shows an unsaved 5.5 m preview edit, subsequently discarded. Physical mobile gestures and a device-specific performance benchmark were not performed.

---

# Persistent server and track editor — 23 October 2026

Installed and loaded `~/Library/LaunchAgents/local.afterglow.supercross.plist`, with RunAtLoad and KeepAlive. Vite runs directly under the absolute Node executable on port 5173, independent of a chat-owned shell. Confirmed HTTP 200, deliberately terminated the service's Node process, then observed a new PID, launch count 2 and HTTP 200 without manually starting it. Login startup is configured; the Mac was not rebooted or logged out for this test. Sleep still makes the game unavailable until wake.

Added an overhead track editor for all five courses: place/drag/duplicate/delete jumps, change dimensions and position, drag/add/delete turn points, pan/zoom, undo/redo, original/custom selection, browser-local save/load, JSON backup/import, and immediate test ride. The rendered mesh and physics read the same edited route and jump profiles. Unsupported values are rejected; jump overlap and route crossing diagnostics remain advisory.

**54 tests pass and production build passes.** New tests cover five-course serialization fidelity, actual route/height changes, invalid geometry rejection, overlap across the lap seam, persistent per-course storage/corrupt-data recovery, and a complete validated lap on a reshaped route. Logs: `output/editor-tests.log`, `output/editor-build.log`. The existing bundle-size advisory remains non-fatal.

Browser evidence: placed a 24th jump, dragged it from 64.2 to 77.4 m, moved a turn so lap length changed from 2568 to 2588 m, verified undo/redo, inserted a new turn, duplicated/deleted a jump, and adjusted dimensions to 3.6 m height / 16 m takeoff / 26 m landing. Numeric inputs initially failed to commit in the automated interaction; handling was corrected to update the draft and profile on input, then the exact dimensions were saved and verified after reload. Save & test ride launched the custom route in free practice and keyboard throttle reached 124 km/h with the added jump visible ahead. The saved layout also survived the service restart. No browser errors/warnings were captured in the final editor check. Screenshot: `output/track-editor.png`.

Physical iPhone editor gestures and file import/export dialogs were not tested end-to-end; pointer support and responsive layout are implemented, and imported layout validation/storage behavior have automated coverage. Saves are per browser/origin, not synchronized to other devices. Earlier entries below are historical.

---

# Faster rhythm and crashes — 22 October 2026

Acceleration and speed ceiling increase another **25%** to **23.4375 m/s²** and **50.625 m/s / 182.25 km/h**. Larger, spaced jump combinations replace the old short ramps across all five courses. Every four-rider three-lap course/pace benchmark finishes faster, with zero crashes or checkpoint recoveries across 180 simulated rider-laps. Standard Dusk Valley improves from 350.3 to 298.0 s. Hard rider contact and unsafe landing angle/impact now trigger animated falls, sliding and validated-checkpoint remounts.

**48 tests and the production build pass.** Browser checks confirm landing/contact crash presentation, subsequent remount, and four-view rendering at a sampled 60 fps on this Mac. HDR bloom, depth shading, material reflections, fabric and rider animation bring the subjective visual estimate to **roughly 88%**, approaching the requested 90%; rider sculpting and stadium repetition remain the main gaps. Full benchmark, thresholds, rubric and evidence: `output/art-review/rhythm-and-crash-pass.md`. Earlier entries below are historical.

---

# Speed and further visual refinement — 21 October 2026

Engine acceleration and maximum speed are both increased by **50%** (18.75 m/s², 40.5 m/s / 145.8 km/h). NPC straight speed and braking anticipation are updated. All **42 tests pass**, including the new cap/acceleration and high-speed jump tests. Production build passes. Normal keyboard play reached 96 km/h in the opening jumps; moving four-view rendering sampled 60 fps at 1280×720 on this Mac, with no browser rendering errors. Further art iterations bring the subjective five-category estimate to **roughly 83%**, approaching the requested 85%; rider anatomy/fabric remains the largest gap. See `output/art-review/speed-and-visual-pass.md` for the current rubric and evidence. Earlier entries below are historical.

# Mockup fidelity iteration — 21 October 2026

Completed several actual render comparisons against `b-stylized.png` and `e-split-screen.png`. Current subjective equal-weight estimate: **76%** (roughly 75–78%), compared with 55% before this pass. This is an art-direction estimate, not a pixel-similarity measurement. The detailed rubric, iterations, limitations, original asset provenance and verification are in `output/art-review/report.md`.

Production build passes; 40 tests pass, with both steering/camera tests checked again after the final framing adjustment. Four moving views measured about 60 fps at a 1280×720 browser viewport. Normal keyboard throttle reached 52 km/h in the user's game. Physical iPhone performance remains unverified. The stadium has generated sky/dirt/crowd textures applied to actual geometry; screenshots with the art-review toolbar use simulated rider inputs through the normal physics.

---

# Native Xbox fallback — 21 October 2026

The user confirmed that pressing A in Chrome did not expose the controller. A native macOS GameController probe then recorded actual A presses, full left/right stick movement and right-trigger input while the user operated the Xbox. Hardware and Bluetooth input worked; browser exposure did not.

Added an opt-in development-server SSE connection backed by `scripts/mac-controller.swift`. It maps native axes/buttons to the existing standard gamepad format, uses separate device indices, expires input after 300 ms without updates, and shuts down the helper after the final client disconnects. Only loopback sockets and local Host/Origin combinations are accepted. iPhone mode closes the native connection.

Verified the real endpoint returning Xbox controller samples, then clicked Use controller in the user's in-app browser. The visible UI changed to **Gamepad 1 / Xbox Wireless Controller**, Player 1 ready, with start enabled. The user started racing; a live screenshot shows 54 km/h in Rhythm Five (`output/controller-native-connected.png`). The user subsequently confirmed that the bike responds correctly to the Xbox controller.

**40 tests pass**, including localhost restrictions, foreign-origin denial, native device routing, release on missing input and existing game tests. Production build passes. Live foreign Origin and Host requests both returned HTTP 403. Logs: `output/controller-native-tests.log`, `output/controller-native-build.log`. Physical reconnect and simultaneous multiple native controllers remain unverified. The fallback is specific to macOS local development, not the production static bundle.

---

# Controller connection follow-up — 21 October 2026

The Mac reports an Xbox Wireless Controller connected over Bluetooth Low Energy. At initial inspection the user's in-app game showed no controller option; a direct Chrome tab likewise initially showed no controller. Browser APIs were available and not throwing, but neither had yet exposed a pad. Physical button activation/confirmation is still required; this is not a confirmed hardware fix.

Fixed two setup defects found during inspection: A / × now replaces the solo keyboard assignment with Player 1's controller rather than creating Player 2, and controller joining now works in Free Practice. Disconnected pad button-edge history is removed, and button values are accepted alongside `pressed`. Added Use controller and live browser detection/access status. Right-stick pitch direction is unchanged from the preceding fix.

Production build and all 37 deterministic tests pass, including solo/practice joining, distinct multiplayer slots, device routing and unavailable Gamepad API behavior. Current evidence: `output/controller-tests.log`, `output/controller-build.log`.

---

# Five courses, art pass and reversed right stick — 21 October 2026

**Flow:** choose Circuit and input device in setup → load course-specific geometry/scenery → race using shared terrain physics → finish/results → restart or select another course.

- Production build and TypeScript pass; existing nonfatal bundle-size advisory remains.
- **36 deterministic tests pass.** Each added course has >10 m terrain relief, at least 15 jump profiles, separate track corridors, a continuous finish seam, and four NPCs completing two validated laps with zero recoveries.
- **19 desktop browser checks pass**, including all split-screen layouts, controller routing, finish/results, restart and timeout. One/four-view samples were approximately 59 fps at 1440×900 on the test Mac (other browser checks were running concurrently).
- **13 mobile emulation checks pass**, including explicit iPhone selection, multi-touch gas/steer/nose-down, inversion preferences, pause, rotation and cancellation. Physical iPhone performance remains unverified.
- **Five-course browser flow passes:** all five selections render, finish a validated human lap, display results and restart on the chosen course. Scenery inspected in `output/course-dusk.png`, `course-canyon.png`, `course-alpine.png`, `course-coast.png`, `course-quarry.png`. No browser errors.
- Rebuilding Dusk Valley four times holds graphics resource counts at **340 geometries / 12 textures** after each selection; old scene resources are disposed.
- Gamepad forward/right-stick-up now lowers the nose; pulling back raises it. Actual browser-routed takeoff changed pitch from 0.488 to -0.036 rad on forward input, then to 0.228 rad on backward input. LB remains nose-down. Keyboard and iPhone pitch preferences are unchanged.

## Subjective concept-art comparison

Compared the supplied `b-stylized.png` with the previous `expanded-race.png` and new live gameplay captures. This is an editorial visual estimate, not pixel similarity, a benchmark or a user-study score. Equal-weight rough estimates:

| Aspect | Before | After |
|---|---:|---:|
| Camera framing and HUD composition | 60% | 75% |
| Sunset sky and lighting atmosphere | 35% | 55% |
| Dirt, track surface and barriers | 30% | 45% |
| Rider/bike styling and gear | 40% | 50% |
| Stadium, spectators and backdrop | 35% | 50% |
| Overall rough mean | **40%** | **55%** |

A 15-point increase is approximately 38% relative improvement, exceeding the requested 25% relative target by this subjective rubric. The reference retains much more detailed models, organic surface variation, fabric and cinematic lighting. The playable implementation is still procedural stylized 3D rather than a close photoreal reproduction.

Evidence: `output/scenery-build.log`, `output/scenery-tests.log`, `output/scenery-desktop.log`, `output/scenery-touch.log`, `output/course-verification.json`. The dated entries below describe previous builds.

---

# Expanded circuit and nose control — 20 October 2026

The user flow is pre-race device selection → expanded track and live input → shared bike physics → visible jump/landing and race results. The game is client-side; Vite serves assets and no API/database is involved.

- **Build:** TypeScript and production build pass. Vite reports the existing nonfatal large-chunk advisory.
- **Track:** 2,568.312 m, exactly 9× the original circuit (+800%). 55 jump profiles across doubles, triples, rhythm lanes, dragon back, step-up tables and whoops, with alternating lanes, banked hairpins, a chicane and an outer return. Non-adjacent corridors remain separate; spatial projection checked around the full circuit and both edges.
- **Physics/input:** 31 tests pass. Eight standard NPCs finish three validated laps by 447.08 simulated seconds, two relaxed by 503.05s and two expert by 384.23s, with zero recoveries. Actual double/triple takeoffs respond visibly to a 200ms nose-down input, retain horizontal momentum under air braking, and land with usable speed.
- **Desktop:** 19 browser checks pass, including full expanded-course races, results/restart, all split-screen layouts, gamepad routing and DNF timeout. Approximately 60.00 fps solo and 59.90 fps in four views at 1440×900 on the test Mac. No browser errors.
- **iPhone emulation:** 13 checks pass with real CDP multi-touch. Nose-down works alongside gas/stick and ignores pitch inversion; cancellation releases contacts. Desktop mode still hides all touch controls. Portrait/landscape, pause and restart remain covered. No browser errors.
- **Visual follow-up:** Enlarged the stadium/ground/sky and camera far plane, adapted setup framing and fitted the whole circuit on the minimap. Updated setup/gameplay captures are in `output/expanded-setup.png` and `output/expanded-race.png`.
- **Limits:** Physical iPhone Safari and physical gamepads were not tested. Scripted race verification feeds normal control inputs into physics; it does not substitute for a human handling playtest. The earlier milestone results below describe the old course.

Evidence: `output/expanded-tests.log`, `output/expanded-build.log`, `output/browser-verification.json`, `output/touch-verification.json`, and `output/iphone-nose-down.png`.

---

# Milestone verification — 27 September 2026

Implemented and exercised locally. Controller hardware testing remains unverified; the browser controller checks below use mocked standard Gamepad API objects.

## Acceptance status

| Criterion | Status | Evidence / boundary |
|---|---|---|
| A — Install / launch / build | PASS | Pinned npm lockfile; installation, TypeScript and Vite production build succeed. Local dev and production preview loaded. |
| B — Riding and race loop | PASS, scripted inputs | Browser keyboard throttle, brake, steering, recover, pause; terrain jumps and landings; ordered-gate finish, results, clean restart. Full race driving used simulated control inputs into normal physics. No claim of a manual human endurance playtest. |
| C — Local multiplayer | PASS in simulation; physical pads UNVERIFIED | 1/2/3/4 human layouts, stacked two-player views, three-player information quadrant, zero/nonzero NPCs, four distinct gamepad indices, keyboard + three pads, join/ready and disconnect/reconnect checked. One device did not drive multiple riders. |
| D — NPCs and validation | PASS | All eight NPCs complete three validated laps in fixed-step tests. Tests reject reverse laps, out-of-order/teleport gates and off-track shortcuts, and preserve checkpoint credit on reset. Recovery, collisions and reset delay checked. |
| E — Camera / HUD | PASS at 1440×900 | Actual straight, tabletop/airborne/landing and berm framing inspected. All four HUDs show distinct rider, lap, position and speed. Main numbers remain readable; secondary labels are intentionally small. |
| F — Logic / browser checks | PASS | 19 deterministic tests plus 19 browser checks. Final browser log contains only Vite connection messages, no page errors or application warnings. |
| G — Performance / input reporting | PASS, measured scope | Approximately 60 fps for one and four views on the test machine, as detailed below. Physical controller feel/mapping across hardware remains unverified. |
| H — Gameplay captures | PASS | Captured rendered gameplay and results, not concept art. See `output/`. |

## Measured performance

- Machine: **Apple M4 Max**, arm64, macOS **26.6.2**.
- Browser: **Headless Chrome 153.0.0.0**, ANGLE Metal renderer (Apple M4 Max).
- Canvas: **1440×900 CSS pixels**, device pixel ratio **1**, render scale **100%**.
- One viewport, one human + five NPCs: **60.00 fps** over a 10-second riding sample.
- Four viewports, four humans + four NPCs: **60.00 fps** over a 10-second riding sample.
- An earlier one-view sample measured **59.90 fps** at the same resolution.
- Measurements are requestAnimationFrame intervals, averaged over a rolling maximum of 600 frames. They measure this machine/browser/resolution, not a guarantee for other hardware. Setup offers 75% and 50% render scale for slower devices.

The automated browser uses standard keyboard events and simulated controller state. Automated race driving continuously computes steering/throttle inputs and sends them through shared bike physics. It does not move riders along a prerecorded path, skip timing gates or fabricate finish positions. Some full-race/timeout assertions accelerate simulation between rendered checks. No real gamepad was available for testing. Audio synthesis starts after interaction and runs without browser errors; subjective audio quality was not independently listened to.

## Automated coverage

`npm test` covers:

- Keyboard aliases, gamepad deadzones/triggers, sparse indices, unique device filtering, independent reset/pause edges, and blur cleanup.
- Ordered checkpoints, forward-only finish, reverse traversal, teleports, off-track shortcuts, backtracking, invalid measurements and safe reset.
- Three laps for eight club NPCs (all complete by **55.42 simulated seconds**), two relaxed NPCs (**59.67s**) and two expert NPCs (**56.65s**), with shared movement/collision constraints.
- Real horizontal travel while airborne, gravity-driven landing and suspension compression; grounded collision penalties and clearance when jumping above a rival.
- Recovery at an unoccupied location without advancing validated progress, followed by resumed riding.

`node scripts/browser-smoke.mjs` covers practice, keyboard actions, pause during racing and countdown, finish/results/restart, every viewport count, zero NPC grids, pad routing, disconnect lock and reconnect, all-human three-lap completion, gamepad joining, four-pad mode with unassigned keyboard isolation, and the 60-second DNF timeout. Raw telemetry and logs: `output/browser-verification.json`.

## Captures

- `output/one-player.png` — solo viewport in a six-rider race, airborne through the rhythm lane.
- `output/four-player.png` — four simultaneous viewpoints in an eight-rider race.
- `output/berm-inspection.png` — chase camera and forward track visibility through the sunset berm.
- `output/results.png` — all-human finish and final classification.
- `output/setup.png` — setup screen.

## Implementation limits

This is an arcade milestone: soft course-boundary penalties, simplified bike-to-bike contact and stable upright assistance, with no ragdolls or wheel-by-wheel rigid-body simulation. Scenery uses visibly stylized procedural shapes. NPCs occasionally need checkpoint recovery after congestion or a missed line; expert pace is not guaranteed to win every heat. Shadows come primarily from a shared directional light, while stadium lamps are emissive visuals. No online multiplayer, persistence, career mode, track editor or additional tracks are included.

Production preview was separately checked at port 4173: throttle reached 37 km/h, shared pause worked, no console errors, and the development harness was absent. A final controller count reduction/rejoin check also confirmed no duplicate device assignments. Vite emits a non-fatal size advisory for the roughly 589 kB engine/game JavaScript chunk (153 kB gzip); the production build succeeds.

## iPhone controls follow-up

Added a pre-race **Play on** selector. Mac remains the default; choosing iPhone assigns one touch rider and enables a steering/pitch stick, gas, brake, recover and pause only during that session. No user-agent detection enables controls automatically.

The deterministic suite now has **24 passing tests**, including explicit enablement, pointer ownership, cancellation/clear behavior, input isolation, reset edges and unavailable/denied Gamepad API handling. The mobile browser script verifies **11 interaction checks**, using actual Chromium touch dispatch with simultaneous contacts at 844×390 and 390×844 (DPR 2). It checks that Mac has no overlay, iPhone selection is required, throttle/steering work together, brake/recover work, keyboard input is isolated, pause/rotation release controls, restart retains the selection, and switching back to Mac hides controls. Rotation also checks the canvas/overlay dimensions. Phone captures were visually inspected; no browser errors were reported. **No physical iPhone/Safari testing was performed.**

Evidence: `output/iphone-touch.png`, `output/iphone-portrait.png`, `output/iphone-setup.png`, and `output/touch-verification.json`. Run `npm run test:touch` with the dev server on port 5173. The existing desktop multiplayer browser regression remains available as `npm run test:browser`.

## Regular / Inverted controls follow-up

Corrected human steering to match the rear camera's screen direction: right input now turns screen-right for keyboard, gamepad and regular touch steering. NPC steering stays in its existing world-space convention. The iPhone setup and pause menu now expose independent **Regular / Inverted** steering and air-pitch choices. Regular is the default, and changing preferences clears held touches. The choices stay synchronized and survive race restart without enabling touch controls in Mac mode.

**26 unit/integration tests pass.** The new directional regression projects actual simulated bike movement through the chase camera and verifies screen-left/screen-right for all three human input types. Independent pitch inversion and preference retention are also covered. **12 mobile browser checks pass**, including real multi-touch with both steering modes and setup/pause/restart synchronization. `output/iphone-direction-options.png` shows the new menu. Physical iPhone testing remains unverified.
