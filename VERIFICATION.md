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
