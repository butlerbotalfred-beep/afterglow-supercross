# Afterglow / Supercross

A playable browser-based, third-person arcade Supercross milestone. Five selectable circuits, led by the 2,568 m dusk stadium (800% longer than the original), sculpted procedural motorcycle/rider, local split screen for 1–4 humans, and up to eight total racers. No online networking or accounts.

## Play online

**https://afterglow-supercross.vercel.app** is the hosted game. It is public, served over HTTPS, and needs no Mac, no Tailscale and no install. Every merge to `main` rebuilds and replaces it automatically within about a minute (Vercel builds the repository with `npm run build`). The **BUILD** stamp at the top of the setup screen is the commit it was built from.

Saves at the hosted link are separate from saves on the Mac's addresses. See **Moving a layout between addresses** to carry a custom layout across.

`NODE_PATH=$(npm root -g) npm run test:prod -- https://afterglow-supercross.vercel.app/ --expect-stamp <7-character commit>` (Playwright installed globally) checks the hosted build in a real browser: clean load, a simulated gamepad joining and starting a race, and no failed requests or console errors.

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
NODE_PATH=$(npm root -g) npm run test:load   # production build: loading screen, WebP textures, editor downloaded on demand (needs npm run build and Playwright)
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

To bring this Mac's copy up to date with `main` in one step:

```sh
npm run mac:update
```

It refuses to run if the folder is not on `main` or has uncommitted edits, then pulls, reinstalls packages if they changed and restarts the login service. It prints the commit it finished on, which is the **BUILD** stamp the Mac's address shows after a reload and should match the stamp at the hosted link.

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

One layout per circuit is saved in browser local storage. Saves are specific to that browser and address: localhost and the Tailscale address have separate storage, and clearing site data removes saves. **Export JSON** makes a portable backup; choose the matching circuit and **Import JSON** to restore it on another device or address (steps under **Moving a layout between addresses** below). Imported data is validated before replacing the draft. **Discard & close** drops unsaved changes; **Reset draft to original** is undoable and does not replace your saved layout until you save.

### Moving a layout between addresses

The hosted link, `localhost` and the Mac's Tailscale address each keep their own saves, so a layout built at one does not appear at another by itself. To move one:

1. At the address that has the layout, pick its circuit in race setup, choose **Track layout → My saved layout**, and open **Edit track**.
2. Press **Export JSON**. The browser downloads `afterglow-<circuit>-layout.json`. On an iPhone it lands in the Files app under Downloads.
3. Get the file to the other device if needed (AirDrop, iCloud Drive or email).
4. At the other address, pick the same circuit in race setup and open **Edit track**.
5. Press **Import JSON** and choose the file. The editor shows the imported layout and its name.
6. Press **Save & return** or **Save & test ride**. Until you save, the import is only a draft.

A file for a different circuit is refused with a message; pick the matching circuit first. `NODE_PATH=$(npm root -g) npm run test:prod -- --layout-from <address>` runs this export and import automatically between two addresses.

The editor allows up to 120 obstacles (240 individual mounds) and 120 route points, with dimensions bounded to keep the geometry finite. Overlaps, tight-turn jumps and crossing route segments produce warnings. Warnings do not prove a layout is unridable or guarantee it is safe: test the approach speed and nose alignment. There are no bridges, freehand terrain sculpting or automatic guarantees that an arbitrary custom route is easy for NPCs.

## iPhone touch controls

In race setup, choose **Play on → iPhone / Touch controls**, then **Drop the gate**. This explicit choice is required even on an iPhone. **Mac / Keyboard & gamepads** remains the default, with no touch overlay. Return to setup to change modes.

**Touch steering** and **Air pitch** each have **Regular / Inverted** choices in iPhone setup and the pause menu. Regular is the default: left turns left, right turns right, and dragging up lifts the nose. Inverting steering reverses left/right; inverting air pitch makes dragging up lower the nose. These preferences stay selected through pause/resume and restart within the session.

The iPhone option assigns one human rider to touch input; optional NPCs and free practice still work. Landscape is recommended. Hold **GAS** with your right thumb and drag the left stick sideways to steer. Drag the stick up/down to pitch the nose up/down in the air. Hold the dedicated **NOSE DOWN** button to dip the front wheel over doubles/triples; it always lowers the nose regardless of the stick inversion setting. **BRAKE**, **RECOVER**, and **PAUSE** are also on screen. Simultaneous fingers are independent. Pause, focus loss, cancelled gestures and rotation clear held input so throttle cannot remain stuck. Controls are hidden in setup, pause and results.

On an iPhone, open the hosted link **https://afterglow-supercross.vercel.app** (see **Play online** above); it needs no Mac and no Tailscale. To play the Mac's own copy instead, connect Tailscale on both devices, keep the Mac awake and open the Mac's Tailscale address on port 5173 (`tailscale ip -4` on the Mac prints it). Touch input works without the browser Gamepad API, including HTTP contexts where that API is unavailable. This is a separate local game session on the phone, not remote control of the Mac's race or online multiplayer.

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
| Preload on the ground | Hold E | Hold left stick straight back (down) |
| Scrub, just off the lip | A or D with Q | Left stick forward and fully to one side |
| Whip, in the air | A or D | Left stick fully to one side |
| Recover to checkpoint | R | B / east face button |
| Shared pause | Escape / P | Menu / Start |
| Join / ready | Setup buttons | A / south face button |
| Mute | M / sound button | Sound button in UI |

Brake into a berm to load the front and pivot the rear. Carry speed up a jump face, then tap nose down after takeoff and release once the bike matches the downslope. Air braking also dips the nose while preserving horizontal momentum; grounded braking slows the bike. Severe contact and badly aligned or excessively hard landings cause a visible crash, a 2.1-second slide, and a local remount where the wreck settles. Gentle rubbing only costs momentum. From 90 m out the HUD calls the jumps coming up (TABLETOP, SINGLE, DOUBLE, TRIPLE, RHYTHM ×N or WHOOPS) with the distance, and shows a takeoff speed meter below the rider. The meter is centred on the sweet spot: a narrow green in the middle that fades through yellow and orange to red on either side, slower to the left and faster to the right. A thin marker line shows your speed and glows in the colour it is over; inside the sweet spot it turns bright green and the HUD says PERFECT, otherwise BUILD SPEED or EASE OFF (TOO SLOW · COMES UP SHORT or TOO FAST · OVERSHOOTS where that speed would crash). The sweet spot comes from `src/takeoff.ts`, which rides every lane at every takeoff speed with the game's own physics rules and keeps the one that brings the bike down about a third of the way down the landing slope (not short of it and not past it; a tabletop is therefore not called flat out), so it stays right when tuning or a custom layout changes. Match the downslope with nose-down input.

**Preload and absorb.** On the ground, hold the stick straight back (keyboard E, touch stick toward nose-up) and the rider loads the suspension over 0.4 seconds; the bike squats and the PRELOAD bar under the speed fills. Let go in the last 6 m before the bike leaves the face and the jump goes about 15% higher and further (the bar reads POP). Keep holding through the lip and the rider soaks it up: about 30% lower and much shorter (ABSORB), and the held stick does not lift the nose until you let it go. A release earlier than 6 m does nothing. A stick pulled back for less than 0.2 seconds before the lip is just a nose-up input, not an absorb. With the stick 35% or more to either side it is the power slide instead and no preload builds. AI riders do not use it.

**Scrub and whip.** Just after takeoff (between 0.05 and 0.25 seconds), flick the stick forward and fully to one side (A or D with Q; on the phone the stick sideways with NOSE DOWN held or the stick forward). The bike lays over, flies about 23% lower and lands sooner, and the HUD reads SCRUB. The flick has to arrive in the air: a stick already held sideways through the lip does not count. The stick does not steer during a scrub. Let go in time: touching down still laid over more than 0.35 radians is a SCRUB NOT RECOVERED crash. Easing off the forward stick is enough, because the stick fully to one side without forward is a whip: the bike lays over up to 0.35 radians for show, changes nothing about the jump and can never crash. Bumps and corner hops cannot be scrubbed. AI riders do neither.

Recovery flashes the rider for 1.6 seconds and remounts alongside the wreck, moving sideways or a little backward only when another rider occupies that spot. Off-track wrecks are placed at the nearby track edge. Brief off-track excursions are forgiven when you return within 30 m of forward course progress; timing-plane credit is held until re-entry. Advancing farther outside automatically returns you to the original departure point, retaining all progress earned before leaving. Crashing or re-entering ahead cannot erase that penalty.

Connect gamepads and press a button so the browser exposes them. Up to four standard gamepads, or one keyboard plus three gamepads, can play. Device labels refer to the browser's physical gamepad indices. A device is never assigned to two riders. On a solo keyboard setup, pressing gamepad A / × assigns the controller to Player 1 and marks it ready, including Free Practice. Additional controllers join available/new multiplayer slots. **Use controller** focuses the connection flow, and the status underneath distinguishes detected controllers from an unavailable/blocked browser API. If no controller is visible, click inside the game and press A; pairing in macOS alone does not establish that the browser is receiving input. Use the device selectors to play with four controllers and no keyboard. Disconnecting an assigned controller pauses the whole race; reconnect it and resume, or return to setup. Loss of browser focus also pauses all riders.

One player gets a full viewport; two get stacked views; three/four use a 2×2 grid. The unused three-player quadrant shows race standings. All views share one simulation. Keyboard-only multiple human control is intentionally unsupported.

Sixteen ordered timing gates and forward start/finish crossings validate laps. Shortcuts and reverse crossings cannot award laps. The race ends once every human finishes, or 60 seconds after the first human finishes. The HUD shows the remaining time; all unfinished riders are classified DNF. Finished riders coast under NPC control. Practice continues until you return to setup. Restart clears timing, progress, recovery and results.

## Lap and sector timing

Every rider is timed. The sixteen timing gates are grouped into four sectors per lap, and each crossing is timed to the point inside the physics step where it happened, so times are exact to well under a thousandth of a second. Lap 1 runs from the gate drop; later laps run line to line.

- **During a ride**, a panel under the lap counter shows the running lap, your **LAST** lap and your **BEST**. As you finish each sector it shows the sector time for four seconds with the difference to your best lap's same sector: green when faster, red when slower. Finishing a lap shows the lap time and its difference the same way.
- **On the results screen**, every rider's lap times are listed. Each rider's own best lap is brighter, the fastest lap of the race is green, and riders behind the winner show their gap.
- **Best laps are saved** per circuit, and separately for each custom layout. Editing a custom layout's shape starts a fresh best for it; renaming it does not. Free practice laps count too.
- A lap in which you were sent back to the track after a shortcut cannot become a best lap. NPC riders and development autopilot never set one.
- Best laps carry the physics version they were ridden on. When a later update changes how the bike handles, older bests are moved to an archive inside the save and a new best starts, so times are only ever compared like for like.

`npm run test:hud` (dev server running, Playwright available) checks that the timing panel overlaps nothing in four layouts: 1, 2 and 4 riders at 1280 × 720, and a phone at 844 × 390.

## Time Trial and ghosts

**TIME TRIAL** is the third tab on the setup screen, beside Race Night and Free Practice: one rider, no computer riders, as many laps as you like. Every lap is timed as in a race. **↺ RESTART LAP** in the top bar (Backspace on the keyboard, or RESTART LAP in the pause menu, which a controller can reach) puts you back on the start line at a standstill and starts the clock again; the laps you have already ridden are kept. There is no results screen while you ride. **END TIME TRIAL** in the pause menu shows the laps of the session and your best.

Your best valid lap on each circuit and layout is kept as a **ghost**: a see-through bike that rides that lap again beside you, starting each time you cross the line or restart. It cannot be touched and changes nothing about your ride. A faster valid lap replaces it; a slower lap, a lap with a shortcut return or an autopilot lap never does. **Show the ghost of my best lap** on the setup screen and in the pause menu switches it off and on, and is remembered.

The ghost records where the bike was (position, heading, pitch and lean), not what was pressed, at least 15 times a second with extra samples at takeoffs, landings and crashes, packed as 16-bit values: about 19 KB for a Dusk Valley lap. Playback is never more than 0.10 m from the lap as ridden. Ghosts are stored in the browser's IndexedDB (`afterglow-ghosts`), stamped with the physics version; a ghost from an older version is not loaded. A ghost is never larger than 40 KB, about three minutes of riding; a slower lap leaves no ghost. Saving compares and writes in one step, so a second tab cannot replace a faster ghost with a slower one. If the browser has no IndexedDB, refuses it or does not answer within four seconds, the ghost still works until the page is closed and the top bar says it is not being saved. `src/ghost.ts` holds all of it; `npm run test:trial` checks it in a real browser.

## Start gate and holeshot

A Race Night start is a gate start. The grid is two rows of four with a gate bar in front of every bike. A board counts 5 to 1, then the gate goes live and drops at a moment between 1 and 3 seconds later that nobody can time, the same for every rider and the same every time for the same race seed. From **DROP THE GATE** to the drop is never more than 8 seconds. Free Practice and Time Trial have no gate.

While you wait, the throttle sets the revs on the launch meter under your bike. Hold the needle in the **green band** (55 to 80% throttle) as the gate falls and the bike leaves with full drive. Too few revs or too many and it bogs or spins: 70% drive for the first 14 m, which costs about 0.3 s down the start straight. Pin the throttle into the red (93% or more) once the gate is live and the bike creeps into the bar: **JUMPED THE GATE**, and it is held for exactly half a second after the drop. Revving as hard as you like while the board is still counting costs nothing. The launch works the same from the keyboard (W), a controller trigger, the Mac Xbox bridge and the touch GAS button; a key or the touch button is on or off, so tap it and watch the needle, which rises and falls slowly enough to hold in the band. A jumped gate always costs more than a poor launch.

Computer riders hold the band and leave after a reaction time that comes from the race seed and the rider's starts rating: 0.06 to 0.30 s for a rating of 60, about a quarter less for the best starters and up to a fifth more for the worst. They keep their own lane to the first corner, and the second row never leaves before the bike in front of it.

The **holeshot** goes to the first rider across the striped line after the first corner (Dusk Valley 240 m, Red Mesa 325 m, Pine Summit 445 m, Saltwind Coast 415 m, Iron Quarry 350 m; a custom layout places it after its own first corner). A banner names the rider and the results screen marks them. There is exactly one a race. `src/gate.ts` holds the rules; `npm run start-check` runs 100 seeded eight-rider starts on every circuit and `npm run test:gate` checks the gate in a real browser.

## The riders

The computer riders are twelve made-up riders in `src/riders.ts`, each with a name, a number, a plate colour and five ratings from 0 to 100. Their numbers start at 7 and their colours are not the four player colours, so a computer rider is never taken for a player:

- **Corner speed** sets how fast the rider goes through corners and down the straights (84 is the old Club pace, 96 the old Expert pace).
- **Rhythm skill** sets pace through rhythm sections and how well landings are matched. Riders rated 84 or more also preload the face of rhythm jumps and hold it through the lip, which keeps the bike low.
- **Starts** sets how quickly the rider reacts to the gate (60 is the old Club reaction, 93 the old Expert one, 40 the old Relaxed one).
- **Aggression** sets how readily the rider moves to the inside of a slower bike going into a corner.
- **Consistency** sets how often the rider makes a mistake: braking late, landing flat or running wide. None of them is a crash; each costs time (0.1 to 1.4 s measured, `npm run roster-check -- --costs`). A rider rated 90 makes one about every 17 laps, a rider rated 52 one about every 3.5 laps.

**NPC PACE** on the setup screen picks who is on the grid instead of speeding everybody up or down: Expert races the fastest riders in the roster, Relaxed the slowest, and Club starts from the third fastest. The middle of the roster is close together, so on Relaxed the riders' pace is also squeezed into a narrow range around the old Relaxed pace (76 to 79% against 78%), which keeps Relaxed about as easy as it was. The riders line up in a different order each race. Names and numbers are shown on the results screen, in the holeshot banner and in the standings.

**Catch-up assist** (setup screen, off unless you turn it on) eases computer riders that are far ahead of the last human by up to 5% and lets riders far behind push on by up to 3%, never past the top speed. Within 40 m of the last human nothing changes. With it off the riders are exactly as they are without it.

A race replays exactly from its seed: the same seed and the same inputs give the same finishing order and times. `npm run roster-check` runs 50 seeded Club races on Dusk Valley, the fastest Club rider on every circuit against the old Club time, and the roster baselines in `baselines/roster.json`; `npm run roster-check -- --mistakes` rides every rider alone for 500 laps and compares the mistakes made with the rating, and `npm run roster-check -- --costs` measures what each kind of mistake costs on every circuit.

## Championship

**CHAMPIONSHIP** on the setup screen is a season of five rounds, one on each circuit in the order of the circuit list (Dusk Valley, Red Mesa, Pine Summit, Saltwind Coast, Iron Quarry). Eight riders race every time: the humans (one to four, all in the same season) and the computer riders the pace setting picks. The riders and the pace are fixed once a season has started.

- **A round** is a heat and a main, both from the gate. The heat is 3 minutes plus a lap, the main 6 minutes plus a lap.
- **Timed races.** When the clock reaches zero, the leader finishes the lap they are on and then rides one more; the first rider to complete that last lap wins. Everybody else finishes the next time they cross the line, so a lapped rider finishes a lap or more down. The race bar shows the time left, then `TIME UP · ONE MORE LAP FROM THE LINE`, `FINAL LAP` and `CHEQUERED FLAG`. A race closes two minutes after the winner; a rider still out is classified where they were.
- **Gates.** The heat grid is drawn from the season's seed. The heat result is the gate order for the main: the heat winner starts from the first gate, second place from the next, and so on.
- **Points** come from the mains only: 25, 22, 20, 18, 17, 16, 15, 14, so every main awards 147. Level on points, the rider with more main wins is ahead; if that is level too, the better result in the latest round decides.
- **After a heat** the results window leads to the main; after a main it leads to the standings, and after round 5 to the final table and the champion.
- **Saving.** The season is saved the moment a race ends. Close the game at any point and it opens on the season, waiting for the next race. A race left before its end is not recorded and is run again. **START OVER WITH A NEW SEASON** asks for a second answer when the season has races in it.

Season rounds use the original circuits, not saved layouts. Race Night, Time Trial and Free Practice are as before. `npm run season-check` runs a whole Club season with eight computer riders (each round in its own process, about 20 seconds in all) and checks the round lengths and the final table; `npm run test:season` checks the season in a browser.

## Your rider

Each of the four players has a rider. **EDIT RIDER** on a player's row of the setup screen opens the editor:

- **Name**: 1 to 12 characters, shown in capitals. Any printable characters are allowed and a name is always shown as plain text, never read as markup.
- **Number**: 1 to 999. No two players can have the same number; the editor says who has it.
- **Three colours**: bike, kit and helmet, each from eight colours to start with.
- **Helmet design**: wave, crown stripe, split or chequered band.

The number is on the bike's three plates and on the back of the jersey, where the chase camera sees it; computer riders carry theirs the same way. The name and number are on the player's HUD, in the results, and in the championship standings, and the player's colour on the HUD and the map is the bike colour. A change made in the middle of a season shows from the next race. Settings are kept in the save for each player.

**Unlocks.** Winning the main of a championship round unlocks the next of five extra colour sets (NEON, EMBER, MIDNIGHT, FOREST, CHROME: three colours each, for every player). Winning a championship unlocks **Pro** pace: the Expert field with every rider's pace up by 3%. Each is given once; locked colours are shown struck through and cannot be chosen, and Pro cannot be picked until it is unlocked. The results window says when something is unlocked.

`npm run test:rider` checks the editor in a browser and photographs the number on the bike at one, two and three digits.

## Track wear

The dirt darkens where the bikes ride, more where they are fast or sliding, so the racing line wears in over a race. Every race starts on fresh dirt, and the track editor's preview never shows wear.

In a race the wear also changes the riding, unless **Track wear changes the riding** is unticked on the setup screen:

- **Ruts** form on the line through turns. A bike in a rut and steering into the turn turns up to 8% tighter. Crossing out of a rut sideways wobbles the bars for under half a second.
- **Braking bumps** form where riders brake for a turn, up to 6 cm from top to bottom. They are part of the ground the bike stands on, and braking over them is up to 20% weaker.
- Computer riders move towards a rut when one is within reach.

Time Trial is always ridden on the track as built, so lap records and ghosts stay comparable. A lap ridden with wear physics on sets no record.

`npm run test:wear` runs a 3-lap race of eight in a browser, photographs the track before and after, and checks the setting. `npm run wear-check` runs 5-lap races of eight with wear physics on and checks nobody fails to finish and the pace holds (`-- --all` for every circuit at every pace, `-- --off` for the same races without wear).

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
| Acceleration / braking | 26.953125 / 36 m/s² | Throttle and brake response |
| Drag coefficient | 0.34/s | Coast-down and top-end resistance |
| Speed cap | 45 m/s (162 km/h) | Arcade maximum, the fastest the AI ever aims for |
| Steering rate | 1.48 rad/s | Scaled at low speed and to 36% in the air |
| Gravity | 22 m/s² | Short, weighty jumps |
| Track half width | 4.8 m | 9.6 m rideable lane, with soft boundary penalties |
| Recovery delay | 1.6 s | Ghost/flash delay after returning to a validated gate |
| Chase distance | 3.2 m | Adjustable 2.5–6 m in setup and pause |
| Chase height | 1.9 m | Terrain clearance and landing look-ahead in `src/camera.ts` |
| Shake | 0.15 | Adjustable 0–1, including no shake |
| Field of view | 63–68° | Restrained speed increase |

`src/track.ts` controls the centerline, analytic jump profiles and berm banking; the mesh is sampled from that same height function. `src/physics.ts` contains weight, landing and NPC pace tuning. NPCs steer, throttle, brake, jump, collide and validate gates using the same movement logic as humans. They can lose time and recover; they are not position-animated along the circuit.

**Computer riders make mistakes.** In a race each computer rider misjudges a small share of its jumps (3% on Relaxed, 1.5% on Club, 0.7% on Expert) and takes them 10 to 30% too fast. It then overshoots under the same landing rule as a player: a heavy landing that costs speed, or a HARD LANDING crash and the usual recovery. Which jumps go wrong comes from a seed chosen when the race starts (shown as `seed` in `window.__game.snapshot()`), so a race can be replayed exactly. The pace gate and landing harness run with the seed at 0, where the riders are perfect; `npm run field-check` also runs seeded fields and fails if anyone fails to finish or the crash rate leaves 0.2 to 3 a race.

The camera maintains a stable horizon, smooths heading and position, stays above terrain, and hides an opponent mesh only when it intersects the camera's near region. Render scale (100%, 75%, 50%) is in setup. Pixel ratio is capped at 1.5; one directional shadow map focused around active riders, batched scenery, layered crowd cards and a small dust pool limit rendering cost.

## Sound

All sound is made in the browser as the game runs; there are no audio files. Sound starts when a race does, after the tap, click or key press that starts it (on the iPhone, the first touch).

- **Engines.** Each human rider hears their own bike, and the four other bikes nearest to any camera are voiced too. An engine is three oscillators driven into a clipper for a two-stroke's chainsaw rasp, a ringing exhaust-pipe filter and filtered hiss, following a five-gear rev model: revs climb with speed, drop at each shift, flare when the rear wheel is in the air, bang on the limiter at top speed, and crackle when the throttle is shut at high revs.
- **Where a bike is heard.** A browser has one pair of ears and split screen has up to four cameras, so each bike is placed by the camera nearest to it: louder when close, and to the left or right as that camera sees it.
- **Crowd and effects.** A crowd bed that lifts for a big jump (0.9 s of air or more), a pass and the finish; dirt spray in a slide; a landing thud scaled by the impact; a crash; a two-note lap sting and a three-note finish.
- **Silence.** Nothing plays on the setup screen, while paused, on the results screen (after the finish has rung out for 1.2 s) or when muted. After a second of silence the sound hardware is put to sleep.
- **Volume.** Four sliders, **Master volume**, **Engines**, **Effects** and **Crowd**, are under **Controls & ride settings** in setup and in the pause menu. They apply at once, stay in step with each other and are kept in this browser's save. **M** or the sound button mutes everything.

Every level change is a short glide, never a jump, so nothing clicks; `npm run lint:audio` checks the code for that in CI.

## Project map

- `src/main.ts`: session lifecycle, UI integration and one shared simulation/render loop.
- `src/courses.ts`, `src/scenery.ts`: five course definitions, terrain themes and scenery resource cleanup.
- `src/physics.ts`, `src/track.ts`, `src/race.ts`: movement, terrain and validated race progression.
- `src/timing.ts`: lap and sector times from the timing gates; `src/save.ts`: the one versioned save, including best laps.
- `src/input.ts`: isolated keyboard/gamepad/touch routing and edge-triggered actions.
- `src/touch-input.ts`, `src/touch-controls.ts`: multi-touch pointer ownership and the explicitly selected iPhone overlay.
- `src/bike-model.ts`, `src/world.ts`, `src/dust.ts`: procedural visuals and animation.
- `src/camera.ts`: chase views.
- `src/audio/`: the sound engine (engine voices, crowd, effects, mixer); see **Sound** above.
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

Contact crashes use relative closing speed above 9 m/s, not absolute riding speed. Landing checks consider impact normal to the surface and bike alignment: impact above 21 m/s, or pitch error above 0.95 radians with a substantial impact, can cause a crash. A landing more than 0.10 radians away from the slope of the ground costs speed, in proportion to how far off it is and never more than 29% in one landing (1.4 per radian; both were raised in physics version 3 so a missed landing still costs about the same lap time with the stronger engine). A landing matched to a downslope after at least 0.3 s in the air adds up to 3 km/h, and the HUD calls it CLEAN LANDING; one that costs speed is called FLAT LANDING. The values are `landingPenaltyStart`, `landingPenaltySlope`, `landingPenaltyMax`, `landingBonusMax`, `landingBonusSlope` and `landingJudgeAir` in `src/config.ts`. Physics version 3 raised acceleration 15% and lowered the top speed to 162 km/h: best laps saved on earlier versions are archived. Riders who rub in the air are pushed apart but keep their speed. AI riders read each jump's safe takeoff speeds (`src/takeoff.ts`) and will not close on a much slower rider in their line at more than 5 m/s. Fallen riders slide without earning checkpoint progress and cannot bypass remount time by pressing recover. This remains assisted arcade physics with animated falls, not a full ragdoll or wheel-by-wheel rigid-body simulation.

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
