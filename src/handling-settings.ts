export const SLIDE_AGGRESSION_KEY = 'afterglow.slide-aggression.v1';
export const normalizeSlideAggression = (value: number) =>
  Number.isFinite(value) ? Math.max(0, Math.min(2, value)) : 1;
export function loadSlideAggression(storage: Pick<Storage, 'getItem'>) {
  try {
    const raw = storage.getItem(SLIDE_AGGRESSION_KEY);
    return raw === null || !raw.trim() ? 1 : normalizeSlideAggression(Number(raw));
  } catch {
    return 1;
  }
}
