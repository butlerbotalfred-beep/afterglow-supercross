// One versioned save for everything the game remembers: settings, custom layouts, records and career.
// An older build, or a tab still running one, keeps using its own keys and does not see changes made here.
// Older builds kept the power-slide setting and custom layouts under their own keys. Those keys are read when no
// save exists yet and are never changed or deleted, so an older build still finds its data.
import {PHYSICS_VERSION} from './config';
import type {CourseId} from './courses';
import {DEFAULT_VOLUMES, normalizeVolumes, type Volumes} from './audio';
import {loadSlideAggression, normalizeSlideAggression} from './handling-settings';
import {
  allowedPace,
  awardRoundWin,
  awardSeasonWin,
  checkRider,
  defaultRiders,
  normalizeProgress,
  normalizeRiders,
  type ColorSet,
  type Progress,
  type RiderInput,
  type RiderSettings,
} from './rider-settings';
import {asSeason, type Season} from './season';
import {COURSE_IDS, loadLayout, obstacleType, validateLayout, type TrackLayout} from './track-layout';

export const SAVE_KEY = 'afterglow.save';
export const SAVE_VERSION = 1;
/** Where a save this build could not read is copied before it is replaced. */
export const DAMAGED_SAVE_KEY = 'afterglow.save.damaged';

export interface SaveData {
  version: number;
  settings: {
    slideAggression: number;
    volumes: Volumes;
    showGhost: boolean;
    catchUp: boolean;
    /** Wear physics in races: ruts and braking bumps that change the riding. On unless the player turns it off. */
    wearPhysics: boolean;
    /** Each of the four players' rider: name, number, colours and helmet. */
    riders: RiderSettings[];
  };
  layouts: Partial<Record<CourseId, TrackLayout>>;
  /** Best times and similar; filled in by later milestones and kept as stored until then. */
  records: Record<string, unknown>;
  /** Career progress; filled in by later milestones and kept as stored until then. */
  career: Record<string, unknown>;
}
/** A saved best lap. */
export interface LapRecord {
  time: number;
  sectors: number[];
  /** The PHYSICS_VERSION the lap was ridden on. Laps from other versions are archived, never compared. */
  physics: number;
  /** When it was set, as an ISO date. */
  date: string;
}
/**
 * The name a track's best lap is saved under. An original circuit uses its id. A custom layout adds a
 * fingerprint of its shape, so editing the layout starts a fresh record while renaming it does not.
 */
export function recordKey(courseId: CourseId, layout?: TrackLayout | null) {
  if (!layout) return courseId;
  // Only what changes the ground is hashed, in a fixed order, so the same shape always gives the same name
  // however the file was written: a jump's editor highlight, an absent optional value and the order of
  // properties make no difference.
  const berms = layout.bermHeights?.some(h => h !== null) ? layout.bermHeights : null;
  const shape = [
    layout.points,
    layout.jumps.map(j => [j.position, j.height, j.rise, j.flat, j.fall, obstacleType(j), j.gap || 0]),
    berms,
  ];
  const text = JSON.stringify(shape);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return `${courseId}/custom-${hash.toString(16).padStart(8, '0')}`;
}
/**
 * Whether a finished lap may become the saved best: only a person's own clean lap. Not a computer rider, not
 * a lap with a shortcut return, not one ridden by the review autopilot or with test overrides switched on.
 */
export function lapCountsForRecord(lap: {valid: boolean}, rider: {human: boolean}, assisted: boolean) {
  return rider.human && lap.valid && !assisted;
}
function asLapRecord(v: unknown): LapRecord | null {
  if (!isObject(v) || typeof v.time !== 'number' || !(v.time > 0) || !Number.isFinite(v.time)) return null;
  if (!Array.isArray(v.sectors) || !v.sectors.every(t => typeof t === 'number' && Number.isFinite(t))) return null;
  if (typeof v.physics !== 'number') return null;
  return {time: v.time, sectors: v.sectors, physics: v.physics, date: typeof v.date === 'string' ? v.date : ''};
}
/**
 * Moves best laps ridden on an older physics version out of `bestLaps` into `archived`, grouped by version.
 * They are kept for reference and never shown as the time to beat. A lap from a newer version is left alone:
 * it belongs to a newer build, and an old tab must not put it away. Changes `records` in place.
 */
function archiveOldLaps(records: Record<string, any>, physics: number) {
  if (!isObject(records.bestLaps)) return;
  for (const [key, value] of Object.entries(records.bestLaps)) {
    const record = asLapRecord(value);
    if (!record || record.physics >= physics) continue;
    if (!isObject(records.archived)) records.archived = {};
    const group = `physics-${record.physics}`;
    if (!isObject(records.archived[group])) records.archived[group] = {};
    const kept = asLapRecord(records.archived[group][key]);
    if (!kept || record.time < kept.time) records.archived[group][key] = record;
    delete records.bestLaps[key];
  }
}
export type SaveStorage = Pick<Storage, 'getItem' | 'setItem'>;
/** Where the loaded data came from. `newer` means a later build wrote the save, so this build must not write. */
export type SaveSource = 'save' | 'legacy' | 'newer';

function parse(text: string | null): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(text || 'null');
    return isObject(value) ? value : null;
  } catch {
    return null;
  }
}
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

export function defaultSave(): SaveData {
  return {
    version: SAVE_VERSION,
    settings: {
      slideAggression: 1,
      volumes: {...DEFAULT_VOLUMES},
      showGhost: true,
      catchUp: false,
      wearPhysics: true,
      riders: defaultRiders(),
    },
    layouts: {},
    records: {},
    career: {},
  };
}
/** Defaults, with anything an older build stored under its own keys. */
function fromLegacy(storage: SaveStorage | null): SaveData {
  const data = defaultSave();
  if (!storage) return data;
  data.settings.slideAggression = loadSlideAggression(storage);
  for (const id of COURSE_IDS) {
    const layout = loadLayout(id, storage);
    if (layout) data.layouts[id] = layout;
  }
  return data;
}
/** Reads a stored save, keeping every valid part and replacing invalid parts with defaults. */
function fromStored(v: Record<string, unknown>, physics: number): SaveData {
  const data = defaultSave();
  if (isObject(v.settings) && typeof v.settings.slideAggression === 'number')
    data.settings.slideAggression = normalizeSlideAggression(v.settings.slideAggression);
  if (isObject(v.settings)) data.settings.volumes = normalizeVolumes(v.settings.volumes);
  if (isObject(v.settings) && typeof v.settings.showGhost === 'boolean') data.settings.showGhost = v.settings.showGhost;
  if (isObject(v.settings) && typeof v.settings.catchUp === 'boolean') data.settings.catchUp = v.settings.catchUp;
  if (isObject(v.settings) && typeof v.settings.wearPhysics === 'boolean')
    data.settings.wearPhysics = v.settings.wearPhysics;
  if (isObject(v.layouts))
    for (const id of COURSE_IDS) {
      try {
        const layout = validateLayout(v.layouts[id]);
        if (layout.courseId === id) data.layouts[id] = layout;
      } catch {}
    }
  if (isObject(v.records)) {
    data.records = JSON.parse(JSON.stringify(v.records));
    archiveOldLaps(data.records, physics);
  }
  if (isObject(v.career)) data.career = v.career;
  // A colour from a set that is not unlocked in this save is not kept.
  if (isObject(v.settings))
    data.settings.riders = normalizeRiders(v.settings.riders, normalizeProgress(data.career).unlocks);
  return data;
}

export class SaveStore {
  /** What this page currently believes. Refreshed from storage on every write, so other tabs' changes are kept. */
  data: SaveData;
  readonly source: SaveSource;
  /** The stored text when it could not be used, kept so the first write can set a copy aside. */
  private damaged: string | null = null;

  /** `storage` is the browser's localStorage, or null when the browser blocks it. */
  constructor(
    private storage: SaveStorage | null,
    /** The physics version best laps must match. Tests pass other values. */
    private physics: number = PHYSICS_VERSION,
  ) {
    let text: string | null = null;
    try {
      text = storage?.getItem(SAVE_KEY) ?? null;
    } catch {}
    const stored = parse(text);
    const version = stored && typeof stored.version === 'number' ? stored.version : null;
    if (stored && version === SAVE_VERSION) {
      this.data = fromStored(stored, this.physics);
      this.source = 'save';
    } else {
      // No save yet, a damaged one, or one from a later build: fall back to defaults plus the older keys.
      this.data = fromLegacy(storage);
      this.source = version !== null && version > SAVE_VERSION ? 'newer' : 'legacy';
      if (text !== null && this.source === 'legacy') this.damaged = text;
    }
  }
  /** True once the browser has refused a write in this visit: memory may then hold more than storage does. */
  private unsaved = false;
  /** True when a later build wrote the save. Changes then last for this visit only. */
  get readOnly() {
    return this.source === 'newer';
  }
  /**
   * Applies one change to the stored save. The save is read again first, so a change made in another tab since
   * this page loaded is kept, and so is anything in it this build does not recognise.
   * Throws if the browser refuses the write.
   */
  private update(change: (stored: Record<string, any>) => void) {
    if (this.readOnly || !this.storage) return;
    let current: Record<string, unknown> | null = null;
    try {
      current = parse(this.storage.getItem(SAVE_KEY));
    } catch {}
    if (current && typeof current.version === 'number' && current.version > SAVE_VERSION) return;
    const stored: Record<string, any> =
      current && current.version === SAVE_VERSION ? current : JSON.parse(JSON.stringify(this.data));
    if (!isObject(stored.settings)) stored.settings = {...this.data.settings};
    if (!isObject(stored.layouts)) stored.layouts = {...this.data.layouts};
    change(stored);
    if (this.damaged !== null) {
      // Keep a copy of a save this build could not read before replacing it.
      this.storage.setItem(DAMAGED_SAVE_KEY, this.damaged);
      this.damaged = null;
    }
    try {
      this.storage.setItem(SAVE_KEY, JSON.stringify(stored));
    } catch (error) {
      this.unsaved = true;
      throw error;
    }
    if (!this.unsaved) {
      this.data = fromStored(stored, this.physics);
      return;
    }
    // An earlier write was refused, so memory holds things storage does not (a best lap or an unlock kept for
    // this visit). Reading storage back would drop them: apply the same change to what is in memory instead.
    const mine: Record<string, any> = JSON.parse(JSON.stringify(this.data));
    change(mine);
    this.data = fromStored(mine, this.physics);
  }
  /**
   * Stores records and career as they stand in `data`. A faster best lap another tab stored meanwhile is kept.
   * Throws if the browser refuses the write.
   */
  write() {
    const {records, career} = this.data;
    this.update(stored => {
      const theirs = isObject(stored.records) && isObject(stored.records.bestLaps) ? stored.records.bestLaps : {};
      Object.assign(stored, {records: JSON.parse(JSON.stringify(records)), career});
      for (const [key, value] of Object.entries(theirs)) {
        const other = asLapRecord(value);
        if (!other) continue;
        if (!isObject(stored.records.bestLaps)) stored.records.bestLaps = {};
        const ours = asLapRecord(stored.records.bestLaps[key]);
        if (!ours || other.physics > ours.physics || (other.physics === ours.physics && other.time < ours.time))
          stored.records.bestLaps[key] = other;
      }
    });
  }
  get slideAggression() {
    return this.data.settings.slideAggression;
  }
  /** Stores the power-slide setting. A browser that refuses storage does not stop the change applying. */
  setSlideAggression(value: number) {
    const next = normalizeSlideAggression(value);
    try {
      this.update(stored => (stored.settings.slideAggression = next));
    } catch {}
    this.data.settings.slideAggression = next;
    return next;
  }
  /** Whether Time Trial shows the ghost of the best lap. */
  get showGhost() {
    return this.data.settings.showGhost;
  }
  setShowGhost(show: boolean) {
    try {
      this.update(stored => (stored.settings.showGhost = show));
    } catch {}
    this.data.settings.showGhost = show;
    return show;
  }
  /** Whether the catch-up assist is on. It is off unless the player turns it on. */
  get catchUp() {
    return this.data.settings.catchUp;
  }
  setCatchUp(on: boolean) {
    try {
      this.update(stored => (stored.settings.catchUp = on));
    } catch {}
    this.data.settings.catchUp = on;
    return on;
  }
  /** Whether races are run with wear physics. Time Trial never is. */
  get wearPhysics() {
    return this.data.settings.wearPhysics;
  }
  setWearPhysics(on: boolean) {
    try {
      this.update(stored => (stored.settings.wearPhysics = on));
    } catch {}
    this.data.settings.wearPhysics = on;
    return on;
  }
  get volumes() {
    return this.data.settings.volumes;
  }
  /** Stores the four volume sliders. A browser that refuses storage does not stop the change applying. */
  setVolumes(volumes: Volumes) {
    const next = normalizeVolumes(volumes);
    try {
      this.update(stored => (stored.settings.volumes = next));
    } catch {}
    this.data.settings.volumes = next;
    return next;
  }
  /** The saved best lap for a track (see recordKey), or null. Laps from another physics version do not count. */
  bestLap(key: string): LapRecord | null {
    const laps = this.data.records.bestLaps;
    const record = isObject(laps) ? asLapRecord(laps[key]) : null;
    return record && record.physics === this.physics ? record : null;
  }
  /**
   * Offers a finished lap as the best for a track. It is kept only if it beats the saved one, checked against
   * what is stored now so another tab's faster lap is not lost. Returns true when it is the new best. If the
   * browser refuses to store it, it still counts for this visit.
   */
  submitLap(key: string, lap: {time: number; sectors: number[]}, date = new Date().toISOString()) {
    if (!(lap.time > 0) || !Number.isFinite(lap.time)) return false;
    const record: LapRecord = {time: lap.time, sectors: [...lap.sectors], physics: this.physics, date};
    const offer = (records: Record<string, any>) => {
      archiveOldLaps(records, this.physics);
      if (!isObject(records.bestLaps)) records.bestLaps = {};
      const kept = asLapRecord(records.bestLaps[key]);
      // A lap already there from a newer build stays; this one then counts for this visit only.
      if (kept && (kept.physics > record.physics || kept.time <= record.time)) return false;
      records.bestLaps[key] = record;
      return true;
    };
    let stored: boolean | null = null;
    try {
      this.update(save => {
        if (!isObject(save.records)) save.records = {};
        stored = offer(save.records);
      });
    } catch {
      // The browser refused the write (storage full): nothing was kept, so fall through to this visit only.
      stored = null;
    }
    // Not stored (blocked storage, or a save from a newer version): keep it for this visit.
    return stored ?? offer(this.data.records);
  }
  /** The four players' riders. */
  get riders() {
    return this.data.settings.riders;
  }
  /**
   * Changes one player's rider. Refused, with every reason, if a name or number is invalid, another player has
   * the number or a colour is locked; nothing is changed then. A browser that refuses storage does not stop
   * an accepted change applying for this visit.
   */
  setRider(player: number, input: RiderInput): {ok: true; value: RiderSettings} | {ok: false; errors: string[]} {
    if (!Number.isInteger(player) || player < 0 || player >= this.riders.length)
      return {ok: false, errors: ['There is no such player.']};
    let result = checkRider(input, player, this.riders, this.unlocks);
    if (!result.ok) return result;
    try {
      this.update(stored => {
        // Checked again against what is stored now: another tab may have taken the number meanwhile.
        const progress = normalizeProgress(stored.career);
        const riders = normalizeRiders(stored.settings.riders, progress.unlocks);
        result = checkRider(input, player, riders, progress.unlocks);
        if (!result.ok) return;
        riders[player] = result.value;
        stored.settings.riders = riders;
      });
    } catch {}
    if (result.ok) {
      const riders = [...this.data.settings.riders];
      riders[player] = result.value;
      this.data.settings.riders = riders;
    }
    return result;
  }
  /** What has been unlocked: colour sets and Pro pace. */
  get unlocks() {
    return normalizeProgress(this.data.career).unlocks;
  }
  /** Applies an award to the stored career, read afresh so one made in another tab is not repeated. */
  private award<T>(change: (progress: Progress) => {progress: Progress; awarded: T}, none: T): T {
    let awarded = none,
      stored = false;
    const apply = (career: Record<string, unknown>) => {
      const result = change(normalizeProgress(career));
      awarded = result.awarded;
      return {...career, ...result.progress};
    };
    try {
      let changed = false;
      this.update(save => {
        save.career = apply(isObject(save.career) ? save.career : {});
        changed = true;
      });
      // Only once the browser has taken the write: a refused one leaves nothing stored.
      stored = changed;
    } catch {}
    // Not stored (blocked or full storage, or a save from a newer version): it counts for this visit.
    if (!stored) this.data.career = apply(this.data.career);
    return awarded;
  }
  /**
   * A human won the main of a championship round. Unlocks the next colour set the first time it is reported
   * for that round of that season, and returns the set; null when it was already rewarded or none is left.
   */
  awardRoundWin(season: Season, round: number): ColorSet | null {
    return this.award(progress => awardRoundWin(progress, `${season.seed}:${round}`), null);
  }
  /** A human won the championship. Unlocks Pro pace; true the first time. */
  awardSeasonWin(): boolean {
    return this.award(awardSeasonWin, false);
  }
  /** The championship season in progress or last finished, or null. */
  get season(): Season | null {
    // A season to play has somebody playing in it.
    const season = asSeason(this.data.career.season);
    // And is on a pace setting this save has: Pro has to be unlocked.
    return season?.entrants[0].human && allowedPace(season.difficulty, this.unlocks) === season.difficulty
      ? season
      : null;
  }
  /**
   * Stores the season (null forgets it). Returns false when it could not be kept beyond this visit: storage
   * blocked or full, or the save belongs to a newer version of the game.
   */
  setSeason(season: Season | null) {
    // Kept only if the change was made and the browser took the write.
    let changed = false,
      kept = false;
    try {
      this.update(stored => {
        stored.career = {...(isObject(stored.career) ? stored.career : {}), season};
        changed = true;
      });
      kept = changed;
    } catch {}
    this.data.career = {...this.data.career, season};
    return kept;
  }
  layout(id: CourseId): TrackLayout | null {
    return this.data.layouts[id] || null;
  }
  /**
   * Stores a custom layout for its course. Throws on an invalid layout, and whenever the layout cannot be kept
   * (storage blocked or full, or the save belongs to a newer version), so the editor can say so.
   */
  saveLayout(layout: TrackLayout) {
    const valid = validateLayout(layout);
    if (!this.storage) throw new Error('This browser is blocking saved data, so the layout cannot be kept.');
    if (this.readOnly)
      throw new Error('The saved data here is from a newer version of the game. Update to save layouts.');
    this.update(stored => (stored.layouts[valid.courseId] = valid));
    this.data.layouts[valid.courseId] = valid;
  }
}
/** The browser's storage, or null where it is blocked (private windows, some embedded views). */
export function browserStorage(): SaveStorage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}
