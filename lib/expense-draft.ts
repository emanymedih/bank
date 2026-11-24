import type { Expense } from "../app/ledger";

/** Черновик формы расхода: суммы — строкой в рублях, как в поле ввода (копейки → рубли). */
export type ExpenseDraft = { name: string; amount: string; date: string; category: string; payer: string };

const moneyText = (value: number) => String(value / 100).replace(".", ",");

export function expenseSnapshot(expense: Expense | undefined): ExpenseDraft | null {
  if (!expense) return null;
  return {
    name: expense.name,
    amount: moneyText(expense.amount),
    date: expense.date,
    category: expense.category ?? "",
    payer: expense.payer ?? "",
  };
}

export const expenseConflictLabels: Record<string, string> = {
  name: "название", amount: "сумма", date: "дата", category: "статья", payer: "кто оплатил",
};
