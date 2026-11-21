import test from 'node:test';
import assert from 'node:assert/strict';
import {SLIDE_AGGRESSION_KEY} from '../src/handling-settings.ts';
import {defaultSave, SAVE_KEY, SAVE_VERSION, SaveStore} from '../src/save.ts';
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
  save.saveLayout(dusk);
  assert.deepEqual(save.layout('dusk'), dusk);
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
  blocked.saveLayout(dusk);
  assert.deepEqual(blocked.layout('dusk'), dusk);
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
