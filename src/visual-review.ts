/** Local art-review controls. Each frame is reached through the normal riding simulation. */
export function mountVisualReview(actions: {shot: (kind: string) => void; run: () => void; stats: () => string}) {
  const panel = document.createElement('aside');
  panel.id = 'visual-review';
  panel.innerHTML =
    '<strong>ART REVIEW · SIMULATED RIDERS</strong><div>' +
    ['Grid', 'Jump', 'Berm', 'Rhythm', 'Four views', 'Crash landing', 'Rider contact']
      .map(name => `<button>${name}</button>`)
      .join('') +
    '<button>Run / freeze</button></div><output></output>';
  panel
    .querySelectorAll('button')
    .forEach(
      button =>
        (button.onclick = () =>
          button.textContent === 'Run / freeze' ? actions.run() : actions.shot(button.textContent!)),
    );
  document.body.append(panel);
  setInterval(() => {
    panel.querySelector('output')!.textContent = actions.stats();
  }, 1000);
}
