import assert from "node:assert/strict";
import test from "node:test";
import { createRuntime, jsonRequest, ledgerRequest, loadRoutes } from "./support/api-runtime.mjs";
import { alice, bob, expense, makeCar, makeLedger } from "./support/fixtures.mjs";

const routes = await loadRoutes();
const eventsRequest = (query = "") => new Request("https://app.example.test/api/books/events" + query);

test("изменение книги пишет аудит с автором и было/стало", async t => {
  const runtime = await createRuntime();
  t.after(() => runtime.close());
  await runtime.as("owner", () => routes.ledger.PUT(ledgerRequest(makeLedger(makeCar()), 0)));
  const changed = makeLedger(makeCar({ buy: 110_000_000, shares: [{ partner: alice.id, buy: 55_000_000, weight: 5000, withdrawn: false }, { partner: bob.id, buy: 55_000_000, weight: 5000, withdrawn: false }] }));
  await runtime.as("owner", () => routes.ledger.PUT(ledgerRequest(changed, 1)));
  const response = await runtime.as("owner", () => routes.booksEvents.GET(eventsRequest()));
  assert.equal(response.status, 200);
  const { events } = await response.json();
  const buy = events.find(event => event.entity === "car" && event.field === "buy");
  assert.ok(buy);
  assert.equal(buy.before, 100_000_000);
  assert.equal(buy.after, 110_000_000);
  assert.equal(buy.userName, "Тест owner");
  assert.equal(buy.userId, "owner");
  assert.equal(buy.revision, 2);
  assert.equal(buy.action, "update");
});

test("первая запись книги фиксирует создание кассы и авто, но не служебных партнёров", async t => {
  const runtime = await createRuntime();
  t.after(() => runtime.close());
  const ledger = { ...makeLedger(makeCar()), cashEntries: [{ id: "c1", date: "2026-10-01", name: "Банк", amount: 50_000_000, direction: "in" }] };
  await runtime.as("owner", () => routes.ledger.PUT(ledgerRequest(ledger, 0)));
  const { events } = await (await runtime.as("owner", () => routes.booksEvents.GET(eventsRequest()))).json();
  assert.ok(events.some(event => event.entity === "cash" && event.action === "create"));
  assert.ok(events.some(event => event.entity === "car" && event.action === "create"));
  assert.ok(!events.some(event => event.entity === "partner"));
});

test("лента читается наблюдателем, закрыта для чужих и фильтруется по авто и типу", async t => {
  const runtime = await createRuntime();
  t.after(() => runtime.close());
  await runtime.as("owner", () => routes.ledger.PUT(ledgerRequest(makeLedger(makeCar()), 0)));
  await runtime.as("owner", () => routes.ledger.PUT(ledgerRequest(makeLedger(makeCar({ expenses: [expense()] })), 1)));
  const invite = await runtime.as("owner", () => routes.booksMembers.POST(jsonRequest("/api/books/members", { phone: runtime.phoneOf("viewer"), role: "viewer" })));
  const viewerToken = (await invite.json()).token;
  await runtime.as("viewer", () => routes.invitesAccept.POST(jsonRequest("/api/invites/accept", { token: viewerToken })));
  assert.equal((await runtime.as("viewer", () => routes.booksEvents.GET(eventsRequest()))).status, 200);
  runtime.phoneOf("stranger");
  assert.equal((await runtime.withCookie("avto_session=sess-stranger; avto_book=book-owner", () => routes.booksEvents.GET(eventsRequest()))).status, 404);

  const byCar = await (await runtime.as("owner", () => routes.booksEvents.GET(eventsRequest("?carId=test-car")))).json();
  assert.ok(byCar.events.length > 0);
  assert.ok(byCar.events.every(event => event.carId === "test-car"));
  const byEntity = await (await runtime.as("owner", () => routes.booksEvents.GET(eventsRequest("?entity=expense")))).json();
  assert.ok(byEntity.events.length > 0);
  assert.ok(byEntity.events.every(event => event.entity === "expense"));
  assert.equal((await runtime.as("owner", () => routes.booksEvents.GET(eventsRequest("?entity=nope")))).status, 422);
});

test("пагинация ленты по cursor и лимит хранения 1000 событий", async t => {
  const runtime = await createRuntime();
  t.after(() => runtime.close());
  await runtime.as("owner", () => routes.ledger.PUT(ledgerRequest(makeLedger(makeCar()), 0)));
  // Наполняем журнал сверх лимита прямыми строками, затем одна правка книги запускает обрезку.
  for (let index = 0; index < 1050; index++) {
    runtime.run("insert into audit_events (book_id, user_id, user_name, at, revision, entity, entity_id, entity_name, action) values (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      "book-owner", "owner", "Тест owner", "2026-11-01T00:00:00.000Z", 1, "cash", "old-" + index, "Старое", "update");
  }
  await runtime.as("owner", () => routes.ledger.PUT(ledgerRequest(makeLedger(makeCar({ buy: 105_000_000, shares: [{ partner: alice.id, buy: 52_500_000, weight: 5000, withdrawn: false }, { partner: bob.id, buy: 52_500_000, weight: 5000, withdrawn: false }] })), 1)));
  const count = runtime.get("select count(*) as n from audit_events where book_id = 'book-owner'");
  assert.equal(count.n, 1000, `ожидалось ровно 1000 событий книги, получено ${count.n}`);

  const first = await (await runtime.as("owner", () => routes.booksEvents.GET(eventsRequest("?limit=5")))).json();
  assert.equal(first.events.length, 5);
  assert.ok(first.nextCursor);
  const second = await (await runtime.as("owner", () => routes.booksEvents.GET(eventsRequest(`?limit=5&cursor=${first.nextCursor}`)))).json();
  assert.ok(second.events.every(event => event.seq < first.nextCursor));
  assert.ok(first.events[0].seq > second.events[0].seq);
});

test("выплаты и расходы попадают в ленту карточки авто", async t => {
  const runtime = await createRuntime();
  t.after(() => runtime.close());
  await runtime.as("owner", () => routes.ledger.PUT(ledgerRequest(makeLedger(makeCar()), 0)));
  const payout = { id: "pay-1", amount: 10_000_000, date: "2026-11-02", fromCash: true };
  const car = makeCar({ sold: "2026-11-01", price: 130_000_000, expenses: [expense()], shares: [{ partner: alice.id, buy: 50_000_000, weight: 5000, withdrawn: false, payouts: [payout] }, { partner: bob.id, buy: 50_000_000, weight: 5000, withdrawn: false }] });
  await runtime.as("owner", () => routes.ledger.PUT(ledgerRequest(makeLedger(car), 1)));
  const { events } = await (await runtime.as("owner", () => routes.booksEvents.GET(eventsRequest("?carId=test-car")))).json();
  assert.ok(events.some(event => event.entity === "expense" && event.action === "create"));
  const payoutEvent = events.find(event => event.entity === "payout");
  assert.ok(payoutEvent);
  assert.equal(payoutEvent.after.amount, 10_000_000);
  assert.ok(payoutEvent.entityName.includes(alice.name));
});

test("большой дифф больше 7 строк сохраняется целиком (лимит параметров D1)", async t => {
  const runtime = await createRuntime();
  t.after(() => runtime.close());
  const expenses = Array.from({ length: 9 }, (_, index) => expense({ id: "exp-" + index, name: "Расход " + index }));
  await runtime.as("owner", () => routes.ledger.PUT(ledgerRequest(makeLedger(makeCar({ expenses })), 0)));
  const { events } = await (await runtime.as("owner", () => routes.booksEvents.GET(eventsRequest("?limit=200")))).json();
  assert.equal(events.length, 10, "авто + 9 расходов должны быть записаны все");
  assert.equal(events.filter(event => event.entity === "expense").length, 9);
});

test("ошибка записи аудита не ломает сохранение книги", async t => {
  const runtime = await createRuntime();
  t.after(() => runtime.close());
  await runtime.as("owner", () => routes.ledger.PUT(ledgerRequest(makeLedger(makeCar()), 0)));
  runtime.run("drop table audit_events");
  const changed = makeLedger(makeCar({ buy: 110_000_000, shares: [{ partner: alice.id, buy: 55_000_000, weight: 5000, withdrawn: false }, { partner: bob.id, buy: 55_000_000, weight: 5000, withdrawn: false }] }));
  const response = await runtime.as("owner", () => routes.ledger.PUT(ledgerRequest(changed, 1)));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).revision, 2);
  assert.equal(runtime.saved("owner").revision, 2);
});

test("отклонённые сохранения (409 и 422) не пишут аудит", async t => {
  const runtime = await createRuntime();
  t.after(() => runtime.close());
  await runtime.as("owner", () => routes.ledger.PUT(ledgerRequest(makeLedger(makeCar()), 0)));
  const before = runtime.get("select count(*) as n from audit_events").n;
  const conflict = await runtime.as("owner", () => routes.ledger.PUT(ledgerRequest(makeLedger(makeCar()), 0)));
  assert.equal(conflict.status, 409);
  const invalid = await runtime.as("owner", () => routes.ledger.PUT(ledgerRequest(makeLedger(makeCar({ buy: 110_000_000 })), 1)));
  assert.equal(invalid.status, 422);
  assert.equal(runtime.get("select count(*) as n from audit_events").n, before);
});

test("анонимный запрос ленты получает 401", async t => {
  const runtime = await createRuntime();
  t.after(() => runtime.close());
  assert.equal((await runtime.withCookie("", () => routes.booksEvents.GET(eventsRequest()))).status, 401);
});

test("невалидные limit и cursor отклоняются, большой limit ограничивается 200", async t => {
  const runtime = await createRuntime();
  t.after(() => runtime.close());
  await runtime.as("owner", () => routes.ledger.PUT(ledgerRequest(makeLedger(makeCar()), 0)));
  for (const query of ["?limit=2.5", "?limit=-3", "?limit=abc", "?cursor=-1", "?cursor=1.5", "?cursor=abc"]) {
    assert.equal((await runtime.as("owner", () => routes.booksEvents.GET(eventsRequest(query)))).status, 400, query);
  }
  assert.equal((await runtime.as("owner", () => routes.booksEvents.GET(eventsRequest("?limit=999999")))).status, 200);
});

test("телефон автора не попадает в события ленты", async t => {
  const runtime = await createRuntime();
  t.after(() => runtime.close());
  const phone = runtime.phoneOf("owner");
  await runtime.as("owner", () => routes.ledger.PUT(ledgerRequest(makeLedger(makeCar()), 0)));
  const body = await (await runtime.as("owner", () => routes.booksEvents.GET(eventsRequest()))).text();
  assert.ok(!body.includes(phone), "телефон не должен храниться в аудите");
});

test("обрезка хранит 1000 событий книги и не задевает соседние книги", async t => {
  const runtime = await createRuntime();
  t.after(() => runtime.close());
  await runtime.as("owner", () => routes.ledger.PUT(ledgerRequest(makeLedger(makeCar()), 0)));
  runtime.phoneOf("neighbor");
  for (let index = 0; index < 1005; index++) {
    runtime.run("insert into audit_events (book_id, user_id, user_name, at, revision, entity, entity_id, entity_name, action) values (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      "book-neighbor", "neighbor", "Тест neighbor", "2026-11-01T00:00:00.000Z", 1, "cash", "old-" + index, "Старое", "update");
  }
  await runtime.as("neighbor", () => routes.ledger.PUT(ledgerRequest(makeLedger(makeCar()), 0)));
  assert.equal(runtime.get("select count(*) as n from audit_events where book_id = 'book-owner'").n, 1, "события тихой книги не должны выталкиваться чужой активностью");
  assert.equal(runtime.get("select count(*) as n from audit_events where book_id = 'book-neighbor'").n, 1000);
});