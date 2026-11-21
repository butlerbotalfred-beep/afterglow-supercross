// The loading screen. Its markup and styles are in index.html so it shows before any script has downloaded.
import {onTextureProgress} from '../assets';

/** The share of the bar already filled when scripts have arrived and only textures remain. */
const SCRIPT_SHARE = 0.2;

/** Fills the bar as textures arrive and removes the loading screen once every one is ready. */
export function watchLoading(root: HTMLElement | null = document.getElementById('loading')) {
  if (!root) return;
  const bar = root.querySelector<HTMLElement>('#loading-bar'),
    text = root.querySelector<HTMLElement>('#loading-text');
  const stop = onTextureProgress((loaded, total, done) => {
    const share = total ? loaded / total : 0;
    if (bar) bar.style.width = `${Math.round((SCRIPT_SHARE + (1 - SCRIPT_SHARE) * share) * 100)}%`;
    if (text) text.textContent = total ? `Loading textures ${loaded} of ${total}` : 'Loading';
    if (done) {
      root.remove();
      queueMicrotask(() => stop());
    }
  });
}
