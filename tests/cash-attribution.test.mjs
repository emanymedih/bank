import assert from "node:assert/strict";
import test from "node:test";
import { cashSummary, parseLedger, totals, yearAnalytics } from "../app/ledger.ts";
import { alice, bob, expense, makeCar, makeLedger } from "./support/fixtures.mjs";

const day = "2026-11-24";
const opening = { id: "opening", date: "2026-11-23", name: "Начальный остаток", amount: 186_000_000, direction: "in" };
const car = makeCar({ id: "sold", price: 130_000_000, sold: "2026-11-22",
  shares: [
    { ...makeCar().shares[0], weight: 10_000, payouts: [{ id: "p", date: day, amount: 30_000_000, fromCash: true }] },
    { ...makeCar().shares[1], weight: 0 },
  ] });

test("unassigned legacy money still reconciles without guessing contributors", () => {
  const ledger = { ...makeLedger(car), cashEntries: [opening] };
  const cash = cashSummary(ledger, day);
  assert.equal(cash.income, 186_000_000);
  assert.equal(cash.balance, 156_000_000);
  assert.deepEqual([...cash.incomeBySource], [[null, 186_000_000]]);
  assert.equal(cash.balanceBySource.get(alice.id), -30_000_000);
  assert.equal(cash.balanceBySource.get(null), 186_000_000);
  assert.equal(totals(ledger, day).bank, 0);
});

test("known opening capital, a payout and reinvestment reconcile by partner and date", () => {
  const allocatedOpening = { ...opening, allocations: [
    { partner: alice.id, amount: 100_000_000 }, { partner: bob.id, amount: 86_000_000 },
  ] };
  const next = makeCar({ id: "reinvested", bought: day, buy: 92_000_000, cashPurchase: true, shares: [
    { ...makeCar().shares[0], buy: 40_000_000 }, { ...makeCar().shares[1], buy: 52_000_000 },
  ] });
  const ledger = { ...makeLedger(car, next), cashEntries: [allocatedOpening] };
  assert.deepEqual(parseLedger(ledger), ledger);
  const before = cashSummary(ledger, "2026-11-23");
  assert.equal(before.balance, 186_000_000);
  assert.equal(totals(ledger, "2026-11-23").paid[alice.id], 0);
  const after = cashSummary(ledger, day);
  assert.equal(after.balance, 64_000_000);
  assert.equal(after.balanceBySource.get(alice.id), 30_000_000);
  assert.equal(after.balanceBySource.get(bob.id), 34_000_000);
  assert.equal([...after.balanceBySource.values()].reduce((sum, value) => sum + value, 0), after.balance);
  assert.equal(totals(ledger, day).paid[alice.id], 30_000_000);
});

test("the cash book keeps unidentified sales and splits manual movements with a residual", () => {
  const sale = makeCar({ sold: day, price: 130_000_000, cashSale: true });
  const ledger = { ...makeLedger(sale), cashEntries: [
    { ...opening, allocations: [{ partner: alice.id, amount: 100_000_000 }] },
    { id: "withdraw", date: day, name: "Списание", amount: 100, direction: "out", allocations: [{ partner: bob.id, amount: 70 }] },
    { ...opening, id: "planned", date: "2026-12-23" },
  ] };
  const cash = cashSummary(ledger, day);
  assert.equal(cash.salesIncome, 130_000_000);
  assert.equal(cash.incomeBySource.get(null), 86_000_000);
  assert.equal(cash.incomeBySource.get(alice.id), 100_000_000);
  assert.equal(cash.balanceBySource.get(null), 215_999_970);
  assert.equal(cash.balanceBySource.get(bob.id), -70);
  for (const allocations of [
    [{ partner: "missing", amount: 20 }], [{ partner: alice.id, amount: 0 }],
    [{ partner: alice.id, amount: opening.amount + 1 }],
    [{ partner: alice.id, amount: 20 }, { partner: alice.id, amount: 20 }],
  ]) assert.equal(parseLedger({ ...makeLedger(), cashEntries: [{ ...opening, allocations }] }), null);
});

test("planned expenses, purchases and sales are excluded from today's financial totals", () => {
  const active = makeCar({ id: "active", expenses: [expense({ date: "2026-11-25" })] });
  const futureSale = makeCar({ id: "future-sale", price: 80_000_000, sold: "2026-11-25" });
  const futurePurchase = makeCar({ id: "future-buy", bought: "2026-11-26" });
  const ledger = makeLedger(active, futureSale, futurePurchase);
  const asOf = totals(ledger, day);
  assert.deepEqual([asOf.invested, asOf.net, asOf.sold, asOf.active], [200_000_000, 0, 0, 2]);
  assert.equal(yearAnalytics(ledger, "2026", day).expenses, 0);
  assert.equal(yearAnalytics(ledger, "2026", day).sales, 0);
  assert.equal(yearAnalytics(ledger, "2026", "2026-11-25").profit, -20_000_000);
});
