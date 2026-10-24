# Afterglow / Supercross

A playable browser-based, third-person arcade Supercross milestone. Five selectable circuits, led by the 2,568 m dusk stadium (800% longer than the original), sculpted procedural motorcycle/rider, local split screen for 1–4 humans, and up to eight total racers. No online networking or accounts.

## Launch

Tested with Node **22.23.2** and npm **10.9.8** on macOS. Use Node 22.12 or newer.

```sh
git clone https://github.com/butlerbotalfred-beep/afterglow-supercross.git
cd afterglow-supercross
npm ci
npm run dev -- --port 5173
```

Open **http://localhost:5173** in a desktop browser with WebGL2. Select a **Circuit** before racing. Choose **Drop the gate** for the default three-lap race, or **Free practice** for an untimed solo session. The keyboard is assigned and ready by default. The start button waits until each selected human has a unique connected device and is ready.

```sh
npm run build             # TypeScript check and production bundle in dist/
npm run preview -- --port 4173
npm test                  # deterministic race, input and riding tests
node scripts/browser-smoke.mjs  # with the dev server running on 5173
node scripts/course-smoke.mjs   # five-course selection, laps, restart, resource cleanup, left-stick air pitch
```

The browser smoke script uses pinned `agent-browser@0.27.0` via npm, requires its Chrome browser installation, opens an isolated verification session, simulates inputs, and saves captures plus a JSON report in `output/`. If necessary, install its browser with `npm exec --yes --package=agent-browser@0.27.0 -- agent-browser install`. Browser verification is a developer tool, not a dependency for playing.

Fonts and all game content are served locally after installation; the built game makes no external asset requests. Serve `dist/` over HTTP instead of opening `index.html` as a file.

## Automatic server on this Mac

The game is installed as the macOS login service `local.afterglow.supercross`. It starts at login and automatically restarts if the Node process exits, independently of the chat or terminal. It serves the existing local/Tailscale addresses on port 5173. The Mac must be awake and logged in; this does not prevent sleep or provide cloud hosting.

```sh
npm run server:status    # inspect the service
npm run server:restart   # restart deliberately after configuration changes
npm run server:stop      # stop/unload it for this login session
npm run server:install   # install or re-enable the login service
```

Configuration: `~/Library/LaunchAgents/local.afterglow.supercross.plist`. Logs: `~/Library/Logs/Afterglow/server.log` and `server-error.log`. The service uses the current absolute Node and project paths. If either moves, rerun `server:install`. Do not start a second dev server on the same port while this service runs. To permanently remove automatic startup, run `server:stop` and remove that plist.

## Track editor

Choose a circuit in setup, then **Edit track**. The overhead map edits a copy of that course. A checkered start line, START / FINISH label and direction arrow identify the start. Orange O1, O2… markers select obstacles; blue T1, T2… markers select turns. Clicking either focuses and labels the matching feature in 3D. Obstacle markers sit at the middle of their footprint; dragging retains the grab offset. T1 anchors the start/finish.

- **Place obstacle**, then click near the track. Drag an orange marker along the course to move it.
- Edit **position**, **height**, **takeoff length**, **tabletop length**, and **landing length** in the inspector. The side profile updates as you type. Duplicate and delete jumps as needed.
- **Replace obstacle** chooses Single, Tabletop, Roller, Double, Triple or Whoops. Replacements preserve location and the test flag, and reset dimensions to that preset. Double/triple/whoops groups contain 2/3/6 real mounds; their dimension fields apply to each mound, and **Between mounds** adjusts internal spacing.
- **Clear ground spacing** measures from the previous obstacle’s end to this obstacle’s start, and from its end to the next start, along the lap (including across the finish seam). Either field moves the selected obstacle, leaving neighbours fixed and updating the opposite gap. An impossible gap is rejected; shorten an obstacle or move a neighbour to make more room.
- **★ Highlight in test ride** marks any number of obstacles. Saved free-practice rides show colored surface ribbons, matching numbered trackside signs, minimap dots and a distance-to-target HUD. Race Night hides these aids. Flags survive undo/redo, replacement, save/load and JSON export/import.
- Drag blue points to relocate turns. **Add turn point** inserts a point in the nearest route segment; select a point to move it with exact coordinates or delete it. The smooth route and live 3D surface update while you drag. Jumps retain their relative position along the lap while turns change the route length.
- Select a turn and use **Turn berm**: Automatic preserves the original banking; Flat removes it at that point; Low, Medium and High set 0.75, 1.5 and 3 m. **Custom height** allows 0–5 m in 0.05 m steps. The outside edge rises to that bank height and tapers back into surrounding track sections. The inspector shows a cross-section, and both preview and riding physics use the edited surface. Berm settings follow their turn when points move, are inserted or deleted, and persist in saved/exported layouts.
- The **Live 3D preview** beside the map follows the selected jump or turn. Drag in that view to orbit, scroll/pinch to zoom, or right-drag to pan. **Focus selected**, **Whole track**, and **Side view** provide useful camera angles. Selecting a different marker focuses that feature; whole-track mode remains available for overview edits. The preview uses the race surface at a lighter mesh resolution and omits stadium scenery so changes stay responsive. Invalid edits keep the last valid 3D shape visible until corrected.
- Drag empty map space to pan; use zoom and **Fit track** for close editing. Undo/redo retains up to 50 edit snapshots.
- **Save & return** applies your layout to setup. **Save & test ride** opens solo free practice using the edited physics and geometry. Pause → **Edit this track** returns to the editor and ends the current run.
- After reloading, choose **Track layout → My saved layout** to ride or edit it. **Original circuit** remains available. Changing circuits defaults to the original layout for that circuit.

One layout per circuit is saved in browser local storage. Saves are specific to that browser and address: localhost and the Tailscale address have separate storage, and clearing site data removes saves. **Export JSON** makes a portable backup; choose the matching circuit and **Import JSON** to restore it on another device. Imported data is validated before replacing the draft. **Discard & close** drops unsaved changes; **Reset draft to original** is undoable and does not replace your saved layout until you save.

The editor allows up to 120 obstacles (240 individual mounds) and 120 route points, with dimensions bounded to keep the geometry finite. Overlaps, tight-turn jumps and crossing route segments produce warnings. Warnings do not prove a layout is unridable or guarantee it is safe: test the approach speed and nose alignment. There are no bridges, freehand terrain sculpting or automatic guarantees that an arbitrary custom route is easy for NPCs.

## iPhone touch controls

In race setup, choose **Play on → iPhone / Touch controls**, then **Drop the gate**. This explicit choice is required even on an iPhone. **Mac / Keyboard & gamepads** remains the default, with no touch overlay. Return to setup to change modes.

**Touch steering** and **Air pitch** each have **Regular / Inverted** choices in iPhone setup and the pause menu. Regular is the default: left turns left, right turns right, and dragging up lifts the nose. Inverting steering reverses left/right; inverting air pitch makes dragging up lower the nose. These preferences stay selected through pause/resume and restart within the session.

The iPhone option assigns one human rider to touch input; optional NPCs and free practice still work. Landscape is recommended. Hold **GAS** with your right thumb and drag the left stick sideways to steer. Drag the stick up/down to pitch the nose up/down in the air. Hold the dedicated **NOSE DOWN** button to dip the front wheel over doubles/triples; it always lowers the nose regardless of the stick inversion setting. **BRAKE**, **RECOVER**, and **PAUSE** are also on screen. Simultaneous fingers are independent. Pause, focus loss, cancelled gestures and rotation clear held input so throttle cannot remain stuck. Controls are hidden in setup, pause and results.

With Tailscale connected on both devices and this Mac awake/running the dev server, the current phone address is **http://100.96.154.105:5173**. Touch input works without the browser Gamepad API, including HTTP contexts where that API is unavailable. This is a separate local game session on the phone, not remote control of the Mac's race or online multiplayer.

Mobile landscape/portrait rendering and multi-touch events were tested in Chromium emulation. Physical iPhone Safari performance and feel remain unverified. Use the setup render-scale setting if needed.

`npm run test:touch` runs the reproducible mobile interaction check and saves phone-sized captures and `output/touch-verification.json`.

## Xbox on this Mac

If Bluetooth pairing works but the browser cannot see the Xbox, open **http://localhost:5173**, choose **Mac / Keyboard & gamepads**, and click **Use controller**. The local development server starts a small macOS GameController helper and assigns the connected controller to Player 1. The same trigger/stick mapping applies: RT accelerates, LT brakes, left stick sideways steers, pushing it forward dips the nose, and pulling it back lifts the nose.

This fallback requires macOS and the installed Swift command-line tools, and runs only while local tabs request it. It accepts loopback requests only; it does not send the Mac's controller to phones or other computers. iPhone selection stops the fallback. Production builds and remote sessions continue using the normal browser Gamepad API. A disconnected or stale feed releases input and the existing missing-controller check pauses the race. If reconnecting changes the device identifier, return to setup and use the controller again.

## Play

| Action | Keyboard | Standard gamepad |
|---|---|---|
| Throttle | W / Up arrow | Right trigger |
| Brake | S / Down arrow | Left trigger |
| Steer and lean | A D / Left Right arrows | Left stick X |
| Air pitch, nose down / up | Q or Space / E | Left stick forward (up) / left stick back (down) |
| Recover to checkpoint | R | B / east face button |
| Shared pause | Escape / P | Menu / Start |
| Join / ready | Setup buttons | A / south face button |
| Mute | M / sound button | Sound button in UI |

Brake into a berm to load the front and pivot the rear. Carry speed up a jump face, then tap nose down after takeoff and release once the bike matches the downslope. Air braking also dips the nose while preserving horizontal momentum; grounded braking slows the bike. Severe contact and badly aligned or excessively hard landings cause a visible crash, a 2.1-second slide, and a local remount where the wreck settles. Gentle rubbing only costs momentum. Rhythm hints show an approach-speed range; ease off before a combination and match the downslope with nose-down input. Recovery flashes the rider for 1.6 seconds and remounts alongside the wreck, moving sideways or a little backward only when another rider occupies that spot. Off-track wrecks are placed at the nearby track edge. Brief off-track excursions are forgiven when you return within 30 m of forward course progress; timing-plane credit is held until re-entry. Advancing farther outside automatically returns you to the original departure point, retaining all progress earned before leaving. Crashing or re-entering ahead cannot erase that penalty.

Connect gamepads and press a button so the browser exposes them. Up to four standard gamepads, or one keyboard plus three gamepads, can play. Device labels refer to the browser's physical gamepad indices. A device is never assigned to two riders. On a solo keyboard setup, pressing gamepad A / × assigns the controller to Player 1 and marks it ready, including Free Practice. Additional controllers join available/new multiplayer slots. **Use controller** focuses the connection flow, and the status underneath distinguishes detected controllers from an unavailable/blocked browser API. If no controller is visible, click inside the game and press A; pairing in macOS alone does not establish that the browser is receiving input. Use the device selectors to play with four controllers and no keyboard. Disconnecting an assigned controller pauses the whole race; reconnect it and resume, or return to setup. Loss of browser focus also pauses all riders.

One player gets a full viewport; two get stacked views; three/four use a 2×2 grid. The unused three-player quadrant shows race standings. All views share one simulation. Keyboard-only multiple human control is intentionally unsupported.

Sixteen ordered timing gates and forward start/finish crossings validate laps. Shortcuts and reverse crossings cannot award laps. The race ends once every human finishes, or 60 seconds after the first human finishes. The HUD shows the remaining time; all unfinished riders are classified DNF. Finished riders coast under NPC control. Practice continues until you return to setup. Restart clears timing, progress, recovery and results.

## Circuit selection

Choose a circuit in pre-race setup. Each has its own centerline, jump sequence and scenery; selection is retained on restart. Returning to setup and changing circuit rebuilds the environment and releases its previous graphics resources.

| Circuit | Length | Terrain relief (excluding jumps) | Scenery |
|---|---:|---:|---|
| Dusk Valley | 2.57 km | Flat stadium | Sunset clouds, city skyline, crowds, floodlights |
| Red Mesa | 1.98 km | 24 m | Sandstone columns and canyon ridges |
| Pine Summit | 2.20 km | 40 m | Pine forest and mountain slopes |
| Saltwind Coast | 1.80 km | 12 m | Palms, ocean, dunes and headland |
| Iron Quarry | 2.10 km | 25 m | Rock terraces, silos and a crane |

Elevation comes from a continuous world-space surface shared by the bike physics, track mesh and surrounding terrain. Rounded barriers, dirt bump mapping and grooves, improved rider gear, a closer camera and corner HUD panels bring the stadium toward the selected stylized concept. Scenery is procedural, with original generated sky, soil, crowd and fabric textures; all load locally.

**Power-slide aggression** is available under **Controls & ride settings** in setup and directly in the pause menu. It scales rear-wheel slip and extra turn pivot from **0% (off)** through **100% (standard)** to **200% (aggressive)**, in 10% increments. Changes apply immediately to human riders and persist in this browser/address. Both sliders stay synchronized. The setting does not change airborne pitch or normal steering.

The gamepad left stick handles both steering and air pitch: move sideways to steer, push forward to lower the nose, and pull back to raise it. In the air, diagonal movement combines steering and pitch. On the ground, roll from left/right into the lower-left/lower-right quadrant while holding RT to power slide: the nose dips, the rear steps out, and the bike pivots more tightly. More diagonal deflection and throttle increase the power slide. Steering with LT (keyboard S + A/D) now triggers a stronger brake slide, without requiring throttle or a downward stick gesture. Brake pressure progressively increases rear slip and pivot, up to a 65% boost over the power-slide response. Centering the stick and releasing the slide input restores grip. The aggression slider applies to both kinds of slide. Sliding starts above 5 m/s and builds progressively toward 12 m/s. Straight-back and ordinary sideways steering do not trigger it. POWER SLIDE and BRAKE SLIDE HUD cues, forward rider posture, countersteering, rear-wheel spin and stronger dirt spray show the effect. Keyboard W + A/D + E produces the same ground gesture. Ground braking strength is 50% higher (36 m/s² before drag), with stronger front-fork compression and nose dive. Braking slows rear-wheel spin during a slide. Straight-line braking does not initiate a slide, and airborne horizontal speed is unaffected. NPCs retain their planned grip path rather than initiating brake slides. The right stick and LB do not control pitch. Keyboard and the independently configurable iPhone stick retain their existing direction.

## Expanded circuit

The 2.57 km course is exactly nine times the original centerline length: eight alternating lanes, banked hairpins, an S-shaped chicane and a broad outer return. Twenty-three larger jump profiles include doubles, a real triple, alternating rhythm lanes, a dragon back, step-up tabletops and whoops. Main rhythm takeoffs are 34 m apart, with 11 m rises and 19 m downslopes; tabletops reach 4.2 m. Longer transitions replace the old 55 small profiles. Straights leave braking space before corners. The stadium and minimap fit the expanded footprint. Spatial lookup keeps terrain queries local; rendering and collision share the same half-metre track sampling.

## Handling and camera tuning

Primary values live in `src/config.ts`. Units are metres, seconds and radians.

| Setting | Default | Effect |
|---|---:|---|
| Simulation step | 1/120 s | Shared fixed-step physics; accumulated frame time is capped at 0.1 s |
| Acceleration / braking | 23.4375 / 24 m/s² | Throttle and brake response |
| Drag coefficient | 0.34/s | Coast-down and top-end resistance |
| Speed cap | 50.625 m/s (182.25 km/h) | Arcade maximum |
| Steering rate | 1.48 rad/s | Scaled at low speed and to 36% in the air |
| Gravity | 22 m/s² | Short, weighty jumps |
| Track half width | 4.8 m | 9.6 m rideable lane, with soft boundary penalties |
| Recovery delay | 1.6 s | Ghost/flash delay after returning to a validated gate |
| Chase distance | 3.2 m | Adjustable 2.5–6 m in setup and pause |
| Chase height | 1.9 m | Terrain clearance and landing look-ahead in `src/camera.ts` |
| Shake | 0.15 | Adjustable 0–1, including no shake |
| Field of view | 63–68° | Restrained speed increase |

`src/track.ts` controls the centerline, analytic jump profiles and berm banking; the mesh is sampled from that same height function. `src/physics.ts` contains weight, landing and NPC pace tuning. NPCs steer, throttle, brake, jump, collide and validate gates using the same movement logic as humans. They can lose time and recover; they are not position-animated along the circuit.

The camera maintains a stable horizon, smooths heading and position, stays above terrain, and hides an opponent mesh only when it intersects the camera's near region. Render scale (100%, 75%, 50%) is in setup. Pixel ratio is capped at 1.5; one directional shadow map focused around active riders, batched scenery, layered crowd cards and a small dust pool limit rendering cost.

## Project map

- `src/main.ts`: session lifecycle, UI integration and one shared simulation/render loop.
- `src/courses.ts`, `src/scenery.ts`: five course definitions, terrain themes and scenery resource cleanup.
- `src/physics.ts`, `src/track.ts`, `src/race.ts`: movement, terrain and validated race progression.
- `src/input.ts`: isolated keyboard/gamepad/touch routing and edge-triggered actions.
- `src/touch-input.ts`, `src/touch-controls.ts`: multi-touch pointer ownership and the explicitly selected iPhone overlay.
- `src/bike-model.ts`, `src/world.ts`, `src/dust.ts`: procedural visuals and animation.
- `src/camera.ts`, `src/audio.ts`: chase views and synthesized feedback.
- `tests/`: deterministic regression tests; `scripts/browser-smoke.mjs`: actual browser loop verification.
- `ASSETS.md`: attribution; `VERIFICATION.md`: acceptance status and measured limitations.

The dev build exposes `window.__game` for verification controls, stepping and telemetry. This harness is removed from production builds. Automated driving in verification supplies throttle/steer inputs to normal physics; normal human play never uses it.

## Visual comparison pass

The Dusk Valley stadium now uses an original dusk panorama, granular clay and racing ruts, closer grandstands with textured crowds, truss floodlights, sculpted clothing, curved helmet graphics, knobby tires, and soft dust. The chase camera is 3.2 m behind / 1.9 m above the rider by default, with restrained anticipation at ramps. Four-player HUDs emphasize the colored P1–P4 badges.

For reproducible **development-only** visual review, open `http://localhost:5173/?review=1`. Grid, Jump, Berm and Rhythm advance the regular physics with simulated riders to a comparison frame; Four views uses the normal four-camera render. Run / freeze measures moving performance. The review toolbar is absent from the normal game and production build. Screenshots bearing its label show simulated controls, not four physical controller tests.

Visual fidelity is a subjective estimate against the selected stadium concepts; it is not a pixel metric. See `output/art-review/report.md` for the category scores, limitations and evidence. Original texture sources are documented in `ASSETS.md`.

The October 21 speed pass raises engine acceleration and the speed ceiling by exactly 50%. NPC straight-line targets also rise by 50%; they inspect the braking distance before corners. Actual speeds vary with drag, jumps, landings and cornering. The later visual review is in `output/art-review/speed-and-visual-pass.md`.

## Faster rhythm and crash pass — 22 October 2026

Acceleration and the speed ceiling rise a further **25%** from the previous build. All five jump layouts are spaced for the new approach speeds, with terrain-specific takeoff tuning in Iron Quarry. Fifteen four-rider, three-lap simulations across all courses and difficulties finish faster than their saved baselines, with zero crashes or checkpoint recoveries. Standard Dusk Valley completion improves from 350.3 to 298.0 seconds (14.9%). See `output/art-review/rhythm-and-crash-pass.md` for the full comparison.

Contact crashes use relative closing speed above 9 m/s, not absolute riding speed. Landing checks consider impact normal to the surface and bike alignment: impact above 21 m/s, or pitch error above 0.95 radians with a substantial impact, can cause a crash. Excessive sideways lean under impact also crashes. Fallen riders slide without earning checkpoint progress and cannot bypass remount time by pressing recover. This remains assisted arcade physics with animated falls, not a full ragdoll or wheel-by-wheel rigid-body simulation.

The renderer now uses shared HDR bloom, depth shading, environment reflections and viewport-aware compositing. Rider movement includes braking compression, weight shifts, airborne posture and landing crouch. The review toolbar additionally provides real-physics **Crash landing** and **Rider contact** scenarios. Run `npx tsx scripts/pace-report.ts --all` to reproduce the course/pace report.


### Xbox menu and editor controls

The local Mac controller bridge now starts automatically on page load. Press A once to assign the Xbox to a rider; that first press does not also activate a menu item. Subsequent A presses select the focused item. Controller focus has a gold outline and scrolls into view.

- D-pad or left stick up/down: navigate buttons and fields. Left/right: adjust dropdowns, sliders, and numeric fields. A activates buttons, checkboxes and settings sections.
- Menu: start from setup or pause/resume a race. B resumes from pause. Held buttons do not leak through to bike recovery when a menu closes.
- Editor LB/RB: previous/next object. X: switch obstacles/turns. Y: toggle the selected obstacle's test-ride highlight.
- Editor right stick: move the selected turn in map directions, or shift an obstacle along the lap. LT gives 0.1 m steps; normal steps are 1 m; RT gives 5 m steps. Changes update both previews and support Undo.
- Activate Place obstacle/Add turn point with A to insert an object, then position it with the right stick or inspector. The inspector also has Add obstacle/Add turn buttons.
- Editor B focuses Discard & close; A confirms it. Menu focuses Save & test ride; A confirms. This prevents a stray back/menu press from discarding or saving a draft.

Layout names still use text entry, and import/export use the browser's normal file dialogs. Mouse, keyboard and touch editing remain available. Local developer testing at `?controller-review` exposes a clearly labelled simulated Xbox panel that uses the same sampled-input path; it is omitted from production builds.

Local verification screenshots, controller traces and generated reports in `output/` are excluded from Git. Runtime assets in `public/` and all source, tests and launch scripts are included.
