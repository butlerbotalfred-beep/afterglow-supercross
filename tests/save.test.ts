import test from 'node:test';
import assert from 'node:assert/strict';
import {SLIDE_AGGRESSION_KEY} from '../src/handling-settings.ts';
import {DAMAGED_SAVE_KEY, defaultSave, SAVE_KEY, SAVE_VERSION, SaveStore} from '../src/save.ts';
import {Track} from '../src/track.ts';
import {courseById} from '../src/courses.ts';
import {LAYOUT_KEY, layoutFromTrack} from '../src/track-layout.ts';

/** A stand-in for the browser's localStorage that records every write. */
function memory(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  const writes: string[] = [];
  return {
    values,
    writes,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      writes.push(key);
      values.set(key, value);
    },
  };
}
const dusk = {...layoutFromTrack(new Track()), name: 'Dusk Custom'};
const canyon = {...layoutFromTrack(new Track(courseById('canyon'))), name: 'Canyon Custom'};

test('with nothing stored the save is all defaults and nothing is written until something changes', () => {
  const storage = memory();
  const save = new SaveStore(storage);
  assert.deepEqual(save.data, defaultSave());
  assert.equal(save.slideAggression, 1);
  assert.equal(save.layout('dusk'), null);
  assert.deepEqual(storage.writes, []);
});

test('the power-slide setting from an older build is picked up, and its key is left alone', () => {
  const storage = memory({[SLIDE_AGGRESSION_KEY]: '0.35'});
  const save = new SaveStore(storage);
  assert.equal(save.source, 'legacy');
  assert.equal(save.slideAggression, 0.35);
  save.setSlideAggression(1.5);
  assert.deepEqual(storage.writes, [SAVE_KEY], 'only the new save is written');
  assert.equal(storage.values.get(SLIDE_AGGRESSION_KEY), '0.35');
  assert.equal(new SaveStore(storage).slideAggression, 1.5, 'the new save wins once it exists');
});

test('custom layouts from an older build are picked up, and their key is left alone', () => {
  const legacy = JSON.stringify({dusk, canyon});
  const storage = memory({[LAYOUT_KEY]: legacy});
  const save = new SaveStore(storage);
  assert.deepEqual(save.layout('dusk'), dusk);
  assert.deepEqual(save.layout('canyon'), canyon);
  assert.equal(save.layout('alpine'), null);
  const edited = {...dusk, name: 'Dusk Second Try'};
  save.saveLayout(edited);
  assert.equal(storage.values.get(LAYOUT_KEY), legacy, 'the older key is never changed or deleted');
  const reloaded = new SaveStore(storage);
  assert.equal(reloaded.source, 'save');
  assert.deepEqual(reloaded.layout('dusk'), edited);
  assert.deepEqual(reloaded.layout('canyon'), canyon, 'layouts brought over from the older key are kept');
});

test('a corrupt save falls back to defaults instead of breaking the game', () => {
  for (const raw of ['{not json', '"text"', '[]', 'null', '{}', '{"version":"1"}', '{"version":0,"settings":{}}']) {
    const save = new SaveStore(memory({[SAVE_KEY]: raw}));
    assert.deepEqual(save.data, defaultSave(), raw);
    assert.equal(save.readOnly, false, raw);
  }
  // A damaged save still falls back to what an older build stored.
  const save = new SaveStore(memory({[SAVE_KEY]: '{oops', [SLIDE_AGGRESSION_KEY]: '0.5'}));
  assert.equal(save.slideAggression, 0.5);
  // And the next change replaces the damaged save with a good one.
  const storage = memory({[SAVE_KEY]: '{oops'});
  new SaveStore(storage).setSlideAggression(0.25);
  assert.equal(new SaveStore(storage).slideAggression, 0.25);
  assert.equal(storage.values.get(DAMAGED_SAVE_KEY), '{oops', 'a copy of the damaged save is set aside first');
});

test('damaged parts of a save are replaced with defaults and the good parts are kept', () => {
  const stored = {
    version: SAVE_VERSION,
    settings: {slideAggression: 'fast'},
    layouts: {dusk, canyon: {...canyon, points: []}, alpine: dusk},
    records: [1, 2],
    career: {round: 3},
  };
  const save = new SaveStore(memory({[SAVE_KEY]: JSON.stringify(stored)}));
  assert.equal(save.slideAggression, 1);
  assert.deepEqual(save.layout('dusk'), dusk);
  assert.equal(save.layout('canyon'), null, 'an invalid layout is dropped');
  assert.equal(save.layout('alpine'), null, 'a layout filed under the wrong course is dropped');
  assert.deepEqual(save.data.records, {});
  assert.deepEqual(save.data.career, {round: 3});
  const high = new SaveStore(memory({[SAVE_KEY]: '{"version":1,"settings":{"slideAggression":9}}'}));
  assert.equal(high.slideAggression, 2);
});

test('a save from a newer version of the game is left untouched', () => {
  const newer = JSON.stringify({
    version: SAVE_VERSION + 1,
    settings: {slideAggression: 0.1, future: true},
    garage: [1],
  });
  const storage = memory({[SAVE_KEY]: newer, [SLIDE_AGGRESSION_KEY]: '0.4'});
  const save = new SaveStore(storage);
  assert.equal(save.readOnly, true);
  assert.equal(save.source, 'newer');
  assert.equal(save.slideAggression, 0.4, 'this build falls back to what it understands');
  assert.equal(save.setSlideAggression(1.2), 1.2, 'changes still apply for this visit');
  assert.throws(() => save.saveLayout(dusk), /newer version/, 'the editor is told the layout cannot be kept');
  assert.equal(save.layout('dusk'), null);
  save.write();
  assert.deepEqual(storage.writes, []);
  assert.equal(storage.values.get(SAVE_KEY), newer);
});

test('a save round-trips: settings, layouts, records and career come back as stored', () => {
  const storage = memory();
  const save = new SaveStore(storage);
  save.setSlideAggression(0.75);
  save.saveLayout(dusk);
  save.saveLayout(canyon);
  save.data.records = {dusk: {bestLap: 31.25, physics: 1}};
  save.data.career = {season: 2, points: [25, 18]};
  save.write();
  const stored = JSON.parse(storage.values.get(SAVE_KEY)!);
  assert.equal(stored.version, SAVE_VERSION);
  const reloaded = new SaveStore(storage);
  assert.equal(reloaded.source, 'save');
  assert.deepEqual(reloaded.data, save.data);
  reloaded.write();
  assert.equal(storage.values.get(SAVE_KEY), JSON.stringify(stored), 'loading and saving again changes nothing');
});

test('settings are clamped, and an invalid layout is refused without touching the save', () => {
  const storage = memory();
  const save = new SaveStore(storage);
  assert.equal(save.setSlideAggression(5), 2);
  assert.equal(save.setSlideAggression(-1), 0);
  assert.equal(save.setSlideAggression(NaN), 1);
  const before = storage.values.get(SAVE_KEY);
  assert.throws(() => save.saveLayout({...dusk, name: ''}));
  assert.equal(save.layout('dusk'), null);
  assert.equal(storage.values.get(SAVE_KEY), before);
});

test('blocked or full browser storage never breaks the game', () => {
  const blocked = new SaveStore(null);
  assert.deepEqual(blocked.data, defaultSave());
  assert.equal(blocked.setSlideAggression(0.5), 0.5);
  assert.throws(() => blocked.saveLayout(dusk), /blocking/, 'the editor is told the layout cannot be kept');
  assert.equal(blocked.layout('dusk'), null);
  const throwing = {
    getItem: () => {
      throw new Error('blocked');
    },
    setItem: () => {
      throw new Error('quota');
    },
  };
  const save = new SaveStore(throwing);
  assert.deepEqual(save.data, defaultSave());
  assert.equal(save.setSlideAggression(0.5), 0.5, 'a setting still applies when it cannot be stored');
  assert.throws(() => save.saveLayout(dusk), /quota/, 'the editor is told when a layout cannot be stored');
  assert.equal(save.layout('dusk'), null, 'a layout that could not be stored is not kept');
});

test('two tabs do not overwrite each other', () => {
  const storage = memory();
  const tabA = new SaveStore(storage),
    tabB = new SaveStore(storage);
  tabA.saveLayout(canyon);
  tabB.setSlideAggression(0.6);
  tabA.saveLayout(dusk);
  const reloaded = new SaveStore(storage);
  assert.deepEqual(reloaded.layout('canyon'), canyon, "tab A's layout survives tab B's change");
  assert.deepEqual(reloaded.layout('dusk'), dusk);
  assert.equal(reloaded.slideAggression, 0.6, "tab B's setting survives tab A's later save");
  assert.deepEqual(tabB.layout('canyon'), canyon, "a tab picks up the other tab's layouts when it next saves");
});

test('parts of a save this build does not recognise survive a change', () => {
  const stored = {
    version: SAVE_VERSION,
    settings: {slideAggression: 0.7, volume: 0.4},
    layouts: {dusk, moon: {some: 'future course'}},
    records: {},
    career: {},
    garage: ['bike-2'],
  };
  const storage = memory({[SAVE_KEY]: JSON.stringify(stored)});
  const save = new SaveStore(storage);
  save.setSlideAggression(1.1);
  save.saveLayout(canyon);
  save.write();
  const after = JSON.parse(storage.values.get(SAVE_KEY)!);
  assert.deepEqual(after.settings, {slideAggression: 1.1, volume: 0.4});
  assert.deepEqual(after.garage, ['bike-2']);
  assert.deepEqual(after.layouts.moon, {some: 'future course'});
  assert.deepEqual(after.layouts.canyon, canyon);
  assert.deepEqual(after.layouts.dusk, dusk);
});

test('a save that another tab upgraded to a newer version is not written over', () => {
  const storage = memory();
  const save = new SaveStore(storage);
  save.setSlideAggression(0.5);
  const newer = JSON.stringify({version: SAVE_VERSION + 1, settings: {slideAggression: 0.9}});
  storage.values.set(SAVE_KEY, newer);
  save.setSlideAggression(0.2);
  save.write();
  assert.equal(storage.values.get(SAVE_KEY), newer);
});

test('what is kept for this visit after a refused write survives the next write that fits', () => {
  // Storage that fills up: writes are refused while `fullNow` is set.
  const values = new Map<string, string>();
  let fullNow = false;
  const storage = {
    getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => {
      if (fullNow) throw new Error('QuotaExceededError');
      values.set(k, v);
    },
  };
  const save = new SaveStore(storage);
  save.setShowGhost(false);
  fullNow = true;
  assert.equal(save.submitLap('dusk', {time: 80, sectors: [20, 20, 20, 20]}), true);
  assert.equal(save.bestLap('dusk')?.time, 80, 'kept for this visit');
  // A small write gets through later: the lap held in memory is still the best lap.
  fullNow = false;
  save.setShowGhost(true);
  assert.equal(save.showGhost, true);
  assert.equal(save.bestLap('dusk')?.time, 80, 'still there after an accepted write');
  // And a store that never had a refused write still reads back what storage holds.
  const other = new SaveStore(storage);
  assert.equal(other.showGhost, true);
});
