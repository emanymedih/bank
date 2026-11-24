import assert from "node:assert/strict";
import test from "node:test";
import { createRuntime, jsonRequest, ledgerRequest, loadRoutes } from "./support/api-runtime.mjs";
import { makeCar, makeLedger } from "./support/fixtures.mjs";

const routes = await loadRoutes();

test("книга создаётся с пустой книгой и владельцем; список книг отдаёт роли", async t => {
  const runtime = await createRuntime();
  t.after(() => runtime.close());
  await runtime.as("owner", async () => {
    const created = await routes.books.POST(jsonRequest("/api/books", { title: "Перекуп №1" }));
    assert.equal(created.status, 200);
    const { book } = await created.json();
    assert.equal(book.role, "owner");
    const list = await routes.books.GET();
    const books = (await list.json()).books;
    assert.equal(books.length, 2); // личная книга регистрации + новая
    assert.ok(books.some(item => item.id === book.id && item.role === "owner"));
    const ledger = await routes.ledger.GET();
    assert.deepEqual((await ledger.json()).ledger.cars, []);
  });
});

test("приглашение: принимает только приглашённый номер; роль редактора пишет, наблюдатель — нет", async t => {
  const runtime = await createRuntime();
  t.after(() => runtime.close());
  const book = await runtime.as("owner", async () => {
    const created = await routes.books.POST(jsonRequest("/api/books", { title: "Общая" }));
    return (await created.json()).book;
  });
  await runtime.as("owner", () => routes.booksSelect.POST(jsonRequest("/api/books/select", { bookId: book.id })));
  const partnerPhone = runtime.phoneOf("partner");
  const invite = await runtime.as("owner", () => routes.booksMembers.POST(jsonRequest("/api/books/members", { phone: partnerPhone, role: "editor" })));
  assert.equal(invite.status, 200);
  const { token } = await invite.json();
  assert.equal((await runtime.as("stranger", () => routes.invitesAccept.POST(jsonRequest("/api/invites/accept", { token })))).status, 403);
  const accepted = await runtime.as("partner", () => routes.invitesAccept.POST(jsonRequest("/api/invites/accept", { token })));
  assert.equal(accepted.status, 200);
  assert.equal((await runtime.as("partner", () => routes.invitesAccept.POST(jsonRequest("/api/invites/accept", { token })))).status, 404);
  const partnerBooks = await runtime.as("partner", () => routes.books.GET());
  assert.ok((await partnerBooks.json()).books.some(item => item.id === book.id && item.role === "editor"));
  assert.equal((await runtime.as("partner", () => routes.ledger.PUT(ledgerRequest(makeLedger(makeCar()), 0)))).status, 200);
  assert.equal((await runtime.as("partner", () => routes.booksMembers.POST(jsonRequest("/api/books/members", { phone: "+79000000009", role: "viewer" })))).status, 403);

  const viewerInvite = await runtime.as("owner", () => routes.booksMembers.POST(jsonRequest("/api/books/members", { phone: runtime.phoneOf("viewer"), role: "viewer" })));
  const viewerToken = (await viewerInvite.json()).token;
  await runtime.as("viewer", () => routes.invitesAccept.POST(jsonRequest("/api/invites/accept", { token: viewerToken })));
  assert.equal((await runtime.as("viewer", () => routes.ledger.PUT(ledgerRequest(makeLedger(makeCar()), 1)))).status, 403);
  const members = await runtime.as("viewer", () => routes.booksMembers.GET());
  assert.equal(members.status, 200);
  const { members: people } = await members.json();
  assert.equal(people.find(person => person.userId === "owner").phone, "+79 *** *** 00");
});

test("владелец управляет участниками: удаление редактора, защита владельца и себя", async t => {
  const runtime = await createRuntime();
  t.after(() => runtime.close());
  await runtime.as("owner", () => routes.books.POST(jsonRequest("/api/books", { title: "Общая" })));
  const invite = await runtime.as("owner", () => routes.booksMembers.POST(jsonRequest("/api/books/members", { phone: runtime.phoneOf("partner"), role: "editor" })));
  const inviteToken = (await invite.json()).token;
  await runtime.as("partner", () => routes.invitesAccept.POST(jsonRequest("/api/invites/accept", { token: inviteToken })));
  assert.equal((await runtime.as("owner", () => routes.booksMembers.DELETE(jsonRequest("/api/books/members?userId=owner", undefined, { method: "DELETE" })))).status, 422);
  assert.equal((await runtime.as("partner", () => routes.booksMembers.DELETE(jsonRequest("/api/books/members?userId=owner", undefined, { method: "DELETE" })))).status, 403);
  assert.equal((await runtime.as("owner", () => routes.booksMembers.DELETE(jsonRequest("/api/books/members?userId=partner", undefined, { method: "DELETE" })))).status, 200);
  assert.equal((await runtime.as("partner", () => routes.ledger.PUT(ledgerRequest(makeLedger(makeCar()), 0)))).status, 404);
});

test("чужая книга не выбирается; своя книга читается", async t => {
  const runtime = await createRuntime();
  t.after(() => runtime.close());
  await runtime.as("owner", () => routes.ledger.PUT(ledgerRequest(makeLedger(makeCar()), 0)));
  const mine = await runtime.as("owner", () => routes.ledger.GET());
  assert.equal((await mine.json()).ledger.cars[0].id, "test-car");
  const denied = await runtime.as("stranger", () => routes.booksSelect.POST(jsonRequest("/api/books/select", { bookId: "book-owner" })));
  assert.equal(denied.status, 403);
  const own = await runtime.as("stranger", () => routes.ledger.GET());
  assert.equal(own.status, 200);
  assert.deepEqual((await own.json()).ledger.cars, []);
});

test("наблюдатель не меняет книгу; переключение книги меняет данные", async t => {
  const runtime = await createRuntime();
  t.after(() => runtime.close());
  const second = await runtime.as("owner", async () => {
    const created = await routes.books.POST(jsonRequest("/api/books", { title: "Вторая" }));
    return (await created.json()).book;
  });
  await runtime.as("owner", () => routes.ledger.PUT(ledgerRequest(makeLedger(makeCar()), 0)));
  const switched = await runtime.as("owner", () => routes.booksSelect.POST(jsonRequest("/api/books/select", { bookId: second.id })));
  assert.equal(switched.status, 200);
  const empty = await runtime.as("owner", () => routes.ledger.GET());
  assert.deepEqual((await empty.json()).ledger.cars, []);
});