// Ghost laps with no browser in them: recording a rider's best lap, packing it into a few kilobytes, and
// playing it back. A ghost stores where the bike was, not what the rider pressed, so it still plays back
// correctly after later tuning changes how the bike handles.
import {PHYSICS_VERSION, TUNING} from './config';

/** Where a bike is and how it is turned: everything the translucent ghost bike needs. */
export interface GhostPose {
  x: number;
  y: number;
  z: number;
  heading: number;
  pitch: number;
  lean: number;
}
/** A recorded lap, ready to store or play. */
export interface Ghost {
  /** The PHYSICS_VERSION the lap was ridden on. A ghost from another version is never loaded. */
  physics: number;
  /** The lap time in seconds. */
  time: number;
  /** The packed samples: see `packGhost`. */
  data: ArrayBuffer;
}

/** Physics steps between regular samples: 120 Hz physics gives 15 samples a second. */
export const GHOST_SAMPLE_STEPS = 8;
/**
 * A straight line between two samples may stray this far from the true path before an extra sample is kept.
 * Takeoffs, landings and crashes bend the path sharply inside one fifteenth of a second; the extra samples
 * there are what keep playback within GHOST_ACCURACY of the ride at every moment.
 */
const KEEP_WITHIN = 0.04;
/** Playback is never further than this from the recorded ride, in metres. */
export const GHOST_ACCURACY = 0.1;
/** A stored ghost is never larger than this. A lap that would need more (a very slow one) gets no ghost. */
export const GHOST_MAX_BYTES = 40 * 1024;

const MAGIC = 0x31474741; // "AGG1"
const HEADER_BYTES = 36;
const SAMPLE_BYTES = 14;
const TURN = Math.PI * 2;

interface Sample extends GhostPose {
  step: number;
}
const wrapAngle = (a: number) => a - TURN * Math.floor((a + Math.PI) / TURN);
const lerp = (a: number, b: number, f: number) => a + (b - a) * f;
const lerpAngle = (a: number, b: number, f: number) => a + wrapAngle(b - a) * f;

/** Collects one lap, a physics step at a time, keeping only the samples playback needs. */
export class GhostRecorder {
  private kept: Sample[] = [];
  /** Steps since the last kept sample, not yet known to be needed. */
  private pending: Sample[] = [];
  private next = 0;
  private full = false;
  /** Seconds from the start of the lap to step 0. Negative when step 0 is the pose just before the line. */
  private offset = 0;

  /** Starts a new lap. `offset` is the lap time of the first pose pushed, in seconds. */
  begin(offset = 0) {
    this.kept = [];
    this.pending = [];
    this.next = 0;
    this.full = false;
    this.offset = offset;
  }
  /** True while the lap is still small enough to be stored. */
  get recording() {
    return !this.full;
  }
  /**
   * Adds the bike's pose. `step` is how many physics steps of lap time have passed since the first pose; left
   * out, it is one more than the last. Passing it keeps the ghost on the lap clock when a step is skipped.
   */
  push(pose: GhostPose, step = this.next) {
    if (this.full || step < this.next) return;
    if (step > 65535 || HEADER_BYTES + (this.kept.length + 2) * SAMPLE_BYTES > GHOST_MAX_BYTES) {
      this.full = true;
      return;
    }
    this.next = step + 1;
    const now: Sample = {
      step,
      x: pose.x,
      y: pose.y,
      z: pose.z,
      heading: pose.heading,
      pitch: pose.pitch,
      lean: pose.lean,
    };
    const last = this.kept[this.kept.length - 1];
    if (!last) {
      this.kept.push(now);
      return;
    }
    // Would a straight line from the last kept sample to this one miss any step in between?
    const span = now.step - last.step;
    const strays = this.pending.some(p => {
      const f = (p.step - last.step) / span;
      return (
        Math.hypot(lerp(last.x, now.x, f) - p.x, lerp(last.y, now.y, f) - p.y, lerp(last.z, now.z, f) - p.z) >
        KEEP_WITHIN
      );
    });
    if (strays) {
      this.kept.push(this.pending[this.pending.length - 1]);
      this.pending = [];
    }
    if (now.step - this.kept[this.kept.length - 1].step >= GHOST_SAMPLE_STEPS) {
      this.kept.push(now);
      this.pending = [];
    } else this.pending.push(now);
  }
  /** The finished lap, or null when it was too long to store or nothing was recorded. */
  finish(time: number): Ghost | null {
    if (this.full || !this.kept.length || !(time > 0)) return null;
    const samples = this.kept.slice();
    const tail = this.pending[this.pending.length - 1];
    if (tail) samples.push(tail);
    return {physics: PHYSICS_VERSION, time, data: packGhost(samples, this.offset)};
  }
}

/**
 * Packs samples as 16-bit values. Header: magic, sample count, time offset, then the box the lap fits in.
 * Each sample: step number, then x, y, z as fractions of that box and heading, pitch, lean as fractions of a turn.
 */
function packGhost(samples: Sample[], offset: number) {
  const min = {x: Infinity, y: Infinity, z: Infinity},
    max = {x: -Infinity, y: -Infinity, z: -Infinity};
  for (const s of samples)
    for (const k of ['x', 'y', 'z'] as const) {
      min[k] = Math.min(min[k], s[k]);
      max[k] = Math.max(max[k], s[k]);
    }
  const buffer = new ArrayBuffer(HEADER_BYTES + samples.length * SAMPLE_BYTES);
  const view = new DataView(buffer);
  view.setUint32(0, MAGIC, true);
  view.setUint32(4, samples.length, true);
  view.setFloat32(8, offset, true);
  (['x', 'y', 'z'] as const).forEach((k, i) => {
    view.setFloat32(12 + i * 8, min[k], true);
    view.setFloat32(16 + i * 8, Math.max(1e-6, max[k] - min[k]), true);
  });
  const unit = (value: number, low: number, size: number) =>
    Math.round(Math.min(1, Math.max(0, (value - low) / size)) * 65535);
  samples.forEach((s, i) => {
    const at = HEADER_BYTES + i * SAMPLE_BYTES;
    view.setUint16(at, s.step, true);
    (['x', 'y', 'z'] as const).forEach((k, n) => {
      // Read the box back as stored, so packing and unpacking agree to the last bit.
      view.setUint16(
        at + 2 + n * 2,
        unit(s[k], view.getFloat32(12 + n * 8, true), view.getFloat32(16 + n * 8, true)),
        true,
      );
    });
    (['heading', 'pitch', 'lean'] as const).forEach((k, n) => {
      view.setUint16(at + 8 + n * 2, Math.round(((wrapAngle(s[k]) + Math.PI) / TURN) * 65535) % 65535, true);
    });
  });
  return buffer;
}

/** A ghost unpacked for playback. */
export class GhostPlayback {
  readonly time: number;
  private readonly times: Float32Array;
  private readonly poses: Float32Array;
  /** Where the last lookup landed: playback moves forward, so the next one starts here. */
  private cursor = 0;

  /** Throws when the data is not a ghost this version can read. */
  constructor(ghost: Ghost) {
    const view = new DataView(ghost.data);
    if (ghost.data.byteLength < HEADER_BYTES || view.getUint32(0, true) !== MAGIC) throw new Error('Not a ghost.');
    const count = view.getUint32(4, true);
    if (!count || ghost.data.byteLength !== HEADER_BYTES + count * SAMPLE_BYTES) throw new Error('Damaged ghost.');
    const offset = view.getFloat32(8, true);
    const low = [0, 1, 2].map(i => view.getFloat32(12 + i * 8, true));
    const size = [0, 1, 2].map(i => view.getFloat32(16 + i * 8, true));
    this.time = ghost.time;
    this.times = new Float32Array(count);
    this.poses = new Float32Array(count * 6);
    for (let i = 0; i < count; i++) {
      const at = HEADER_BYTES + i * SAMPLE_BYTES;
      this.times[i] = offset + view.getUint16(at, true) * TUNING.step;
      for (let n = 0; n < 3; n++)
        this.poses[i * 6 + n] = low[n] + (view.getUint16(at + 2 + n * 2, true) / 65535) * size[n];
      for (let n = 3; n < 6; n++)
        this.poses[i * 6 + n] = (view.getUint16(at + 2 + n * 2, true) / 65535) * TURN - Math.PI;
    }
  }
  get samples() {
    return this.times.length;
  }
  /** The pose `seconds` into the lap, held at the first or last sample outside the recording. */
  at(seconds: number, into: GhostPose = {x: 0, y: 0, z: 0, heading: 0, pitch: 0, lean: 0}): GhostPose {
    const {times, poses} = this;
    const last = times.length - 1;
    let i = Math.min(this.cursor, last);
    if (times[i] > seconds) i = 0;
    while (i < last && times[i + 1] <= seconds) i++;
    this.cursor = i;
    const j = Math.min(last, i + 1);
    const span = times[j] - times[i];
    const f = span > 0 ? Math.min(1, Math.max(0, (seconds - times[i]) / span)) : 0;
    const a = i * 6,
      b = j * 6;
    into.x = lerp(poses[a], poses[b], f);
    into.y = lerp(poses[a + 1], poses[b + 1], f);
    into.z = lerp(poses[a + 2], poses[b + 2], f);
    into.heading = lerpAngle(poses[a + 3], poses[b + 3], f);
    into.pitch = lerpAngle(poses[a + 4], poses[b + 4], f);
    into.lean = lerpAngle(poses[a + 5], poses[b + 5], f);
    return into;
  }
}

/** Where ghosts are kept. Either call may fail or never answer: a browser can refuse storage at any time. */
export interface GhostBackend {
  get(key: string): Promise<Ghost | null>;
  /**
   * Reads the stored ghost and writes back whatever `decide` returns for it, as one step that nothing else can
   * come between (another tab included). `decide` returns null to leave storage alone. Resolves with what is
   * stored afterwards.
   */
  update(key: string, decide: (stored: Ghost | null) => Ghost | null): Promise<Ghost | null>;
}

/** How long the browser's storage gets to answer before the game carries on without it, in milliseconds. */
const STORAGE_PATIENCE = 4000;

/**
 * The best-lap ghost for each track. Reads and writes go to the backend when there is one that works. When it
 * is missing, fails or does not answer, ghosts are kept for this session only and `sessionOnly` turns true so
 * the game can say so.
 */
export class GhostStore {
  sessionOnly: boolean;
  /** Called when storage answers after the game stopped waiting, with a ghost if one turned out to be the best. */
  onLate: ((key: string, ghost: Ghost | null) => void) | null = null;
  private memory = new Map<string, Ghost>();
  /** Offers are handled one at a time, so two laps finishing close together cannot overwrite each other. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private backend: GhostBackend | null,
    private physics: number = PHYSICS_VERSION,
    private patience = STORAGE_PATIENCE,
  ) {
    this.sessionOnly = !backend;
  }
  private usable(ghost: Ghost | null | undefined) {
    if (!ghost || ghost.physics !== this.physics || !(ghost.time > 0)) return null;
    try {
      new GhostPlayback(ghost);
      return ghost;
    } catch {
      return null;
    }
  }
  /** The faster of the session's ghost and one from storage becomes the session's ghost. */
  private adopt(key: string, stored: Ghost | null | undefined) {
    const found = this.usable(stored),
      held = this.usable(this.memory.get(key));
    const best = !held ? found : !found ? held : found.time < held.time ? found : held;
    if (best) this.memory.set(key, best);
    return best;
  }
  /**
   * Waits for storage, but not for ever. A failure turns storage off for the session; no answer in time shows
   * the notice and carries on, and if the answer does come later it is taken in and the notice cleared.
   */
  private async ask(key: string, work: (backend: GhostBackend) => Promise<Ghost | null>) {
    const backend = this.backend;
    if (!backend) return;
    let waiting = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const answer = work(backend).then(
      stored => {
        const before = this.memory.get(key);
        const best = this.adopt(key, stored);
        if (!waiting) {
          this.sessionOnly = !this.backend;
          this.onLate?.(key, best && best !== before ? best : null);
        }
      },
      () => {
        this.sessionOnly = true;
        this.backend = null;
      },
    );
    const gaveUp = new Promise<void>(resolve => (timer = setTimeout(resolve, this.patience)));
    await Promise.race([answer, gaveUp.then(() => waiting && (this.sessionOnly = true))]);
    waiting = false;
    clearTimeout(timer);
  }
  /** The ghost for a track, or null. A ghost from another physics version is never returned. */
  async load(key: string): Promise<Ghost | null> {
    await this.ask(key, backend => backend.get(key));
    return this.usable(this.memory.get(key));
  }
  /**
   * Offers a finished lap. It becomes the ghost only when the lap was valid and faster than the one held here
   * and the one in storage (or there is none yet). Returns true when it became the ghost.
   */
  submit(key: string, ghost: Ghost | null, valid: boolean): Promise<boolean> {
    const offer = async () => {
      if (!ghost || !valid || !this.usable(ghost)) return false;
      const held = this.usable(this.memory.get(key));
      if (held && held.time <= ghost.time) return false;
      this.memory.set(key, ghost);
      await this.ask(key, backend =>
        backend.update(key, stored => {
          // A ghost from a newer build of the game is somebody's best lap there: never write over it.
          if (stored && stored.physics > this.physics) return null;
          const current = this.usable(stored);
          return current && current.time <= ghost.time ? null : ghost;
        }),
      );
      return this.memory.get(key) === ghost;
    };
    const result = this.queue.then(offer, offer);
    this.queue = result.catch(() => {});
    return result;
  }
}

const DB_NAME = 'afterglow-ghosts';
const DB_STORE = 'ghosts';
/**
 * Ghosts in the browser's IndexedDB. Local storage is too small and already holds the track layouts.
 * Returns null when the browser has no IndexedDB at all; a database that will not open fails on first use.
 */
export function indexedDbGhosts(factory: IDBFactory | undefined = globalThis.indexedDB): GhostBackend | null {
  if (!factory) return null;
  let opening: Promise<IDBDatabase> | null = null;
  const open = () =>
    (opening ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open(DB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(DB_STORE);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('Ghost storage is blocked.'));
    }));
  const run = async <T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>) => {
    const db = await open();
    return new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(DB_STORE, mode);
      const request = work(transaction.objectStore(DB_STORE));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = transaction.onabort = () => reject(transaction.error);
    });
  };
  return {
    get: async key => (await run<Ghost | undefined>('readonly', store => store.get(key))) ?? null,
    async update(key, decide) {
      const db = await open();
      return new Promise<Ghost | null>((resolve, reject) => {
        const transaction = db.transaction(DB_STORE, 'readwrite');
        const store = transaction.objectStore(DB_STORE);
        let after: Ghost | null = null;
        const read = store.get(key);
        read.onsuccess = () => {
          const stored = (read.result as Ghost | undefined) ?? null;
          const next = decide(stored);
          after = next ?? stored;
          if (next) store.put(next, key);
        };
        transaction.oncomplete = () => resolve(after);
        transaction.onerror = transaction.onabort = () => reject(transaction.error);
      });
    },
  };
}
