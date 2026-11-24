import test from "node:test";
import assert from "node:assert/strict";
import { cashTone, overdraftAmount } from "../lib/cash-signal.ts";
import { mergeDraft } from "../lib/merge-draft.ts";

test("касса: отрицательный остаток даёт сигнал тревоги, ноль и плюс — спокойный", () => {
  assert.equal(cashTone(-35000000), "negative");
  assert.equal(cashTone(0), "ok");
  assert.equal(cashTone(50000000), "ok");
  assert.equal(cashTone(null), "unknown");
  assert.equal(overdraftAmount(-35000000), 35000000);
  assert.equal(overdraftAmount(100), 0);
});

test("мерж черновика: бесконфликтные правки другого участника подтягиваются", () => {
  const base = { model: "Rio", buy: 85000000, notes: "" };
  const incoming = { model: "Rio", buy: 85000000, notes: "полировка" };
  const draft = { model: "Rio X", buy: 85000000, notes: "" };
  const { merged, conflicts } = mergeDraft(base, incoming, draft);
  assert.deepEqual(merged, { model: "Rio X", buy: 85000000, notes: "полировка" });
  assert.deepEqual(conflicts, []);
});

test("мерж черновика: одно поле изменено обоими — черновик цел, поле в конфликтах", () => {
  const base = { model: "Rio", buy: 85000000 };
  const incoming = { model: "Rio", buy: 86000000 };
  const draft = { model: "Rio", buy: 84000000 };
  const { merged, conflicts } = mergeDraft(base, incoming, draft);
  assert.equal(merged.buy, 84000000);
  assert.deepEqual(conflicts, ["buy"]);
});

test("мерж черновика: вложенные объекты и массивы сравниваются по значению", () => {
  const base = { shares: [{ partner: "p1", weight: 10000 }], extra: { a: 1 } };
  const incoming = { shares: [{ partner: "p1", weight: 10000 }], extra: { a: 2 } };
  const draft = { shares: [{ partner: "p1", weight: 5000 }, { partner: "p2", weight: 5000 }], extra: { a: 1 } };
  const { merged, conflicts } = mergeDraft(base, incoming, draft);
  assert.deepEqual(merged.extra, { a: 2 });
  assert.equal(merged.shares.length, 2);
  assert.deepEqual(conflicts, []);
});
