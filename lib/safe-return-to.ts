/** Возврат после входа только внутрь приложения: без `//host`, `/\host`, внешних схем и C0-управляющих (tab/CR/LF вырезает URL-парсер). */
export function safeReturnTo(value: string | null | undefined): string {
  if (!value) return "/";
  const cleaned = value.replace(/[\u0000-\u001F\u007F]/g, "");
  if (!cleaned.startsWith("/")) return "/";
  if (cleaned.startsWith("//") || cleaned.startsWith("/\\")) return "/";
  return cleaned;
}
