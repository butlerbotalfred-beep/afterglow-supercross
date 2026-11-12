// Small DOM helpers shared by the game session and the UI modules.
export const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
export function setVisible(id: string, show: boolean) {
  el(id).classList.toggle('hidden', !show);
}
