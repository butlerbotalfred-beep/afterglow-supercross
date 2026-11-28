// What each of the four players chooses for their rider: name, number, three colours and a helmet design.
// Also what can be unlocked. Nothing here touches the browser.
import {COLORS} from './config';

export const PLAYERS = 4;
export const NAME_MAX = 12;
export const NUMBER_MIN = 1;
export const NUMBER_MAX = 999;

export const HELMETS = ['wave', 'stripe', 'split', 'checker'] as const;
export type HelmetDesign = (typeof HELMETS)[number];
export const HELMET_NAMES: Record<HelmetDesign, string> = {
  wave: 'Wave',
  stripe: 'Crown stripe',
  split: 'Split',
  checker: 'Chequered band',
};

export interface RiderSettings {
  /** Shown on the HUD, the standings and the results. Upper case, 1 to 12 characters. */
  name: string;
  /** On the number plates, 1 to 999. No two players have the same. */
  number: number;
  /** Bike plastics. Also the player's colour on the HUD, the map and the results. */
  bike: number;
  /** Jersey and trousers. */
  kit: number;
  /** Helmet shell. */
  helmet: number;
  design: HelmetDesign;
}

/** Colours every player can pick from the start. */
export const BASE_COLORS: number[] = COLORS;
export interface ColorSet {
  id: string;
  name: string;
  colors: number[];
}
/** Three more colours each. A championship round win unlocks the next one, in this order. */
export const COLOR_SETS: ColorSet[] = [
  {id: 'colors-neon', name: 'NEON', colors: [0x39ff88, 0xff3df0, 0xf6ff3d]},
  {id: 'colors-ember', name: 'EMBER', colors: [0xff5a1f, 0xffb400, 0x8c1c13]},
  {id: 'colors-midnight', name: 'MIDNIGHT', colors: [0x24306e, 0x6a4cff, 0x11c5d9]},
  {id: 'colors-forest', name: 'FOREST', colors: [0x1f6b45, 0x9bd35a, 0x5b3a1e]},
  {id: 'colors-chrome', name: 'CHROME', colors: [0xd7dde5, 0x8fa3b8, 0x3b4252]},
];
/** The fourth pace setting, unlocked by winning a championship. */
export const PRO_PACE = 'pace-pro';
export const UNLOCK_IDS = [...COLOR_SETS.map(set => set.id), PRO_PACE];

export const defaultRider = (player: number): RiderSettings => ({
  name: `PLAYER ${player + 1}`,
  number: player + 1,
  bike: COLORS[player],
  kit: COLORS[player],
  helmet: COLORS[player],
  design: 'wave',
});
export const defaultRiders = () => Array.from({length: PLAYERS}, (_, player) => defaultRider(player));

/** The colours on offer: the base ones, then each unlocked set's. */
export function availableColors(unlocks: readonly string[]) {
  return [...BASE_COLORS, ...COLOR_SETS.filter(set => unlocks.includes(set.id)).flatMap(set => set.colors)];
}
/** The set a colour belongs to if that set is still locked, else null. */
export function lockedSet(color: number, unlocks: readonly string[]): ColorSet | null {
  return COLOR_SETS.find(set => set.colors.includes(color) && !unlocks.includes(set.id)) ?? null;
}

export type Checked<T> = {ok: true; value: T} | {ok: false; error: string};
/**
 * A name as it will be kept, or why it is refused. Spaces at the ends go, runs of spaces become one and
 * letters become capitals. Any printable characters are allowed, including ones that mean something in HTML:
 * a name is always shown as plain text.
 */
export function checkName(text: unknown): Checked<string> {
  if (typeof text !== 'string') return {ok: false, error: 'Enter a name.'};
  // Line breaks, tabs and other control characters, and characters that change the direction of text.
  if (/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202f\u2060-\u206f\ufeff]/.test(text))
    return {ok: false, error: 'A name can only have letters, numbers, spaces and symbols.'};
  const name = text.trim().replace(/\s+/g, ' ').toUpperCase();
  if (!name) return {ok: false, error: 'Enter a name.'};
  if ([...name].length > NAME_MAX) return {ok: false, error: `A name can be up to ${NAME_MAX} characters.`};
  return {ok: true, value: name};
}
/** A race number, or why it is refused: a whole number from 1 to 999, typed in digits. */
export function checkNumber(value: unknown): Checked<number> {
  const error = `A number is a whole number from ${NUMBER_MIN} to ${NUMBER_MAX}.`;
  const n = typeof value === 'string' && /^\d{1,3}$/.test(value.trim()) ? Number(value.trim()) : value;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < NUMBER_MIN || n > NUMBER_MAX) return {ok: false, error};
  return {ok: true, value: n};
}

export interface RiderInput {
  name: unknown;
  number: unknown;
  bike: unknown;
  kit: unknown;
  helmet: unknown;
  design: unknown;
}
/**
 * Checks one player's choices against the other players' and what is unlocked. Either the settings to keep,
 * or every reason they are refused; nothing is corrected silently except the tidying of the name.
 */
export function checkRider(
  input: RiderInput,
  player: number,
  riders: readonly RiderSettings[],
  unlocks: readonly string[],
): {ok: true; value: RiderSettings} | {ok: false; errors: string[]} {
  const errors: string[] = [];
  const name = checkName(input.name);
  if (!name.ok) errors.push(name.error);
  const number = checkNumber(input.number);
  if (!number.ok) errors.push(number.error);
  else {
    const other = riders.findIndex((r, i) => i !== player && r.number === number.value);
    if (other >= 0) errors.push(`Player ${other + 1} already has number ${number.value}.`);
  }
  const offered = availableColors(unlocks);
  const colors: number[] = [];
  for (const [label, color] of [
    ['bike', input.bike],
    ['kit', input.kit],
    ['helmet', input.helmet],
  ] as const) {
    if (typeof color === 'number' && offered.includes(color)) colors.push(color);
    else {
      const set = typeof color === 'number' ? lockedSet(color, unlocks) : null;
      errors.push(set ? `The ${set.name} colours are still locked.` : `Choose a ${label} colour from the list.`);
    }
  }
  const design = HELMETS.find(d => d === input.design);
  if (!design) errors.push('Choose a helmet design from the list.');
  if (errors.length || !name.ok || !number.ok || !design) return {ok: false, errors};
  return {
    ok: true,
    value: {name: name.value, number: number.value, bike: colors[0], kit: colors[1], helmet: colors[2], design},
  };
}
/**
 * The four players' settings from whatever was stored. A player whose stored settings would be refused gets
 * their defaults, with the first free number if another player already has the default one.
 */
export function normalizeRiders(stored: unknown, unlocks: readonly string[]): RiderSettings[] {
  const list = Array.isArray(stored) ? stored : [];
  const riders: (RiderSettings | null)[] = Array.from({length: PLAYERS}, () => null);
  const taken = () => riders.filter((r): r is RiderSettings => !!r);
  for (let player = 0; player < PLAYERS; player++) {
    const v = list[player];
    if (!v || typeof v !== 'object') continue;
    // Checked against the players already accepted, so of two with the same number the first keeps it.
    const others = riders.map((r, i) => r ?? {...defaultRider(i), number: 0});
    const checked = checkRider(v as RiderInput, player, others, unlocks);
    if (checked.ok) riders[player] = checked.value;
  }
  for (let player = 0; player < PLAYERS; player++) {
    if (riders[player]) continue;
    const rider = defaultRider(player);
    const used = new Set(taken().map(r => r.number));
    while (used.has(rider.number)) rider.number++;
    riders[player] = rider;
  }
  return riders as RiderSettings[];
}

/** The unlocks in a stored list that this build knows, each once. */
export function normalizeUnlocks(stored: unknown): string[] {
  const list = Array.isArray(stored) ? stored : [];
  return UNLOCK_IDS.filter(id => list.includes(id));
}
export interface Progress {
  unlocks: string[];
  /** The round wins already rewarded, as "season seed:round", so a win is rewarded once. */
  awards: string[];
}
export function normalizeProgress(career: unknown): Progress {
  const c = career && typeof career === 'object' ? (career as Record<string, unknown>) : {};
  const awards = Array.isArray(c.awards) ? c.awards.filter((a): a is string => typeof a === 'string') : [];
  return {unlocks: normalizeUnlocks(c.unlocks), awards: [...new Set(awards)]};
}
/**
 * A human has won a championship main. The first time this is reported for a round, the next locked colour
 * set is unlocked; reported again for the same round, nothing changes. `awarded` is what was unlocked, if
 * anything: with every set unlocked a win still counts as rewarded.
 */
export function awardRoundWin(progress: Progress, key: string): {progress: Progress; awarded: ColorSet | null} {
  if (progress.awards.includes(key)) return {progress, awarded: null};
  const awarded = COLOR_SETS.find(set => !progress.unlocks.includes(set.id)) ?? null;
  return {
    progress: {
      unlocks: awarded ? normalizeUnlocks([...progress.unlocks, awarded.id]) : progress.unlocks,
      awards: [...progress.awards, key],
    },
    awarded,
  };
}
/** A human has won the championship: Pro pace is unlocked, once. */
export function awardSeasonWin(progress: Progress): {progress: Progress; awarded: boolean} {
  if (progress.unlocks.includes(PRO_PACE)) return {progress, awarded: false};
  return {progress: {...progress, unlocks: normalizeUnlocks([...progress.unlocks, PRO_PACE])}, awarded: true};
}
/** The pace setting to race on: Pro only once it is unlocked, otherwise Expert in its place. */
export function allowedPace(difficulty: string, unlocks: readonly string[]) {
  return difficulty === 'pro' && !unlocks.includes(PRO_PACE) ? 'expert' : difficulty;
}
