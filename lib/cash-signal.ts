/** Сигнал кассы: отрицательный остаток — тревога без паники, не «праздничная» плашка. */
export function cashTone(cash: number | null): "unknown" | "ok" | "negative" {
  if (cash === null) return "unknown";
  return cash < 0 ? "negative" : "ok";
}

/** Сумма перерасхода в копейках: насколько списания превысили поступления. */
export function overdraftAmount(cash: number | null): number {
  return cash !== null && cash < 0 ? -cash : 0;
}
