import assert from "node:assert/strict";
import test from "node:test";
import { cashSummary, emptyLedger, figures, initialLedger, splitAmount, totals, validLedger, yearAnalytics } from "../app/ledger.ts";
import { alice, bob, expense, makeCar, makeLedger } from "./support/fixtures.mjs";

const fromCash = [
  { partner: alice.id, buy: 0, weight: 5000, withdrawn: false },
  { partner: bob.id, buy: 0, weight: 5000, withdrawn: false },
];

function cashDeal(overrides = {}) {
  return makeCar({
    cashPurchase: true, cashSale: true, sold: "2026-11-04", price: 150_000_000,
    shares: fromCash, expenses: [expense({ payer: null })], ...overrides,
  });
}

test("new and existing demo books remain readable", () => {
  assert(validLedger(emptyLedger));
  assert(validLedger(initialLedger));
  assert.equal(totals(initialLedger).active, 2);
  assert.equal(totals(initialLedger).sold, 4);
});

test("reinvesting cash reduces the available balance and leaves earned profit intact", () => {
  const next = makeCar({ id: "next", bought: "2026-11-09", buy: 20_000_000, cashPurchase: true, shares: fromCash });
  const ledger = { ...makeLedger(cashDeal(), next), cashEntries: [
    { id: "initial", date: "2026-10-01", name: "Начальный остаток", amount: 110_000_000, direction: "in" },
  ] };
  assert(validLedger(ledger));
  assert.equal(cashSummary(ledger, "2026-11-08").balance, 153_800_000);
  assert.equal(cashSummary(ledger, "2026-11-09").balance, 133_800_000);
  assert.equal(totals(ledger).bank, 43_800_000);
  assert.equal(totals(ledger).invested, 20_000_000);
});

test("a dated payout is charged to the cashbook on its own date exactly once", () => {
  const shares = fromCash.map(share => share.partner === alice.id
    ? { ...share, withdrawn: true, cashWithdrawalDate: "2026-11-08" } : share);
  const ledger = { ...makeLedger(cashDeal({ shares })), cashEntries: [
    { id: "initial", date: "2026-10-01", name: "Начальный остаток", amount: 110_000_000, direction: "in" },
  ] };
  assert(validLedger(ledger));
  assert.equal(cashSummary(ledger, "2026-11-07").balance, 153_800_000);
  assert.equal(cashSummary(ledger, "2026-11-08").balance, 131_900_000);
  assert.deepEqual(totals(ledger).balances, { [alice.id]: 0, [bob.id]: 21_900_000 });
  assert.equal(totals(ledger).bank, 21_900_000);
});

test("an expense paid by a partner reduces profit and leaves the cashbook untouched", () => {
  const car = makeCar({ expenses: [expense()], price: 150_000_000, sold: "2026-11-04" });
  const result = figures(car);
  assert.equal(result.net, 43_800_000);
  assert.equal(result.people[alice.id].expenses, 6_200_000);
  assert.equal(result.people[bob.id].expenses, 0);
  assert.equal(cashSummary(makeLedger(car), "2026-11-08").entries.length, 0);
});

test("kopecks are conserved when splitting small and large gains and losses", () => {
  const weights = [3334, 3333, 3333];
  assert.deepEqual(splitAmount(1, weights), [1, 0, 0]);
  assert.deepEqual(splitAmount(2, weights), [1, 1, 0]);
  assert.deepEqual(splitAmount(101, [5000, 5000]), [51, 50]);
  assert.deepEqual(splitAmount(-101, [5000, 5000]), [-51, -50]);
  for (const amount of [0, 1, 2, 99, 10_001, 49_999_999_999_998]) {
    for (const sign of [1, -1]) {
      const total = sign * amount || 0;
      assert.equal(splitAmount(total, weights).reduce((sum, part) => sum + part, 0), total);
    }
  }
});

test("a loss follows deal weights and cannot be marked as a positive payout", () => {
  const car = makeCar({ price: 60_000_000, sold: "2026-11-04" });
  const calculation = figures(car);
  assert.equal(calculation.net, -40_000_000);
  assert.equal(calculation.people[alice.id].profit, -20_000_000);
  assert.equal(totals(makeLedger(car)).bank, -40_000_000);
  const marked = { ...car, shares: car.shares.map(share => ({ ...share, withdrawn: true })) };
  assert(!validLedger(makeLedger(marked)));
});

test("expense analytics use the payment date and profit uses the sale date", () => {
  const car = makeCar({
    bought: "2025-12-21", sold: "2026-01-13", price: 124_000_000,
    expenses: [expense({ date: "2025-12-28" })],
  });
  const ledger = makeLedger(car);
  const previous = yearAnalytics(ledger, "2025");
  const current = yearAnalytics(ledger, "2026");
  assert.equal(previous.months[11].expenses, 6_200_000);
  assert.equal(previous.sales, 0);
  assert.deepEqual(current.months[0], { expenses: 0, profit: 17_800_000, sales: 1 });
  assert.equal(current.bands[0].count, 1);
  assert.equal(current.bands[1].count, 0);
});

test("invalid dates, shares and dangling records are rejected", () => {
  const car = makeCar();
  const variants = [
    { ...car, bought: "2026-02-30" },
    { ...car, expenses: [expense({ payer: "unknown" })] },
    { ...car, expenses: [expense({ date: "2026-09-30" })] },
    { ...car, price: 120_000_000 },
    { ...car, shares: car.shares.map(share => ({ ...share, weight: 4999 })) },
    { ...car, works: [{ id: "work", date: car.bought, name: "Работа", notes: "", expenseId: "missing" }] },
  ];
  for (const invalid of variants) assert(!validLedger(makeLedger(invalid)));
});
