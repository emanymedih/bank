import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { parseLedger, readStoredLedger } from "../app/ledger.ts";
import { expense, makeCar, makeLedger } from "./support/fixtures.mjs";

const result = await build({ entryPoints: ["app/stage-history.ts"], bundle: true, write: false, platform: "node", format: "esm" });
const { alignPurchaseStage, initializeStageHistory, recordStageChange, stagePosition, stageSnapshot } =
  await import("data:text/javascript;base64," + Buffer.from(result.outputFiles[0].contents).toString("base64"));

test("legacy status counts without assuming a historical stage date", () => {
  const legacy = makeCar({ expenses: [expense()] });
  const book = readStoredLedger(JSON.stringify(makeLedger(legacy)));
  assert.ok(book);
  assert.equal(book.cars[0].stageHistory, undefined);
  assert.equal(recordStageChange(legacy, "preparation", "2026-11-01"), legacy);
  assert.deepEqual(stagePosition(legacy, "2026-11-01"), { stage: "preparation", since: null, days: null });
  const snapshot = stageSnapshot(book.cars, "2026-11-30");
  assert.deepEqual(snapshot.byStage.find(stage => stage.stage === "preparation"), {
    stage: "preparation", count: 1, recorded: 0, averageDays: null,
  });
  assert.equal(snapshot.staleCapital, 0);
});

test("new purchase and manual transitions persist atomically, including same-day moves and re-entry", () => {
  const purchase = initializeStageHistory(makeCar());
  assert.equal(initializeStageHistory(purchase), purchase);
  assert.deepEqual(purchase.stageHistory, [{ stage: "purchased", date: "2026-10-01", source: "purchase" }]);
  const prep = recordStageChange(purchase, "preparation", "2026-10-01");
  assert.equal(recordStageChange(prep, "preparation", "2026-11-30"), prep);
  const listed = recordStageChange(prep, "listed", "2026-10-01");
  assert.deepEqual(stagePosition(listed, "2026-10-01"), { stage: "listed", since: "2026-10-01", days: 0 });
  const reentered = recordStageChange(listed, "preparation", "2026-10-10");
  assert.deepEqual(readStoredLedger(JSON.stringify(makeLedger(reentered))).cars[0], reentered);
  assert.deepEqual(stagePosition(reentered, "2026-11-01"), { stage: "preparation", since: "2026-10-10", days: 22 });
  assert.equal(recordStageChange(reentered, "listed", "2026-10-09"), null);
  assert.equal(recordStageChange(reentered, "listed", "2026-11-31"), null);
});

test("editing a purchase date moves the purchase event and keeps manual observations", () => {
  const original = recordStageChange(initializeStageHistory(makeCar()), "listed", "2026-10-08");
  const corrected = alignPurchaseStage({ ...original, bought: "2026-10-02" });
  assert.equal(corrected.stageHistory[0].date, "2026-10-02");
  assert.deepEqual(corrected.stageHistory.slice(1), original.stageHistory.slice(1));
  assert.ok(parseLedger(makeLedger(corrected)));
  assert.equal(parseLedger(makeLedger(alignPurchaseStage({ ...original, bought: "2026-10-09" }))), null);
});

test("stage history rejects impossible dates, invalid stages, out-of-order events, duplicate stages and inconsistent status", () => {
  const prep = { stage: "preparation", date: "2026-10-09" };
  const listed = { stage: "listed", date: "2026-10-15" };
  for (const history of [
    [prep, { ...listed, date: "2026-09-30" }],
    [prep, { ...listed, date: "2026-10-08" }],
    [prep, { ...listed, date: "2026-11-31" }],
    [prep, { ...listed, stage: "sold" }],
    [prep, prep, listed],
    [prep],
    [{ stage: "listed", date: "2026-10-01", source: "purchase" }],
  ]) {
    assert.equal(parseLedger(makeLedger(makeCar({ stage: "listed", stageHistory: history }))), null);
  }
  assert.equal(parseLedger(makeLedger(makeCar({ stageHistory: [listed] }))), null);
  assert.ok(parseLedger(makeLedger(makeCar({ stage: "listed", stageHistory: [prep, listed] }))));
});

test("capital counts the purchase and paid expenses through today from day 30", () => {
  const car = recordStageChange(makeCar({ expenses: [expense(), expense({ id: "future-cost", date: "2026-11-03" })] }), "listed", "2026-10-03");
  const day29 = stageSnapshot([car], "2026-11-01");
  const day30 = stageSnapshot([car], "2026-11-02");
  assert.equal(day29.active[0].days, 29);
  assert.equal(day29.staleCapital, 0);
  assert.equal(day30.active[0].days, 30);
  assert.equal(day30.staleCount, 1);
  assert.equal(day30.staleCapital, 106_200_000);
});

test("future purchases and later transitions stay outside the snapshot until due; sold cars exit on sale day", () => {
  const car = initializeStageHistory(makeCar());
  const futureBuy = initializeStageHistory(makeCar({ id: "future", bought: "2026-11-05" }));
  const futureClosed = { ...car, id: "scheduled-sale", sold: "2026-11-05", price: 110_000_000 };
  const lateStage = recordStageChange(car, "listed", "2026-11-03");
  assert.deepEqual(stagePosition(lateStage, "2026-11-01"), { stage: "purchased", since: car.bought, days: 31 });
  assert.equal(stagePosition(futureBuy, "2026-11-04"), null);
  assert.equal(stageSnapshot([futureBuy, futureClosed], "2026-11-04").staleCapital, car.buy);
  assert.equal(stageSnapshot([futureBuy, futureClosed], "2026-11-05").staleCapital, 0);
  assert.deepEqual(stagePosition(futureClosed, "2026-11-05"), { stage: "sold", since: futureClosed.sold, days: 0 });
  assert.equal(recordStageChange(futureClosed, "listed", "2026-11-06"), null);
});

test("sale date may match a recorded transition; a prior sale is rejected only when history conflicts", () => {
  const untracked = makeCar({ sold: "2026-10-08", price: 90_000_000 });
  const tracked = recordStageChange(makeCar(), "listed", "2026-10-09");
  assert.ok(parseLedger(makeLedger(untracked)));
  assert.equal(parseLedger(makeLedger({ ...tracked, sold: untracked.sold, price: untracked.price })), null);
  assert.ok(parseLedger(makeLedger({ ...tracked, sold: "2026-10-09", price: untracked.price })));
  assert.equal(stageSnapshot([{ ...tracked, sold: "2026-10-09", price: untracked.price }], "2026-11-10").staleCapital, 0);
});
