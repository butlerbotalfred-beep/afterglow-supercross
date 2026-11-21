// One versioned save for everything the game remembers: settings, custom layouts, records and career.
// Older builds kept the power-slide setting and custom layouts under their own keys. Those keys are read when no
// save exists yet and are never changed or deleted, so an older build still finds its data.
import type {CourseId} from './courses';
import {loadSlideAggression, normalizeSlideAggression} from './handling-settings';
import {COURSE_IDS, loadLayout, validateLayout, type TrackLayout} from './track-layout';

export const SAVE_KEY = 'afterglow.save';
export const SAVE_VERSION = 1;

export interface SaveData {
  version: number;
  settings: {slideAggression: number};
  layouts: Partial<Record<CourseId, TrackLayout>>;
  /** Best times and similar; filled in by later milestones and kept as stored until then. */
  records: Record<string, unknown>;
  /** Career progress; filled in by later milestones and kept as stored until then. */
  career: Record<string, unknown>;
}
export type SaveStorage = Pick<Storage, 'getItem' | 'setItem'>;
/** Where the loaded data came from. `newer` means a later build wrote the save, so this build must not write. */
export type SaveSource = 'save' | 'legacy' | 'newer';

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

export function defaultSave(): SaveData {
  return {version: SAVE_VERSION, settings: {slideAggression: 1}, layouts: {}, records: {}, career: {}};
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
function fromStored(v: Record<string, unknown>): SaveData {
  const data = defaultSave();
  if (isObject(v.settings) && typeof v.settings.slideAggression === 'number')
    data.settings.slideAggression = normalizeSlideAggression(v.settings.slideAggression);
  if (isObject(v.layouts))
    for (const id of COURSE_IDS) {
      try {
        const layout = validateLayout(v.layouts[id]);
        if (layout.courseId === id) data.layouts[id] = layout;
      } catch {}
    }
  if (isObject(v.records)) data.records = v.records;
  if (isObject(v.career)) data.career = v.career;
  return data;
}

export class SaveStore {
  readonly data: SaveData;
  readonly source: SaveSource;

  /** `storage` is the browser's localStorage, or null when the browser blocks it. */
  constructor(private storage: SaveStorage | null) {
    let stored: unknown = null;
    try {
      stored = JSON.parse(storage?.getItem(SAVE_KEY) || 'null');
    } catch {}
    const version = isObject(stored) && typeof stored.version === 'number' ? stored.version : null;
    if (isObject(stored) && version === SAVE_VERSION) {
      this.data = fromStored(stored);
      this.source = 'save';
    } else {
      // No save yet, a damaged one, or one from a later build: fall back to defaults plus the older keys.
      this.data = fromLegacy(storage);
      this.source = version !== null && version > SAVE_VERSION ? 'newer' : 'legacy';
    }
  }
  /** True when a later build wrote the save. Changes then last for this visit only. */
  get readOnly() {
    return this.source === 'newer';
  }
  /** Writes the save. Throws if the browser refuses, so callers can choose to tell the player. */
  write() {
    if (this.readOnly || !this.storage) return;
    this.storage.setItem(SAVE_KEY, JSON.stringify(this.data));
  }
  get slideAggression() {
    return this.data.settings.slideAggression;
  }
  /** Stores the power-slide setting. A browser that refuses storage does not stop the change applying. */
  setSlideAggression(value: number) {
    this.data.settings.slideAggression = normalizeSlideAggression(value);
    try {
      this.write();
    } catch {}
    return this.data.settings.slideAggression;
  }
  layout(id: CourseId): TrackLayout | null {
    return this.data.layouts[id] || null;
  }
  /** Stores a custom layout for its course. Throws on an invalid layout or if the browser refuses the write. */
  saveLayout(layout: TrackLayout) {
    const valid = validateLayout(layout);
    const previous = this.data.layouts[valid.courseId];
    this.data.layouts[valid.courseId] = valid;
    try {
      this.write();
    } catch (error) {
      if (previous) this.data.layouts[valid.courseId] = previous;
      else delete this.data.layouts[valid.courseId];
      throw error;
    }
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
