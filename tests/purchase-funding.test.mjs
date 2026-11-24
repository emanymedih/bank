import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { cashSummary, figures, validLedger } from "../app/ledger.ts";
import { alice, bob, expense, makeCar, makeLedger } from "./support/fixtures.mjs";

const result = await build({
  entryPoints: ["app/purchase-funding.ts"], bundle: true, write: false, platform: "node", format: "esm",
});
const { carFunding, fundingSnapshot, purchaseContributionAmounts, purchaseContributionWeights } = await import("data:text/javascript;base64," + Buffer.from(result.outputFiles[0].contents).toString("base64"));
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

test("unassigned participants cover exactly the remaining purchase price", () => {
  assert.deepEqual(purchaseContributionAmounts(92_000_000, [32_000_000, null]), [32_000_000, 60_000_000]);
  assert.deepEqual(purchaseContributionAmounts(101, [20, null, null]), [20, 41, 40]);
  assert.deepEqual(purchaseContributionAmounts(101, [0, null]), [0, 101]);
  assert.equal(purchaseContributionAmounts(100, [101, null]), null);
  assert.equal(purchaseContributionAmounts(100, [NaN, null]), null);
});

test("purchase percentages conserve 100 percent at two decimals", () => {
  assert.deepEqual(purchaseContributionWeights([32_000_000, 60_000_000]), [3478, 6522]);
  assert.deepEqual(purchaseContributionWeights([1, 1, 1]), [3334, 3333, 3333]);
  assert.deepEqual(purchaseContributionWeights([1, 0]), [10000, 0]);
  assert.deepEqual(purchaseContributionWeights([0, 0]), [5000, 5000]);
  assert.deepEqual(purchaseContributionWeights([99_999_999_999, 1]), [10000, 0]);
});

test("proportional profit and loss agree with a manual calculation while purchase funding stays exact", () => {
  const contributions = purchaseContributionAmounts(80_000_000, [30_000_000, null]);
  const weights = purchaseContributionWeights(contributions);
  const car = makeCar({
    buy: 80_000_000, sold: "2026-10-20", price: 100_000_000,
    shares: makeCar().shares.map((share, index) => ({ ...share, buy: contributions[index], weight: weights[index] })),
  });
  const profit = makeLedger(car);
  const loss = makeLedger({ ...car, price: 72_000_000 });
  assert(validLedger(profit));
  assert(validLedger(loss));
  assert.deepEqual(fundingSnapshot(profit, through).balances, { [alice.id]: 7_500_000, [bob.id]: 12_500_000 });
  assert.deepEqual(fundingSnapshot(loss, through).balances, { [alice.id]: -3_000_000, [bob.id]: -5_000_000 });
});

test("an allocated purchase from common cash is debited once and keeps both attributed stakes", () => {
  const car = makeCar({
    bought: "2026-11-23", buy: 92_000_000, cashPurchase: true,
    shares: [{ ...makeCar().shares[0], buy: 40_000_000 }, { ...makeCar().shares[1], buy: 52_000_000 }],
  });
  const book = { ...makeLedger(car), cashEntries: [
    { id: "open", date: "2026-11-22", name: "Начальный остаток", amount: 186_000_000, direction: "in" },
    { id: "payout", date: "2026-11-22", name: "Выплата", amount: 30_000_000, direction: "out" },
  ] };
  assert(validLedger(book));
  assert.equal(cashSummary(book, "2026-11-22").balance, 156_000_000);
  const cash = cashSummary(book, through);
  assert.equal(cash.balance, 64_000_000);
  assert.equal(cash.spending, 122_000_000);
  assert.equal(cash.entries.filter(entry => entry.id === car.id + "/buy").length, 1);
  assert.deepEqual(fundingSnapshot(book, through).deployed, new Map([[alice.id, 40_000_000], [bob.id, 52_000_000]]));
  assert(!validLedger(makeLedger({ ...car, shares: [{ ...car.shares[0], buy: 1 }, car.shares[1]] })));
});

test("attributing cash capital does not make it a personal advance or change a gain or loss", () => {
  const base = makeCar();
  for (const price of [110_000_000, 90_000_000]) {
    const sold = { ...base, sold: "2026-11-20", price, cashSale: true, cashPurchase: true,
      expenses: [expense({ amount: 1_000_000, payer: alice.id })] };
    assert(validLedger(makeLedger(sold)));
    const calculation = figures(sold);
    assert.equal(calculation.people[alice.id].buy, 0);
    assert.equal(calculation.people[bob.id].buy, 0);
    assert.equal(calculation.people[alice.id].expenses, 1_000_000);
    assert.equal(calculation.people[bob.id].profit, (price - 101_000_000) / 2);
    assert.equal(cashSummary(makeLedger(sold), through).balance, price - 100_000_000);
    assert.equal(cashSummary(makeLedger({ ...sold, cashPurchase: false }), through).balance, price);
  }
});
