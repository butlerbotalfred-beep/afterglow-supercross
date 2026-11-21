// One versioned save for everything the game remembers: settings, custom layouts, records and career.
// An older build, or a tab still running one, keeps using its own keys and does not see changes made here.
// Older builds kept the power-slide setting and custom layouts under their own keys. Those keys are read when no
// save exists yet and are never changed or deleted, so an older build still finds its data.
import type {CourseId} from './courses';
import {loadSlideAggression, normalizeSlideAggression} from './handling-settings';
import {COURSE_IDS, loadLayout, validateLayout, type TrackLayout} from './track-layout';

export const SAVE_KEY = 'afterglow.save';
export const SAVE_VERSION = 1;
/** Where a save this build could not read is copied before it is replaced. */
export const DAMAGED_SAVE_KEY = 'afterglow.save.damaged';

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
  /** What this page currently believes. Refreshed from storage on every write, so other tabs' changes are kept. */
  data: SaveData;
  readonly source: SaveSource;
  /** The stored text when it could not be used, kept so the first write can set a copy aside. */
  private damaged: string | null = null;

  /** `storage` is the browser's localStorage, or null when the browser blocks it. */
  constructor(private storage: SaveStorage | null) {
    let text: string | null = null;
    try {
      text = storage?.getItem(SAVE_KEY) ?? null;
    } catch {}
    const stored = parse(text);
    const version = stored && typeof stored.version === 'number' ? stored.version : null;
    if (stored && version === SAVE_VERSION) {
      this.data = fromStored(stored);
      this.source = 'save';
    } else {
      // No save yet, a damaged one, or one from a later build: fall back to defaults plus the older keys.
      this.data = fromLegacy(storage);
      this.source = version !== null && version > SAVE_VERSION ? 'newer' : 'legacy';
      if (text !== null && this.source === 'legacy') this.damaged = text;
    }
  }
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
    this.storage.setItem(SAVE_KEY, JSON.stringify(stored));
    this.data = fromStored(stored);
  }
  /** Stores records and career as they stand in `data`. Throws if the browser refuses the write. */
  write() {
    const {records, career} = this.data;
    this.update(stored => Object.assign(stored, {records, career}));
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
