import test from 'node:test';
import assert from 'node:assert/strict';
import {plateFont} from '../src/bike-model.ts';
import {COLORS} from '../src/config.ts';
import {COURSES} from '../src/courses.ts';
import {PRO_PACE as PRO_PACE_SHARE, gridFor, riderLabel} from '../src/riders.ts';
import {TUNING} from '../src/config.ts';
import {neutralControl} from '../src/input.ts';
import {
  COLOR_SETS,
  HELMETS,
  NAME_MAX,
  PLAYERS,
  PRO_PACE,
  allowedPace,
  availableColors,
  awardRoundWin,
  awardSeasonWin,
  checkName,
  checkNumber,
  checkRider,
  defaultRider,
  defaultRiders,
  normalizeProgress,
  normalizeRiders,
  type RiderSettings,
} from '../src/rider-settings.ts';
import {SAVE_KEY, SaveStore} from '../src/save.ts';
import {newSeason, nextRace, recordRace, seasonWithRiders, standings, type Season} from '../src/season.ts';
import {Track} from '../src/track.ts';
import {RaceSession} from '../src/game/race-session.ts';
import {seasonGrid} from '../src/game/season-run.ts';
import {escapeHtml} from '../src/ui/dom.ts';
import {hudHtml} from '../src/ui/hud.ts';
import {resultRowsHtml, standingsRowsHtml} from '../src/ui/results-screen.ts';
import {riderButtonHtml, swatchesHtml} from '../src/ui/rider-editor.ts';
import {slotsHtml} from '../src/ui/setup-screen.ts';

function memory() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, v: string) => void values.set(key, v),
  };
}
const quiet = {countdown() {}, racing() {}, cue() {}, landing() {}, pause() {}, results() {}};
const input = (r: RiderSettings, change: Record<string, unknown> = {}) => ({...r, ...change});
const FOUR: RiderSettings[] = [
  {name: 'MIKE', number: 7, bike: COLORS[3], kit: COLORS[0], helmet: COLORS[5], design: 'stripe'},
  {name: 'SARAH B', number: 42, bike: COLORS[1], kit: COLORS[1], helmet: COLORS[6], design: 'split'},
  {name: 'ÉLODIE', number: 999, bike: COLORS[2], kit: COLORS[7], helmet: COLORS[2], design: 'checker'},
  {name: 'TWELVE CHARS', number: 1, bike: COLORS[4], kit: COLORS[4], helmet: COLORS[4], design: 'wave'},
];
/** A save with all four players set up as FOUR. Player 4 takes number 1 only once player 1 has let go of it. */
function fourPlayers(storage = memory()) {
  const save = new SaveStore(storage);
  FOUR.forEach((rider, player) => assert.deepEqual(save.setRider(player, rider), {ok: true, value: rider}));
  return {save, storage};
}

test('rider settings persist for each of four players', () => {
  // A new save has four different riders to start from.
  const fresh = new SaveStore(memory());
  assert.equal(fresh.riders.length, PLAYERS);
  assert.deepEqual(fresh.riders, defaultRiders());
  assert.equal(new Set(fresh.riders.map(r => r.number)).size, PLAYERS);

  const {save, storage} = fourPlayers();
  assert.deepEqual(save.riders, FOUR);
  // Closing and reopening: every player's name, number, three colours and helmet are as they were set.
  const reopened = new SaveStore(storage);
  assert.deepEqual(reopened.riders, FOUR);
  for (let player = 0; player < PLAYERS; player++) assert.deepEqual(reopened.riders[player], FOUR[player]);
  // Changing one player leaves the other three alone, and that also survives reopening.
  const changed = {...FOUR[1], name: 'SAZ', number: 500};
  assert.equal(reopened.setRider(1, changed).ok, true);
  assert.deepEqual(new SaveStore(storage).riders, [FOUR[0], changed, FOUR[2], FOUR[3]]);
  // The rest of the save is untouched by it, and a setting changed in another tab meanwhile is kept.
  const other = new SaveStore(storage);
  other.setCatchUp(true);
  assert.equal(reopened.setRider(2, {...FOUR[2], name: 'ELO'}).ok, true);
  const last = new SaveStore(storage);
  assert.equal(last.catchUp, true);
  assert.equal(last.riders[2].name, 'ELO');
  assert.equal(last.riders[1].name, 'SAZ');
  // Where the browser will not store anything, the settings still apply for the visit.
  const blocked = new SaveStore(null);
  assert.equal(blocked.setRider(0, FOUR[0]).ok, true);
  assert.deepEqual(blocked.riders[0], FOUR[0]);
  const full = new SaveStore({getItem: () => null, setItem: () => assert.fail('storage is full')});
  assert.equal(full.setRider(3, {...FOUR[3], number: 4}).ok, true);
  assert.equal(full.riders[3].name, 'TWELVE CHARS');
});

test('an invalid name or number is rejected', () => {
  // Names: kept as typed apart from tidying; 1 to 12 characters.
  assert.deepEqual(checkName('  mike   the  1 '), {ok: true, value: 'MIKE THE 1'});
  assert.deepEqual(checkName('A'), {ok: true, value: 'A'});
  assert.deepEqual(checkName('x'.repeat(NAME_MAX)), {ok: true, value: 'X'.repeat(NAME_MAX)});
  assert.equal(checkName('ÉLODIE 🏁').ok, true);
  for (const bad of ['', '   ', 'x'.repeat(NAME_MAX + 1), 'TWO\nLINES', 'TAB\tBED', 'NUL\u0000L', 'RTL‮X', null, 7, {}])
    assert.equal(checkName(bad).ok, false, `name ${JSON.stringify(bad)}`);
  // Numbers: whole, 1 to 999, as a number or as typed digits.
  for (const good of [1, 9, 10, 99, 100, 999, '1', '042', ' 77 ', '999'])
    assert.equal(checkNumber(good).ok, true, `number ${JSON.stringify(good)}`);
  assert.deepEqual(checkNumber('042'), {ok: true, value: 42});
  for (const bad of [
    0,
    -1,
    1000,
    1.5,
    NaN,
    Infinity,
    '',
    ' ',
    '0',
    '000',
    '1000',
    '12a',
    '1e2',
    '-5',
    '4.0',
    '٣',
    null,
    true,
    [7],
  ])
    assert.equal(checkNumber(bad).ok, false, `number ${JSON.stringify(bad)}`);

  // Through the save: a refused change says why, and changes nothing, in memory or in storage.
  const {save, storage} = fourPlayers();
  const before = storage.values.get(SAVE_KEY);
  for (const change of [
    {name: ''},
    {name: 'THIRTEEN CHARS'},
    {name: 'A\nB'},
    {number: 0},
    {number: 1000},
    {number: '12a'},
    {number: 2.5},
    {design: 'flames'},
    {bike: 0x123456},
    {kit: 'red'},
    {name: '', number: 0},
  ]) {
    const result = save.setRider(0, input(FOUR[0], change));
    assert.equal(result.ok, false, JSON.stringify(change));
    assert.ok(!result.ok && result.errors.length >= 1 && result.errors.every(e => e.length > 5));
    assert.deepEqual(save.riders, FOUR);
    assert.equal(storage.values.get(SAVE_KEY), before);
  }
  // Both faults are reported together.
  const both = save.setRider(0, input(FOUR[0], {name: '', number: 0}));
  assert.equal(!both.ok && both.errors.length, 2);
  // A player that does not exist.
  for (const player of [-1, 4, 1.5, NaN]) assert.equal(save.setRider(player, FOUR[0]).ok, false);
  // A stored save that has been tampered with: the invalid player goes back to defaults, the rest are kept.
  const stored = JSON.parse(before!);
  stored.settings.riders[1] = {...FOUR[1], name: 'x'.repeat(40), number: 5000};
  stored.settings.riders[2] = 'nonsense';
  storage.values.set(SAVE_KEY, JSON.stringify(stored));
  const reread = new SaveStore(storage).riders;
  assert.deepEqual([reread[0], reread[3]], [FOUR[0], FOUR[3]]);
  assert.deepEqual(reread[1], defaultRider(1));
  assert.deepEqual(reread[2], defaultRider(2));
});

test('HTML typed into a name is shown as plain text', () => {
  const nasty = '<IMG X>&"\'';
  assert.ok([...nasty].length <= NAME_MAX);
  const {save} = fourPlayers();
  // The name is accepted as typed: it is a legal name, just an awkward one.
  assert.deepEqual(save.setRider(0, {...FOUR[0], name: nasty}), {ok: true, value: {...FOUR[0], name: nasty}});
  assert.equal(escapeHtml(nasty), '&lt;IMG X&gt;&amp;&quot;&#39;');
  assert.equal(escapeHtml('PLAIN NAME 7'), 'PLAIN NAME 7');
  const safe = escapeHtml(`#7 ${nasty}`);
  /** No tag in the markup comes from the name, and the name is there in escaped form. */
  const plain = (html: string, where: string) => {
    assert.ok(!/<img/i.test(html), `${where}: an img tag`);
    assert.ok(!html.includes(nasty), `${where}: the raw name`);
    assert.ok(html.includes(escapeHtml(nasty)), `${where}: the escaped name`);
  };
  // Setup screen: the player's row.
  plain(riderButtonHtml(0, save.riders[0]), 'rider button');
  plain(slotsHtml(2, [false, false], false, [], save.riders), 'setup slots');
  // A race with that player in it: HUD and results.
  const track = new Track(COURSES[0]);
  const session = new RaceSession({sample: () => ({}) as never, connectedGamepads: () => []}, quiet);
  const humans = save.riders.map(r => ({name: r.name, number: r.number, color: r.bike}));
  session.grid({track, humanCount: 2, npcCount: 2, practice: false, assignments: [], humans});
  assert.equal(session.riders[0].name, nasty);
  assert.equal(riderLabel(session.riders[0]), `#7 ${nasty}`);
  const hud = hudHtml(2, session.riders, [], false, 3);
  plain(hud, 'HUD');
  assert.ok(hud.includes(`<span class="identity-name">${safe}</span>`));
  const rows = resultRowsHtml(session.riders, session.riders, [], false, null, null, null, 0);
  plain(rows, 'results');
  assert.ok(rows.includes(`<strong>${safe}<small>HUMAN`));
  // Championship standings.
  const season = seasonWithRiders(newSeason(2, 'club', 5), save.riders);
  plain(standingsRowsHtml(season), 'standings');
  // Whatever the characters, escaping leaves nothing that opens a tag or ends an attribute.
  for (const text of ['<script>alert(1)</script>', '"><b>', "'onx='", '&lt;', '</small>', '<<>>', '&&'])
    assert.ok(!/[<>"']/.test(escapeHtml(text)) && !/&(?!amp;|lt;|gt;|quot;|#39;)/.test(escapeHtml(text)), text);
});

test('an unlock is awarded once and locked items cannot be selected', () => {
  const storage = memory();
  const save = new SaveStore(storage);
  const season = newSeason(1, 'club', 77);
  assert.equal(save.unlocks.length, 0);
  // Locked: a colour from a set not yet won is refused, for any of the three parts, and so is Pro pace.
  const [neon, ember] = COLOR_SETS;
  for (const part of ['bike', 'kit', 'helmet']) {
    const refused = save.setRider(0, input(defaultRider(0), {[part]: neon.colors[0]}));
    assert.deepEqual(refused, {ok: false, errors: ['The NEON colours are still locked.']});
  }
  assert.deepEqual(save.riders, defaultRiders());
  assert.equal(allowedPace('pro', save.unlocks), 'expert');
  for (const pace of ['relaxed', 'club', 'expert']) assert.equal(allowedPace(pace, []), pace);
  assert.ok(!availableColors([]).some(c => COLOR_SETS.some(set => set.colors.includes(c))));
  // The editor offers a locked colour only as a disabled button.
  const swatches = swatchesHtml('bike', COLORS[0], []);
  for (const set of COLOR_SETS)
    for (const color of set.colors) assert.match(swatches, new RegExp(`data-color="${color}"[^>]* disabled `));
  for (const color of COLORS) assert.doesNotMatch(swatches, new RegExp(`data-color="${color}"[^>]* disabled`));

  // A round win unlocks the first set. Reported again for the same round, it gives nothing more.
  assert.equal(save.awardRoundWin(season, 0), neon);
  assert.deepEqual(save.unlocks, [neon.id]);
  for (let again = 0; again < 3; again++) assert.equal(save.awardRoundWin(season, 0), null);
  assert.deepEqual(save.unlocks, [neon.id]);
  // Not from another page on the same save either, nor after reopening.
  assert.equal(new SaveStore(storage).awardRoundWin(season, 0), null);
  assert.deepEqual(new SaveStore(storage).unlocks, [neon.id]);
  // Now the colours can be chosen; the next set's still cannot.
  assert.equal(save.setRider(0, input(defaultRider(0), {kit: neon.colors[2]})).ok, true);
  assert.equal(save.setRider(0, input(defaultRider(0), {kit: ember.colors[0]})).ok, false);
  assert.doesNotMatch(
    swatchesHtml('kit', neon.colors[2], save.unlocks),
    new RegExp(`data-color="${neon.colors[0]}"[^>]* disabled`),
  );
  // Each further round win, in this season or another, unlocks the next set, once.
  assert.equal(save.awardRoundWin(season, 1), ember);
  assert.equal(save.awardRoundWin(newSeason(1, 'club', 78), 1), COLOR_SETS[2]);
  assert.equal(save.awardRoundWin(season, 1), null);
  for (let round = 2; round < 5; round++) save.awardRoundWin(season, round);
  assert.deepEqual(
    save.unlocks,
    COLOR_SETS.map(set => set.id),
  );
  // With every set unlocked a win is still recorded and gives nothing.
  assert.equal(save.awardRoundWin(newSeason(1, 'club', 79), 0), null);
  assert.equal(new Set(normalizeProgress(new SaveStore(storage).data.career).awards).size, 7);

  // The championship: Pro pace, once.
  assert.equal(save.awardSeasonWin(), true);
  assert.equal(save.awardSeasonWin(), false);
  assert.equal(new SaveStore(storage).awardSeasonWin(), false);
  assert.ok(save.unlocks.includes(PRO_PACE));
  assert.equal(allowedPace('pro', save.unlocks), 'pro');
  assert.equal(save.unlocks.length, new Set(save.unlocks).size);
  // The pure rules, on their own.
  const start = {unlocks: [], awards: []};
  const once = awardRoundWin(start, 'a').progress;
  assert.deepEqual(awardRoundWin(once, 'a'), {progress: once, awarded: null});
  assert.deepEqual(awardSeasonWin(awardSeasonWin(start).progress).awarded, false);
  // A stored save cannot hand itself an unlock this build does not have, or a locked colour or pace.
  const forged = memory();
  const riders = defaultRiders();
  riders[0].bike = neon.colors[0];
  forged.values.set(
    SAVE_KEY,
    JSON.stringify({
      version: 1,
      settings: {riders},
      career: {unlocks: ['everything', 7], season: newSeason(1, 'pro', 3)},
    }),
  );
  const loaded = new SaveStore(forged);
  assert.deepEqual(loaded.unlocks, []);
  assert.deepEqual(loaded.riders[0], defaultRider(0));
  // A Pro season is not carried on by a save that has not unlocked Pro; with it unlocked it is.
  const raced = recordRace(newSeason(1, 'pro', 3), [0, 1, 2, 3, 4, 5, 6, 7]);
  loaded.setSeason(raced);
  assert.equal(loaded.season === null, true);
  loaded.awardSeasonWin();
  assert.equal(loaded.season?.difficulty, 'pro');
  // The stored settings keep unlocked colours through a reload.
  assert.equal(new SaveStore(storage).riders[0].kit, neon.colors[2]);
});

test('the plate shows the number at 1, 2 and 3 digits', () => {
  // Drawn on a plate 256 wide with 14 to spare each side. In italic 900 Arial a digit is at most 0.62 of the
  // type size wide, so every number fits without being squeezed; the screenshots show the result.
  for (const number of [1, 7, 10, 42, 99, 100, 444, 999]) {
    const {size, width} = plateFont(number);
    assert.ok(String(number).length * size * 0.62 <= width, `${number} at ${size}px`);
    assert.ok(size >= 100, 'still large enough to read from the chase camera');
    assert.ok(width <= 256 - 28);
  }
  assert.ok(plateFont(7).size > plateFont(42).size && plateFont(42).size > plateFont(444).size);
  // The number a player chose is the one on their bike and in every label.
  const {save} = fourPlayers();
  const track = new Track(COURSES[0]);
  const session = new RaceSession({sample: () => ({}) as never, connectedGamepads: () => []}, quiet);
  const humans = save.riders.map(r => ({name: r.name, number: r.number, color: r.bike}));
  session.grid({track, humanCount: 4, npcCount: 4, practice: false, assignments: [], humans});
  assert.deepEqual(
    session.riders.slice(0, 4).map(r => [r.name, r.number, r.color]),
    FOUR.map(r => [r.name, r.number, r.bike]),
  );
  assert.deepEqual(session.riders.slice(0, 4).map(riderLabel), [
    '#7 MIKE',
    '#42 SARAH B',
    '#999 ÉLODIE',
    '#1 TWELVE CHARS',
  ]);
  assert.ok(session.riders.slice(4).every(r => r.number === undefined && /^#\d+ /.test(riderLabel(r))));
  // In a championship the entrants carry the same, and a change made mid-season shows at once.
  let season: Season = newSeason(2, 'club', 9);
  season = recordRace(season, [1, 0, 2, 3, 4, 5, 6, 7]);
  season = recordRace(season, [1, 0, 2, 3, 4, 5, 6, 7]);
  const table = standings(seasonWithRiders(season, save.riders));
  assert.deepEqual(
    [table[0].entrant.name, table[0].entrant.number, table[0].entrant.color],
    ['SARAH B', 42, COLORS[1]],
  );
  session.grid(seasonGrid(seasonWithRiders(season, save.riders), nextRace(season)!, track, []));
  assert.deepEqual(session.riders.slice(0, 2).map(riderLabel), ['#7 MIKE', '#42 SARAH B']);
  // The stored season does not hold the names: it reads back whatever the players are called.
  const stored = new SaveStore(memory());
  stored.setSeason(seasonWithRiders(season, save.riders));
  assert.deepEqual(stored.season?.entrants[1].name, 'PLAYER 2');
});

test('two humans cannot pick the same number', () => {
  const {save, storage} = fourPlayers();
  const before = storage.values.get(SAVE_KEY);
  // Every player is refused every other player's number, and told whose it is.
  for (let player = 0; player < PLAYERS; player++)
    for (let other = 0; other < PLAYERS; other++) {
      const result = save.setRider(player, {...FOUR[player], number: FOUR[other].number});
      if (other === player) assert.equal(result.ok, true);
      else
        assert.deepEqual(result, {
          ok: false,
          errors: [`Player ${other + 1} already has number ${FOUR[other].number}.`],
        });
    }
  assert.deepEqual(save.riders, FOUR);
  assert.equal(storage.values.get(SAVE_KEY), before);
  // Typed with leading zeros or as text it is the same number.
  assert.equal(save.setRider(0, input(FOUR[0], {number: '042'})).ok, false);
  // A free number is fine, and the old one is then free for somebody else.
  assert.equal(save.setRider(0, {...FOUR[0], number: 8}).ok, true);
  assert.equal(save.setRider(1, {...FOUR[1], number: 7}).ok, true);
  // Two pages open on the same save: the second to ask for a number is refused, though its own copy is stale.
  const a = new SaveStore(storage),
    b = new SaveStore(storage);
  assert.equal(a.setRider(2, {...FOUR[2], number: 300}).ok, true);
  assert.deepEqual(b.setRider(3, {...FOUR[3], number: 300}), {ok: false, errors: ['Player 3 already has number 300.']});
  assert.equal(new Set(new SaveStore(storage).riders.map(r => r.number)).size, PLAYERS);
  // The pure check, against every pair.
  for (let player = 0; player < PLAYERS; player++)
    for (let other = 0; other < PLAYERS; other++)
      assert.equal(checkRider({...FOUR[player], number: FOUR[other].number}, player, FOUR, []).ok, other === player);
  // A stored save with two players on one number: the first keeps it, the second gets a free one.
  const clash = FOUR.map(r => ({...r}));
  clash[2].number = clash[0].number;
  const fixed = normalizeRiders(clash, []);
  assert.equal(fixed[0].number, FOUR[0].number);
  assert.equal(new Set(fixed.map(r => r.number)).size, PLAYERS);
  // Default numbers never collide with one already taken.
  const taken = normalizeRiders([{...FOUR[0], number: 2}, null, null, null], []);
  assert.equal(new Set(taken.map(r => r.number)).size, PLAYERS);
  assert.equal(HELMETS.length, 4);
});

test('Pro pace is the Expert field, every rider quicker, and it still gets round', () => {
  assert.deepEqual(gridFor('pro', 8), gridFor('expert', 8));
  assert.ok(PRO_PACE_SHARE > 1 && PRO_PACE_SHARE <= 1.05);
  const track = new Track(COURSES.find(c => c.id === 'coast')!);
  const race = (difficulty: string) => {
    const session = new RaceSession({sample: () => neutralControl(), connectedGamepads: () => []}, quiet);
    session.grid({track, humanCount: 0, npcCount: 8, practice: false, assignments: [], difficulty, seed: 5});
    session.start({lapCount: 3, difficulty, seed: 5});
    while (session.phase !== 'results' && session.raceTime < 600) session.step(TUNING.step);
    assert.ok(
      session.riders.every(r => r.finished !== null),
      `${difficulty}: everybody finishes`,
    );
    const times = session.riders.map(r => r.finished!);
    return {winner: Math.min(...times), mean: times.reduce((a, b) => a + b, 0) / times.length};
  };
  const expert = race('expert'),
    pro = race('pro');
  // Measured on Saltwind Coast: the winner about 1% quicker and the field about 1.7%.
  assert.ok(pro.winner < expert.winner, `winner ${pro.winner.toFixed(2)} against ${expert.winner.toFixed(2)}`);
  assert.ok(pro.mean < expert.mean * 0.995, `field ${pro.mean.toFixed(2)} against ${expert.mean.toFixed(2)}`);
});
