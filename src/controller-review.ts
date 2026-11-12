import type {GamepadLike} from './input';
/** Visible dev-only Xbox fixture: exercises the same sampled input path as hardware. */
export function mountControllerReview(publish: (pad: GamepadLike) => void) {
  const pad = {
    index: 9000,
    id: 'Simulated Xbox / review',
    connected: true,
    axes: [0, 0, 0, 0],
    buttons: Array.from({length: 16}, () => ({value: 0})),
  };
  publish(pad);
  const panel = document.createElement('aside');
  panel.id = 'controller-review';
  panel.innerHTML =
    '<strong>SIMULATED XBOX INPUT</strong><div>' +
    [
      ['D-pad Up', 12],
      ['D-pad Down', 13],
      ['D-pad Left', 14],
      ['D-pad Right', 15],
      ['Xbox A', 0],
      ['Xbox B', 1],
      ['Xbox X', 2],
      ['Xbox Y', 3],
      ['Xbox LB', 4],
      ['Xbox RB', 5],
      ['Xbox Menu', 9],
    ]
      .map(([name, n]) => `<button data-button="${n}" tabindex="-1">${name}</button>`)
      .join('') +
    '<button data-axis="2" data-value="1" tabindex="-1">Right stick right</button><button data-axis="3" data-value="-1" tabindex="-1">Right stick up</button></div>';
  panel.style.cssText =
    'position:fixed;right:8px;top:8px;width:330px;background:#151c2ef2;border:1px solid #ffce72;padding:10px;z-index:300;font-size:11px;color:#ffce72';
  panel.querySelectorAll<HTMLButtonElement>('button').forEach(b => {
    b.style.cssText = 'font-size:11px;padding:6px;margin:2px';
    b.onpointerdown = e => e.preventDefault();
    b.onclick = () => {
      const n = Number(b.dataset.button ?? b.dataset.axis);
      if (b.dataset.button !== undefined) pad.buttons[n].value = 1;
      else pad.axes[n] = Number(b.dataset.value);
      setTimeout(() => {
        if (b.dataset.button !== undefined) pad.buttons[n].value = 0;
        else pad.axes[n] = 0;
      }, 160);
    };
  });
  document.body.append(panel);
}
