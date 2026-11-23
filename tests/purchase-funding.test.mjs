import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { cashSummary, validLedger } from "../app/ledger.ts";
import { alice, bob, expense, makeCar, makeLedger } from "./support/fixtures.mjs";

const result = await build({
  entryPoints: ["app/purchase-funding.ts"], bundle: true, write: false, platform: "node", format: "esm",
});
const { carFunding, fundingSnapshot } = await import("data:text/javascript;base64," + Buffer.from(result.outputFiles[0].contents).toString("base64"));
const through = "2026-11-23";

test("purchase funding uses contributions in kopecks independently of profit shares", () => {
  const car = makeCar({
    shares: [
      { partner: alice.id, buy: 70_000_000, weight: 5000, withdrawn: false },
      { partner: bob.id, buy: 30_000_000, weight: 5000, withdrawn: false },
    ],
    expenses: [expense({ payer: bob.id }), expense({ id: "future", date: "2026-11-24" })],
  });
  assert(validLedger(makeLedger(car)));
  const { purchase, invested } = carFunding(car, through);
  assert.deepEqual(purchase, new Map([[alice.id, 70_000_000], [bob.id, 30_000_000]]));
  assert.deepEqual(invested, new Map([[alice.id, 70_000_000], [bob.id, 36_200_000]]));
});

test("a cash-funded purchase stays with the common cash source, with personal expenses separate", () => {
  const car = makeCar({
    cashPurchase: true, shares: makeCar().shares.map(share => ({ ...share, buy: 0 })),
    expenses: [expense(), expense({ id: "fuel", name: "Топливо", payer: null, amount: 160_000 })],
  });
  const ledger = makeLedger(car);
  assert(validLedger(ledger));
  const { purchase, invested } = carFunding(car, through);
  assert.deepEqual(purchase, new Map([[null, 100_000_000]]));
  assert.deepEqual(invested, new Map([[null, 100_160_000], [alice.id, 6_200_000]]));
  assert.equal(fundingSnapshot(ledger, through).total, 106_360_000);
  assert.equal(cashSummary(ledger, through).spending, 100_160_000);
});

test("current capital keeps unsold cars and excludes completed and future purchases", () => {
  const active = makeCar({ id: "active", expenses: [expense({ payer: bob.id })] });
  const sold = makeCar({ id: "sold", sold: "2026-10-20", price: 90_000_000 });
  const futureSale = makeCar({ id: "future-sale", sold: "2026-11-25", price: 200_000_000 });
  const futureBuy = makeCar({ id: "future-purchase", bought: "2026-11-24" });
  const ledger = makeLedger(active, sold, futureSale, futureBuy);
  assert(validLedger(ledger));
  const snapshot = fundingSnapshot(ledger, through);
  assert.deepEqual(snapshot.active.map(car => car.id), ["active", "future-sale"]);
  assert.deepEqual(snapshot.cars.map(car => car.id), ["active", "sold", "future-sale"]);
  assert.equal(snapshot.total, 206_200_000);
  assert.deepEqual(snapshot.deployed, new Map([[alice.id, 100_000_000], [bob.id, 106_200_000]]));
  assert.deepEqual(snapshot.balances, { [alice.id]: -5_000_000, [bob.id]: -5_000_000 });
});

test("profit stays with its partner until a dated future cash payout comes due", () => {
  const sold = makeCar({
    sold: "2026-10-20", price: 130_000_000,
    shares: [
      { ...makeCar().shares[0], withdrawn: true, cashWithdrawalDate: "2026-11-24" },
      { ...makeCar().shares[1], withdrawn: true },
    ],
    expenses: [expense({ date: "2026-11-25", payer: bob.id })],
  });
  const ledger = makeLedger(sold);
  assert(validLedger(ledger));
  assert.deepEqual(fundingSnapshot(ledger, through).balances, { [alice.id]: 11_900_000, [bob.id]: 0 });
  assert.deepEqual(fundingSnapshot(ledger, "2026-11-24").balances, { [alice.id]: 0, [bob.id]: 0 });
  assert.equal(cashSummary(ledger, "2026-11-24").spending, 11_900_000);
  assert.equal(fundingSnapshot(ledger, through).total, 0);
});
