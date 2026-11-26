// Touch-direction, power-slide and volume settings, shown on the setup screen and in the pause menu.
export function directionSettings(prefix = '') {
  return (
    `<div id="${prefix}touch-directions" class="touch-directions hidden">` +
    `<div class="options-grid"><label>TOUCH STEERING<select id="${prefix}touch-steering">` +
    `<option value="regular">Regular</option><option value="inverted">Inverted</option>` +
    `</select></label><label>AIR PITCH<select id="${prefix}touch-pitch">` +
    `<option value="regular">Regular</option><option value="inverted">Inverted</option>` +
    `</select></label></div><p class="touch-direction-hint">Left turns left. Drag up to lift ` +
    `the nose.</p></div>`
  );
}
export function slideSettings(prefix = '') {
  return (
    `<div class="slide-setting"><label for="${prefix}slide-aggression">Power-slide aggression ` +
    `<output id="${prefix}slide-value" for="${prefix}slide-aggression">100%</output></label>` +
    `<input id="${prefix}slide-aggression" type="range" min="0" max="200" step="10" ` +
    `value="100" aria-describedby="${prefix}slide-help">` +
    `<p id="${prefix}slide-help">0% off · 100% standard · 200% aggressive<br>Adjusts throttle ` +
    `and brake slides. Applies immediately.</p></div>`
  );
}
const VOLUME_LABELS = {master: 'Master volume', engine: 'Engines', effects: 'Effects', crowd: 'Crowd'};
/** The four volume sliders. Their ids are `vol-master`, `vol-engine`, `vol-effects` and `vol-crowd` after the prefix. */
export function volumeSettings(prefix = '') {
  const sliders = Object.entries(VOLUME_LABELS).map(
    ([key, label]) =>
      `<div><label for="${prefix}vol-${key}">${label} <output id="${prefix}vol-${key}-value" ` +
      `for="${prefix}vol-${key}">80%</output></label>` +
      `<input id="${prefix}vol-${key}" type="range" min="0" max="100" step="5" value="80"></div>`,
  );
  return `<div class="slide-setting volume-setting">${sliders.join('')}</div>`;
}
