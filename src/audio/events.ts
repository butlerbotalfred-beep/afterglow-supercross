// What happened to the riders since the last frame that should be heard. No browser in here.

/** The few rider facts the sound events are worked out from. */
export interface RiderSound {
  human: boolean;
  grounded: boolean;
  airTime: number;
  crashes: number;
  finished: number | null;
  progress: {lap: number};
}
/** One rider as last seen. */
export interface Seen {
  grounded: boolean;
  airTime: number;
  crashes: number;
  finished: boolean;
  lap: number;
  position: number;
}
export type SoundEvent =
  | {type: 'crash'; rider: number}
  | {type: 'bigAir'; rider: number; seconds: number}
  | {type: 'pass'; rider: number}
  | {type: 'lap'; rider: number}
  | {type: 'finish'; rider: number};

/** Air time, in seconds, from which the crowd reacts to a human rider's jump. */
export const BIG_AIR = 0.9;

export const see = (r: RiderSound, position: number): Seen => ({
  grounded: r.grounded,
  airTime: r.airTime,
  crashes: r.crashes,
  finished: r.finished !== null,
  lap: r.progress.lap,
  position,
});
/**
 * Compares the riders with how they were last seen. `positions` is each rider's race position, 1 for the
 * leader. Crashes are reported for every rider; the crowd and the stings follow human riders only. Passes
 * only count in a race (`racing`), and never for a rider who has crashed or finished in the same moment.
 */
export function soundEvents(before: Seen[], riders: RiderSound[], positions: number[], racing: boolean): SoundEvent[] {
  const events: SoundEvent[] = [];
  riders.forEach((r, rider) => {
    const was = before[rider];
    if (!was) return;
    const crashed = r.crashes > was.crashes;
    if (crashed) events.push({type: 'crash', rider});
    if (!r.human) return;
    if (r.grounded && !was.grounded && was.airTime >= BIG_AIR && !crashed)
      events.push({type: 'bigAir', rider, seconds: was.airTime});
    const finished = r.finished !== null;
    if (finished && !was.finished) events.push({type: 'finish', rider});
    else if (r.progress.lap > was.lap && !finished) events.push({type: 'lap', rider});
    if (racing && !crashed && !finished && positions[rider] < was.position) events.push({type: 'pass', rider});
  });
  return events;
}
