// The rider editor: a window on the setup screen where a player sets their name, number, colours and helmet.
import {cssColor} from '../config';
import {
  BASE_COLORS,
  COLOR_SETS,
  HELMETS,
  HELMET_NAMES,
  NAME_MAX,
  type RiderInput,
  type RiderSettings,
} from '../rider-settings';
import {el, escapeHtml} from './dom';

export const RIDER_PARTS = ['bike', 'kit', 'helmet'] as const;
export type RiderPart = (typeof RIDER_PARTS)[number];

export function riderEditorHtml() {
  return (
    `<div id="rider-editor" class="modal hidden"><form id="rider-form" class="modal-card rider-card" novalidate>` +
    `<div class="eyebrow" id="rider-editor-title">YOUR RIDER</div>` +
    `<div class="rider-fields"><label>NAME<input id="rider-name" type="text" maxlength="${NAME_MAX}" ` +
    `autocomplete="off" autocapitalize="characters" spellcheck="false"></label>` +
    `<label>NUMBER<input id="rider-number" type="text" inputmode="numeric" maxlength="3" autocomplete="off">` +
    `</label></div>` +
    RIDER_PARTS.map(
      part =>
        `<div class="swatch-label">${part.toUpperCase()} COLOUR</div>` +
        `<div class="swatches" id="color-${part}" role="radiogroup" aria-label="${part} colour"></div>`,
    ).join('') +
    `<label class="rider-design">HELMET DESIGN<select id="rider-design">` +
    HELMETS.map(d => `<option value="${d}">${HELMET_NAMES[d]}</option>`).join('') +
    `</select></label>` +
    `<p id="rider-locks" class="rider-locks"></p>` +
    `<p id="rider-errors" class="rider-errors" role="alert"></p>` +
    `<button id="rider-save" type="submit" class="primary">SAVE RIDER <span>↗</span></button>` +
    `<button id="rider-cancel" type="button" class="text-button">CANCEL</button></form></div>`
  );
}
/**
 * The colour buttons for one part. Every colour is listed; one from a set that is still locked is shown
 * disabled with the set's name, so it cannot be chosen.
 */
export function swatchesHtml(part: RiderPart, selected: number, unlocks: readonly string[]) {
  const swatch = (color: number, lock: string | null) =>
    `<button type="button" class="swatch${lock ? ' locked' : ''}" role="radio" data-part="${part}" ` +
    `data-color="${color}" aria-checked="${color === selected}" style="--swatch:${cssColor(color)}" ` +
    (lock
      ? `disabled title="${escapeHtml(lock)}" aria-label="${escapeHtml(lock)}"`
      : `aria-label="${cssColor(color)}"`) +
    `></button>`;
  return (
    BASE_COLORS.map(color => swatch(color, null)).join('') +
    COLOR_SETS.map(set =>
      set.colors
        .map(color => swatch(color, unlocks.includes(set.id) ? null : `${set.name}: locked. Win a championship round.`))
        .join(''),
    ).join('')
  );
}
/** "2 of 5 colour sets unlocked. …" for the foot of the editor. */
export function locksText(unlocks: readonly string[]) {
  const open = COLOR_SETS.filter(set => unlocks.includes(set.id)).length;
  return open === COLOR_SETS.length
    ? 'Every colour set is unlocked.'
    : `${open} of ${COLOR_SETS.length} extra colour sets unlocked. Winning a championship round unlocks the next.`;
}
/** The button on a player's row of the setup screen: their number and name, as plain text. */
export function riderButtonHtml(player: number, rider: RiderSettings) {
  return (
    `<button type="button" class="rider-button" data-rider="${player}" ` +
    `aria-label="Edit player ${player + 1}'s rider">` +
    `<b>#${rider.number}</b> <span>${escapeHtml(rider.name)}</span><small>EDIT RIDER</small></button>`
  );
}

/** Fills the editor for a player and shows it. */
export function showRiderEditor(player: number, rider: RiderSettings, unlocks: readonly string[]) {
  el('rider-editor-title').textContent = `PLAYER ${player + 1} / YOUR RIDER`;
  el<HTMLInputElement>('rider-name').value = rider.name;
  el<HTMLInputElement>('rider-number').value = String(rider.number);
  for (const part of RIDER_PARTS) el(`color-${part}`).innerHTML = swatchesHtml(part, rider[part], unlocks);
  el<HTMLSelectElement>('rider-design').value = rider.design;
  el('rider-locks').textContent = locksText(unlocks);
  el('rider-errors').textContent = '';
  el('rider-editor').classList.remove('hidden');
  el<HTMLInputElement>('rider-name').focus();
}
/** Marks a colour as the one chosen for its part. */
export function chooseSwatch(button: HTMLElement) {
  for (const other of button.parentElement!.querySelectorAll('.swatch'))
    other.setAttribute('aria-checked', String(other === button));
}
/** What the editor holds now, as typed. */
export function readRiderEditor(): RiderInput {
  const color = (part: RiderPart) => {
    const chosen = el(`color-${part}`).querySelector<HTMLElement>('[aria-checked="true"]');
    return chosen ? Number(chosen.dataset.color) : null;
  };
  return {
    name: el<HTMLInputElement>('rider-name').value,
    number: el<HTMLInputElement>('rider-number').value,
    bike: color('bike'),
    kit: color('kit'),
    helmet: color('helmet'),
    design: el<HTMLSelectElement>('rider-design').value,
  };
}
