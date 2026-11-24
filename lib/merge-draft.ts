/**
 * Мерж черновика формы при конфликте ревизий (409).
 * base — книга, с которой пользователь открыл форму; incoming — свежая книга другого участника;
 * draft — текущие правки пользователя. Бесконфликтные чужие изменения подтягиваются,
 * правки пользователя никогда не теряются; поля, изменённые обоими, остаются в черновике
 * и попадают в conflicts для подсветки «было/стало».
 */
export function mergeDraft<T extends Record<string, unknown>>(base: T, incoming: T, draft: T): { merged: T; conflicts: string[] } {
  const merged: Record<string, unknown> = { ...draft };
  const conflicts: string[] = [];
  const keys = new Set([...Object.keys(base), ...Object.keys(incoming), ...Object.keys(draft)]);
  for (const key of keys) {
    const b = base[key], i = incoming[key], d = draft[key];
    const same = (x: unknown, y: unknown) => JSON.stringify(x) === JSON.stringify(y);
    if (same(d, b)) {
      if (!same(i, b)) merged[key] = i;
    } else if (!same(i, b) && !same(i, d)) {
      conflicts.push(key);
    }
  }
  return { merged: merged as T, conflicts };
}
