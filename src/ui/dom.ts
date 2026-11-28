// Small DOM helpers shared by the game session and the UI modules.
export const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
export function setVisible(id: string, show: boolean) {
  el(id).classList.toggle('hidden', !show);
}
/**
 * Text made safe to put inside HTML, as content or as an attribute value: the five characters that mean
 * something in markup are replaced, so whatever a player typed is shown exactly as typed.
 */
export function escapeHtml(text: string) {
  return text.replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'})[c]!);
}
