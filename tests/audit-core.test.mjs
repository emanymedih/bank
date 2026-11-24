import assert from "node:assert/strict";
import test from "node:test";
import { diffLedgers } from "../lib/ledger-audit.ts";
import { alice, bob, expense, makeCar, makeLedger } from "./support/fixtures.mjs";

const cash = (overrides = {}) => ({ id: "cash-1", date: "2026-10-01", name: "Начальный банк", amount: 50_000_000, direction: "in", ...overrides });

test("пустой diff не создаёт событий", () => {
  const ledger = makeLedger(makeCar());
  assert.deepEqual(diffLedgers(ledger, ledger), []);
  assert.deepEqual(diffLedgers(undefined, { partners: [alice], cars: [] }), []);
});

test("касса: создание, изменение суммы и удаление дают было/стало", () => {
  const before = { partners: [alice], cars: [], cashEntries: [cash()] };
  const created = diffLedgers({ partners: [alice], cars: [] }, before);
  assert.equal(created.length, 1);
  assert.equal(created[0].entity, "cash");
  assert.equal(created[0].action, "create");
  assert.equal(created[0].after.amount, 50_000_000);

  const changed = diffLedgers(before, { ...before, cashEntries: [cash({ amount: 60_000_000 })] });
  assert.equal(changed.length, 1);
  assert.equal(changed[0].action, "update");
  assert.equal(changed[0].field, "amount");
  assert.equal(changed[0].before, 50_000_000);
  assert.equal(changed[0].after, 60_000_000);

  const removed = diffLedgers(before, { partners: [alice], cars: [] });
  assert.equal(removed.length, 1);
  assert.equal(removed[0].action, "delete");
  assert.equal(removed[0].before.amount, 50_000_000);
});

test("касса: распределение сравнивается как структура", () => {
  const before = { partners: [alice, bob], cars: [], cashEntries: [cash()] };
  const after = { ...before, cashEntries: [cash({ allocations: [{ partner: alice.id, amount: 25_000_000 }] })] };
  const rows = diffLedgers(before, after);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].field, "allocations");
  assert.deepEqual(rows[0].after, [{ partner: alice.id, amount: 25_000_000 }]);
});

test("партнёр: переименование и удаление", () => {
  const before = makeLedger();
  const renamed = diffLedgers(before, { ...before, partners: [{ ...alice, name: "Новое имя" }, bob] });
  assert.equal(renamed.length, 1);
  assert.equal(renamed[0].entity, "partner");
  assert.equal(renamed[0].field, "name");
  assert.equal(renamed[0].before, "Участник А");
  assert.equal(renamed[0].after, "Новое имя");
  const removed = diffLedgers(before, { partners: [bob], cars: [] });
  assert.equal(removed.length, 1);
  assert.equal(removed[0].action, "delete");
});

test("авто: покупка и продажа фиксируются с копейками", () => {
  const before = makeLedger(makeCar());
  const after = makeLedger(makeCar({ sold: "2026-11-01", price: 120_000_000 }));
  const rows = diffLedgers(before, after);
  const sold = rows.find(row => row.field === "sold");
  const price = rows.find(row => row.field === "price");
  assert.equal(sold.before, null);
  assert.equal(sold.after, "2026-11-01");
  assert.equal(price.after, 120_000_000);
  assert.ok(rows.every(row => row.entity === "car" && row.carId === "test-car"));
});

test("расходы авто: добавление, изменение суммы, удаление — отдельные сущности", () => {
  const before = makeLedger(makeCar());
  const withExpense = makeLedger(makeCar({ expenses: [expense()] }));
  const created = diffLedgers(before, withExpense);
  assert.equal(created.length, 1);
  assert.equal(created[0].entity, "expense");
  assert.equal(created[0].entityId, "paint");
  assert.equal(created[0].carId, "test-car");
  assert.equal(created[0].action, "create");

  const changed = diffLedgers(withExpense, makeLedger(makeCar({ expenses: [expense({ amount: 7_000_000 })] })));
  assert.equal(changed.length, 1);
  assert.equal(changed[0].field, "amount");
  assert.equal(changed[0].before, 6_200_000);
  assert.equal(changed[0].after, 7_000_000);

  const removed = diffLedgers(withExpense, before);
  assert.equal(removed.length, 1);
  assert.equal(removed[0].action, "delete");
});

test("выплаты по долям попадают в аудит с партнёром", () => {
  const payout = { id: "pay-1", amount: 10_000_000, date: "2026-11-02", fromCash: true };
  const before = makeLedger(makeCar());
  const after = makeLedger(makeCar({
    shares: [
      { ...makeCar().shares[0], payouts: [payout] },
      makeCar().shares[1],
    ],
  }));
  const rows = diffLedgers(before, after);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].entity, "payout");
  assert.equal(rows[0].entityId, "pay-1");
  assert.equal(rows[0].action, "create");
  assert.equal(rows[0].after.amount, 10_000_000);
  assert.ok(rows[0].entityName.includes(alice.name));
});

test("изменение долей авто фиксируется одним полем shares", () => {
  const before = makeLedger(makeCar());
  const after = makeLedger(makeCar({
    shares: [
      { ...makeCar().shares[0], weight: 7000 },
      { ...makeCar().shares[1], weight: 3000 },
    ],
  }));
  const rows = diffLedgers(before, after);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].field, "shares");
  assert.equal(rows[0].after[0].weight, 7000);
});

test("создание и удаление авто включают его расходы и выплаты", () => {
  const payout = { id: "pay-1", amount: 10_000_000, date: "2026-11-02", fromCash: true };
  const car = makeCar({ expenses: [expense()], shares: [{ ...makeCar().shares[0], payouts: [payout] }, makeCar().shares[1]] });
  const created = diffLedgers(makeLedger(), makeLedger(car));
  assert.ok(created.some(row => row.entity === "car" && row.action === "create"));
  assert.ok(created.some(row => row.entity === "expense" && row.action === "create"));
  assert.ok(created.some(row => row.entity === "payout" && row.action === "create"));
  const removed = diffLedgers(makeLedger(car), makeLedger());
  assert.ok(removed.some(row => row.entity === "car" && row.action === "delete"));
  assert.ok(removed.some(row => row.entity === "expense" && row.action === "delete"));
  assert.ok(removed.some(row => row.entity === "payout" && row.action === "delete"));
});

test("этап без явной записи выводится из истории: было «Куплено», стало «Подготовка»", () => {
  const before = makeLedger(makeCar());
  const after = makeLedger(makeCar({ stage: "preparation", stageHistory: [{ stage: "purchased", date: "2026-10-01", source: "purchase" }, { stage: "preparation", date: "2026-11-24" }] }));
  const rows = diffLedgers(before, after);
  const stage = rows.find(row => row.field === "stage");
  assert.ok(stage);
  assert.equal(stage.before, "purchased");
  assert.equal(stage.after, "preparation");
});

test("экстремальные суммы не теряют точность", () => {
  const big = 100_000_000_000; // 1 млрд рублей в копейках — предел схемы
  const before = { partners: [alice], cars: [], cashEntries: [cash({ amount: big - 1 })] };
  const after = { partners: [alice], cars: [], cashEntries: [cash({ amount: big })] };
  const rows = diffLedgers(before, after);
  assert.equal(rows[0].before, big - 1);
  assert.equal(rows[0].after, big);
});