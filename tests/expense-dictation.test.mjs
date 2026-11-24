import assert from "node:assert/strict";
import test from "node:test";
import { buildExpenseBatch, parseExpenseAmount, parseExpenseDictation } from "../lib/expense-dictation.ts";
import { parseLedger } from "../app/ledger.ts";
import { makeCar } from "./support/fixtures.mjs";

const partners = [
  { id: "ivan", name: "Иван Петров" },
  { id: "anna", name: "Анна" },
];

test("Russian dictation separates expenses and preserves exact money, category and payer", () => {
  const drafts = parseExpenseDictation(
    "Покрасили два крыла, отдали 62 тысячи; Авито 7 500, оплатила Анна\nЭвакуатор 1 205,09 ₽ из общей кассы",
    partners, "ivan",
  );
  assert.deepEqual(drafts.map(({ name, amount, category, payer }) => ({ name, amount, category, payer })), [
    { name: "Покрасили два крыла", amount: "62000", category: "Работы", payer: "ivan" },
    { name: "Авито", amount: "7500", category: "Реклама", payer: "anna" },
    { name: "Эвакуатор", amount: "1205,09", category: "Транспорт", payer: null },
  ]);
});

test("the spoken separator and amount written in words can form draft rows", () => {
  const drafts = parseExpenseDictation(
    "Авито семь тысяч пятьсот рублей, следующий расход Иван оплатил шины за шестьдесят две тысячи",
    partners, null,
  );
  assert.deepEqual(drafts.map(({ name, amount, payer }) => [name, amount, payer]), [
    ["Авито", "7500", null],
    ["шины", "62000", "ivan"],
  ]);
});

test("ambiguous amounts and a named payer outside the book stay open for review", () => {
  const drafts = parseExpenseDictation(
    "Крыло 2 штуки; Шины 7000–8000; Осмотр 05.11.2026; Доставка -500 ₽; Фара 1 000, оплатил Сергей",
    partners, "ivan",
  );
  assert.deepEqual(drafts.map(({ amount, payer }) => [amount, payer]), [
    ["", "ivan"], ["", "ivan"], ["", "ivan"], ["", "ivan"], ["1000", undefined],
  ]);
  assert.equal(drafts[4].source, "Фара 1 000, оплатил Сергей");
});

test("a range or a unit price cannot become a paid total", () => {
  const drafts = parseExpenseDictation(
    "Шины 7000–8000 ₽; Два крыла по 5 тысяч; Лампа 300 ₽ за штуку; Запчасти 3000 + 500 ₽; Покраска 62 тысячи, Авито 7500",
    partners, null,
  );
  assert.deepEqual(drafts.map(({ amount }) => amount), ["", "", "", "", ""]);
});

test("a shared cash payer is recognized even when dictated after a payment verb", () => {
  const [draft] = parseExpenseDictation("Доставка 2500, оплатили из общей кассы", partners, "ivan");
  assert.deepEqual([draft.name, draft.amount, draft.payer], ["Доставка", "2500", null]);
});

test("reviewed amounts convert to kopecks and reject partial digits and out-of-range values", () => {
  assert.equal(parseExpenseAmount("1 000,01"), 100_001);
  assert.equal(parseExpenseAmount("0,01"), 1);
  assert.equal(parseExpenseAmount("1000000000"), 100_000_000_000);
  assert.equal(parseExpenseAmount("1000000000,01"), null);
  assert.equal(parseExpenseAmount("9,001"), null);
  assert.equal(parseExpenseAmount("10 0"), null);
  assert.equal(parseExpenseAmount("0"), null);
});

test("confirmation yields one ledger-ready batch and excludes unchecked rows", () => {
  const batch = buildExpenseBatch([
    { id: "taxi", name: " Эвакуатор ", date: "2026-11-23", amount: "1234,10", payer: null, category: "Транспорт", included: true },
    { id: "draft", name: "Крыло", date: "not-a-date", amount: "", payer: undefined, category: undefined, included: false },
    { id: "ad", name: "Авито", date: "2026-11-24", amount: "50", payer: "ivan", category: "Реклама", included: true },
  ], "2026-11-15");
  assert.deepEqual(batch, { expenses: [
    { id: "taxi", name: "Эвакуатор", date: "2026-11-23", amount: 123_410, payer: null, category: "Транспорт" },
    { id: "ad", name: "Авито", date: "2026-11-24", amount: 5_000, payer: "ivan", category: "Реклама" },
  ] });
  const car = makeCar({ bought: "2026-11-15", shares: [{ partner: "ivan", buy: 10_000_000, weight: 10_000, withdrawn: false }],
    buy: 10_000_000, expenses: batch.expenses });
  assert.ok(parseLedger({ cars: [car], partners }));
});

test("one invalid included row prevents staging the whole batch", () => {
  const valid = { id: "ok", name: "Авито", date: "2026-11-24", amount: "50", payer: "ivan", category: "Реклама", included: true };
  assert.deepEqual(buildExpenseBatch([valid, { ...valid, id: "wrong", amount: "" }], "2026-11-15"), {
    rowId: "wrong", field: "amount",
  });
  assert.deepEqual(buildExpenseBatch([{ ...valid, date: "2026-11-14" }], "2026-11-15"), { rowId: "ok", field: "date" });
  assert.deepEqual(buildExpenseBatch([{ ...valid, date: "2026-11-31" }], "2026-11-15"), { rowId: "ok", field: "date" });
  assert.deepEqual(buildExpenseBatch([{ ...valid, payer: undefined }], "2026-11-15"), { rowId: "ok", field: "payer" });
});
