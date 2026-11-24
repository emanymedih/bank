import test from "node:test";
import assert from "node:assert/strict";
import { expenseSnapshot, expenseConflictLabels } from "../lib/expense-draft.ts";
import { mergeDraft } from "../lib/merge-draft.ts";

const base = { id: "e1", name: "Шины", amount: 2000000, date: "2026-11-01", payer: null, category: "Запчасти" };

test("expenseSnapshot приводит расход к черновику формы", () => {
  assert.deepEqual(expenseSnapshot(base), { name: "Шины", amount: "20000", date: "2026-11-01", category: "Запчасти", payer: "" });
  assert.equal(expenseSnapshot(undefined), null);
  assert.deepEqual(expenseSnapshot({ ...base, payer: "p1", category: undefined }), { name: "Шины", amount: "20000", date: "2026-11-01", category: "", payer: "p1" });
});

test("конфликт расходов: чужая дата подтягивается, сумма пользователя сохраняется", () => {
  const incoming = { ...base, date: "2026-11-05" };
  const draft = { ...expenseSnapshot(base), amount: "25000" };
  const { merged, conflicts } = mergeDraft(expenseSnapshot(base), expenseSnapshot(incoming), draft);
  assert.equal(merged.amount, "25000");
  assert.equal(merged.date, "2026-11-05");
  assert.deepEqual(conflicts, []);
});

test("конфликт расходов: оба изменили сумму — поле в conflicts, значение пользователя остаётся", () => {
  const incoming = { ...base, amount: 3000000 };
  const draft = { ...expenseSnapshot(base), amount: "25000" };
  const { merged, conflicts } = mergeDraft(expenseSnapshot(base), expenseSnapshot(incoming), draft);
  assert.deepEqual(conflicts, ["amount"]);
  assert.equal(merged.amount, "25000");
  assert.equal(expenseConflictLabels.amount, "сумма");
  assert.equal(expenseConflictLabels.payer, "кто оплатил");
});

test("конфликт расходов: принятая чужая версия не даёт ложного конфликта", () => {
  const incoming = { ...base, amount: 3000000, date: "2026-11-26" };
  const { merged, conflicts } = mergeDraft(expenseSnapshot(base), expenseSnapshot(incoming), expenseSnapshot(incoming));
  assert.deepEqual(conflicts, []);
  assert.equal(merged.amount, "30000");
  assert.equal(merged.date, "2026-11-26");
});

test("expenseSnapshot: round-trip копеек с запятой без потерь", () => {
  const snapshot = expenseSnapshot({ ...base, amount: 2000055 });
  assert.equal(snapshot.amount, "20000,55");
  assert.equal(Math.round(Number(snapshot.amount.replace(",", ".")) * 100), 2000055);
});
