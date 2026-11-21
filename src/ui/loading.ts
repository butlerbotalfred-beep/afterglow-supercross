// The loading screen. Its markup and styles are in index.html so it shows before any script has downloaded.
// index.html also marks the page inert while it is up, and shows a message if the game fails to start.
import {onTextureProgress} from '../assets';

/** The share of the bar already filled when scripts have arrived and only textures remain. */
const SCRIPT_SHARE = 0.2;
let loading = false;

/** True while the loading screen covers the page. Input is ignored until it has gone. */
export const isLoading = () => loading;

/** Fills the bar as textures arrive and removes the loading screen once every one is ready. */
export function watchLoading(root: HTMLElement | null = document.getElementById('loading')) {
  if (!root) return;
  loading = true;
  const bar = root.querySelector<HTMLElement>('#loading-bar'),
    text = root.querySelector<HTMLElement>('#loading-text');
  const stop = onTextureProgress((finished, asked, done) => {
    const share = asked ? finished / asked : 0;
    if (bar) bar.style.width = `${Math.round((SCRIPT_SHARE + (1 - SCRIPT_SHARE) * share) * 100)}%`;
    if (text) text.textContent = asked ? `Loading textures ${finished} of ${asked}` : 'Loading';
    if (done) {
      loading = false;
      root.remove();
      document.getElementById('app')?.removeAttribute('inert');
      queueMicrotask(() => stop());
    }
  });
}
