// Touch-direction and power-slide settings, shown on the setup screen and in the pause menu.
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
