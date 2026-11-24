import assert from "node:assert/strict";
import test from "node:test";
import { parseLedger, nextTask, ledgerClientVersion, splitAmount } from "../app/ledger.ts";
import { diffLedgers } from "../lib/ledger-audit.ts";
import { parseSavedFilter } from "../lib/saved-filter.ts";
import { createRuntime, ledgerRequest, loadRoutes } from "./support/api-runtime.mjs";
import { alice, bob, makeCar, makeLedger } from "./support/fixtures.mjs";

const routes = await loadRoutes();
const eventsRequest = (query = "") => new Request("https://app.example.test/api/books/events" + query);
const task = (overrides = {}) => ({ id: "task-1", title: "Помыть машину", done: false, createdAt: "2026-10-02", ...overrides });

test("задачи и ссылка объявления проходят валидацию; nextTask выбирает ближайшую открытую", () => {
  const car = makeCar({
    listingUrl: "https://www.avito.ru/item/123",
    tasks: [task(), task({ id: "task-2", title: "Сфотографировать", due: "2026-10-03", createdAt: "2026-10-01" }), task({ id: "task-3", title: "Сделано", done: true })],
  });
  assert.ok(parseLedger(makeLedger(car)));
  assert.equal(nextTask(car).id, "task-2");
  assert.equal(nextTask(makeCar()), undefined);
});

test("дубли задач, пустой заголовок и неверная ссылка отклоняются", () => {
  assert.equal(parseLedger(makeLedger(makeCar({ tasks: [task(), task()] }))), null);
  assert.equal(parseLedger(makeLedger(makeCar({ tasks: [task({ title: "  " })] }))), null);
  assert.equal(parseLedger(makeLedger(makeCar({ listingUrl: "ftp://example.test/ad" }))), null);
  assert.equal(parseLedger(makeLedger(makeCar({ listingUrl: "не ссылка" }))), null);
});

test("аудит: задачи создаются, выполняются и удаляются; запчасти и ссылка аудируются", () => {
  const before = makeLedger(makeCar());
  const withExtras = makeLedger(makeCar({
    listingUrl: "https://www.avito.ru/item/123",
    tasks: [task()],
    parts: [{ id: "part-1", name: "Бампер", acquired: false, plannedPrice: 1_500_000 }],
  }));
  const created = diffLedgers(before, withExtras);
  assert.ok(created.some(row => row.entity === "task" && row.action === "create" && row.entityName === "Помыть машину"));
  assert.ok(created.some(row => row.entity === "part" && row.action === "create"));
  assert.ok(created.some(row => row.entity === "car" && row.field === "listingUrl" && row.after === "https://www.avito.ru/item/123"));

  const done = makeLedger(makeCar({ listingUrl: "https://www.avito.ru/item/123", tasks: [task({ done: true })], parts: [{ id: "part-1", name: "Бампер", acquired: true, plannedPrice: 1_500_000 }] }));
  const updated = diffLedgers(withExtras, done);
  const doneRow = updated.find(row => row.entity === "task" && row.field === "done");
  assert.ok(doneRow);
  assert.equal(doneRow.before, false);
  assert.equal(doneRow.after, true);
  assert.ok(updated.some(row => row.entity === "part" && row.field === "acquired" && row.after === true));

  const removed = diffLedgers(done, makeLedger(makeCar({ listingUrl: "https://www.avito.ru/item/123" })));
  assert.ok(removed.some(row => row.entity === "task" && row.action === "delete"));
  assert.ok(removed.some(row => row.entity === "part" && row.action === "delete"));
});

test("книга с задачами и ссылкой пишет аудит; выполнение задачи видно в ленте", async t => {
  const runtime = await createRuntime();
  t.after(() => runtime.close());
  const car = makeCar({ listingUrl: "https://www.avito.ru/item/123", tasks: [task()] });
  await runtime.as("owner", () => routes.ledger.PUT(ledgerRequest(makeLedger(car), 0, {}, ledgerClientVersion)));
  const first = await (await runtime.as("owner", () => routes.booksEvents.GET(eventsRequest()))).json();
  assert.ok(first.events.some(event => event.entity === "task" && event.action === "create"));
  await runtime.as("owner", () => routes.ledger.PUT(ledgerRequest(makeLedger(makeCar({ listingUrl: "https://www.avito.ru/item/123", tasks: [task({ done: true })] })), 1, {}, ledgerClientVersion)));
  const second = await (await runtime.as("owner", () => routes.booksEvents.GET(eventsRequest("?entity=task")))).json();
  const doneEvent = second.events.find(event => event.field === "done");
  assert.ok(doneEvent);
  assert.equal(doneEvent.before, false);
  assert.equal(doneEvent.after, true);
});

test("старый клиент без поддержки задач получает 409, новый сохраняет", async t => {
  const runtime = await createRuntime();
  t.after(() => runtime.close());
  const car = makeCar({ tasks: [task()] });
  await runtime.as("owner", () => routes.ledger.PUT(ledgerRequest(makeLedger(car), 0, {}, ledgerClientVersion)));
  const old = await runtime.as("owner", () => routes.ledger.PUT(ledgerRequest(makeLedger(car), 1, {}, 4)));
  assert.equal(old.status, 409);
  const fresh = await runtime.as("owner", () => routes.ledger.PUT(ledgerRequest(makeLedger(car), 1, {}, ledgerClientVersion)));
  assert.equal(fresh.status, 200);
});

test("старый клиент теряет и одну только ссылку объявления — 409", async t => {
  const runtime = await createRuntime();
  t.after(() => runtime.close());
  const car = makeCar({ listingUrl: "https://www.avito.ru/item/1" });
  await runtime.as("owner", () => routes.ledger.PUT(ledgerRequest(makeLedger(car), 0, {}, ledgerClientVersion)));
  assert.equal((await runtime.as("owner", () => routes.ledger.PUT(ledgerRequest(makeLedger(car), 1, {}, 4)))).status, 409);
});

test("доли прибыли в предпросмотре сходятся с итогом (largest remainder)", () => {
  for (const total of [1, -1, 100_000_000_000_007, -100_000_000_000_007]) {
    for (const weights of [[5000, 5000], [3333, 3333, 3334]]) {
      const parts = splitAmount(total, weights);
      assert.equal(parts.reduce((sum, value) => sum + value, 0), total);
    }
  }
});

test("сохранённый фильтр валидируется: мусорные типы и значения сбрасываются", () => {
  assert.equal(parseSavedFilter(null), null);
  assert.equal(parseSavedFilter("не json"), null);
  assert.equal(parseSavedFilter("42"), null);
  const broken = parseSavedFilter('{"query":123,"filter":"hack","sort":"nope","mode":"x"}');
  assert.deepEqual(broken, { filter: "all", sort: "recent", mode: "overview", query: "" });
  const good = parseSavedFilter('{"query":"kia","filter":"listed","sort":"profit","mode":"accounts"}');
  assert.deepEqual(good, { filter: "listed", sort: "profit", mode: "accounts", query: "kia" });
});