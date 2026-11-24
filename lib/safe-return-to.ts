/** Возврат после входа только внутрь приложения: без `//host`, `/\host` и внешних схем. */
export function safeReturnTo(value: string | null | undefined): string {
  if (!value) return "/";
  if (!value.startsWith("/")) return "/";
  if (value.startsWith("//") || value.startsWith("/\\")) return "/";
  return value;
}
