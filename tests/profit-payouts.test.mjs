import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { cashSummary, figures, parseLedger, totals } from "../app/ledger.ts";
import { alice, bob, makeCar, makeLedger } from "./support/fixtures.mjs";

const result = await build({ entryPoints: ["app/purchase-funding.ts"], bundle: true, write: false, platform: "node", format: "esm" });
const { fundingSnapshot } = await import("data:text/javascript;base64," + Buffer.from(result.outputFiles[0].contents).toString("base64"));
const cashPayment = { id: "first", amount: 4_000_000, date: "2026-11-21", fromCash: true };
const privatePayment = { id: "second", amount: 8_000_000, date: "2026-11-24", fromCash: false };

function saleWithPayouts(payouts, shareOverrides = {}, carOverrides = {}) {
  const car = makeCar({ sold: "2026-11-07", price: 150_000_000, ...carOverrides });
  car.shares[0] = { ...car.shares[0], payouts, ...shareOverrides };
  return car;
}

test("partial payments keep the unwritten balance and only shared cash payments reduce the cash journal", () => {
  const original = makeLedger(saleWithPayouts([cashPayment, privatePayment]));
  const saved = parseLedger(JSON.parse(JSON.stringify(original)));
  assert.deepEqual(saved, original);
  assert.equal(figures(saved.cars[0]).people[alice.id].paid, 12_000_000);
  assert.equal(totals(saved).balances[alice.id], 13_000_000);
  assert.equal(totals(saved).balances[bob.id], 25_000_000);
  assert.equal(cashSummary(saved, "2026-11-20").spending, 0);
  assert.equal(cashSummary(saved, "2026-11-30").spending, 4_000_000);
  assert.equal(cashSummary(saved, "2026-11-30").entries.length, 1);
  assert.equal(fundingSnapshot(saved, "2026-11-23").balances[alice.id], 21_000_000);
  assert.equal(fundingSnapshot(saved, "2026-11-24").balances[alice.id], 13_000_000);
});

test("the ledger blocks payments above profit, repeated ids, payouts before sale and mixed legacy flags", () => {
  assert.equal(parseLedger(makeLedger(saleWithPayouts([{ ...cashPayment, amount: 25_000_001 }]))), null);
  assert.equal(parseLedger(makeLedger(saleWithPayouts([cashPayment, cashPayment]))), null);
  assert.equal(parseLedger(makeLedger(saleWithPayouts([{ ...cashPayment, date: "2026-11-06" }]))), null);
  assert.equal(parseLedger(makeLedger(saleWithPayouts([cashPayment], { withdrawn: true }))), null);
  assert.equal(parseLedger(makeLedger(saleWithPayouts([cashPayment], {}, { price: 80_000_000 }))), null);
  assert(parseLedger(makeLedger(saleWithPayouts([{ ...cashPayment, amount: 25_000_000 }]))));
});

test("full legacy payouts retain their date and reduce retained profit exactly once", () => {
  const car = saleWithPayouts(undefined, { withdrawn: true, cashWithdrawalDate: cashPayment.date });
  const ledger = makeLedger(car);
  assert(parseLedger(ledger));
  assert.equal(cashSummary(ledger, "2026-11-30").spending, 25_000_000);
  assert.equal(totals(ledger).balances[alice.id], 0);
  assert.equal(fundingSnapshot(ledger, "2026-11-20").balances[alice.id], 25_000_000);
});

test("the per-sale timeline subtracts later withdrawals only once their date is reached", () => {
  const first = saleWithPayouts([cashPayment], {}, { id: "a" });
  const loss = makeCar({ id: "b", sold: "2026-11-10", price: 90_000_000 });
  const later = makeCar({ id: "c", sold: "2026-11-21", price: 120_000_000 });
  const { timeline, balances } = totals(makeLedger(first, loss, later));
  assert.equal(timeline.get("a").people[alice.id], 25_000_000);
  assert.equal(timeline.get("b").people[alice.id], 20_000_000);
  assert.equal(timeline.get("c").people[alice.id], 26_000_000);
  assert.equal(balances[alice.id], 26_000_000);
});
