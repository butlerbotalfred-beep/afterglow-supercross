// Every texture file the game downloads goes through here, so the loading bar can count them and the game
// works from any address (the path follows the page, not the site root).
import * as THREE from 'three';

let asked = 0,
  finished = 0;
type ProgressListener = (finished: number, asked: number, done: boolean) => void;
const listeners = new Set<ProgressListener>();
const tell = () => [...listeners].forEach(listener => listener(finished, asked, finished === asked));
/**
 * How long one texture may take before the loading screen stops waiting for it. The browser test changes it
 * through a global, set before the game starts, so it can hold textures back for longer or prove the limit works.
 */
const STALL_SECONDS = Number((globalThis as {AFTERGLOW_STALL_SECONDS?: number}).AFTERGLOW_STALL_SECONDS) || 30;

/** The address of a file in the art folder. */
export const artUrl = (file: string) => `${import.meta.env.BASE_URL}art/${file}`;

/** Starts loading a texture from the art folder. `onLoad` runs when its image is ready to draw. */
export function loadTexture(file: string, onLoad?: () => void): THREE.Texture {
  asked++;
  tell();
  let counted = false;
  const finish = () => {
    if (counted) return;
    counted = true;
    clearTimeout(stalled);
    finished++;
    tell();
  };
  // A download that hangs (a stalled connection reports neither success nor failure) stops holding up the
  // loading screen after a while. The texture still appears if it arrives later.
  const stalled = setTimeout(finish, STALL_SECONDS * 1000);
  return new THREE.TextureLoader().load(
    artUrl(file),
    () => {
      try {
        onLoad?.();
      } finally {
        finish();
      }
    },
    undefined,
    finish,
  );
}
/**
 * Calls `listener` now and on every change: how many texture files have finished out of how many were asked
 * for, and whether all of them are ready (true as well when none has been asked for). Returns a function that stops the calls.
 */
export function onTextureProgress(listener: ProgressListener) {
  listeners.add(listener);
  listener(finished, asked, finished === asked);
  return () => listeners.delete(listener);
}
