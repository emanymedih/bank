// Сохранённый фильтр реестра: принимаем только известные значения, иначе сбрасываем.
export type SavedFilter = { filter: string; sort: string; query: string; mode: string };
const filters = new Set(["all", "active", "purchased", "preparation", "listed", "sold"]);
const sorts = new Set(["recent", "old", "profit"]);
const modes = new Set(["overview", "accounts"]);

export function parseSavedFilter(raw: string | null): SavedFilter | null {
  if (!raw) return null;
  try {
    const data = JSON.parse(raw) as Record<string, unknown>;
    if (!data || typeof data !== "object") return null;
    return {
      filter: typeof data.filter === "string" && filters.has(data.filter) ? data.filter : "all",
      sort: typeof data.sort === "string" && sorts.has(data.sort) ? data.sort : "recent",
      mode: typeof data.mode === "string" && modes.has(data.mode) ? data.mode : "overview",
      query: typeof data.query === "string" ? data.query.slice(0, 100) : "",
    };
  } catch { return null; }
}