// Pause menu markup and its message.
import type {Rider} from '../physics';
import {directionSettings, slideSettings} from './ride-settings';

export function pauseMenuHtml() {
  return (
    `<div id="pause" class="modal hidden"><div class="modal-card">` +
    `<div class="eyebrow">EVERY RIDER. ONE RACE.</div><h2>TAKE A BREATHER.</h2>` +
    `<p id="pause-message">The shared race is paused.</p>` +
    `<button id="resume" class="primary">BACK TO THE DIRT <span>↗</span></button>` +
    `<div class="button-row"><button id="restart-pause">RESTART RACE</button>` +
    `<button id="setup-pause">RACE SETUP</button></div>` +
    `<button id="pause-editor">EDIT THIS ` +
    `TRACK</button>${directionSettings('pause-')}${slideSettings('pause-')}<label ` +
    `class="pause-setting">Chase distance <input id="pause-distance" type="range" min="2.5" ` +
    `max="6" step=".1" value="3.2"></label>` +
    `<label class="pause-setting">Camera shake <input id="pause-shake" type="range" min="0" ` +
    `max="1" step=".05" value=".15"></label></div></div>`
  );
}
export function pauseMessage(missing: Rider | undefined) {
  return missing
    ? `Player ${missing.id + 1}'s controller disconnected. Reconnect it to resume, or return to setup.`
    : 'The shared race is paused for every rider.';
}
