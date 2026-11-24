import assert from "node:assert/strict";
import test from "node:test";
import { createRuntime, jsonRequest, ledgerRequest, loadRoutes } from "./support/api-runtime.mjs";
import { makeCar, makeLedger } from "./support/fixtures.mjs";

const routes = await loadRoutes();

test("перебор пароля ограничен по IP: после 20 попыток 429", async t => {
  const runtime = await createRuntime();
  t.after(() => runtime.close());
  const phone = runtime.phoneOf("owner");
  let last;
  for (let index = 0; index < 21; index++) {
    last = await runtime.withCookie("", () => routes.authLogin.POST(jsonRequest("/api/auth/login", { phone, password: "wrong-password-" + index })));
  }
  assert.equal(last.status, 429);
});

test("веерная рассылка OTP ограничена по IP: после 10 кодов 429", async t => {
  const runtime = await createRuntime();
  t.after(() => runtime.close());
  let last;
  for (let index = 0; index < 11; index++) {
    last = await runtime.withCookie("", () => routes.authRegister.POST(jsonRequest("/api/auth/register", { phone: "+7900" + String(1000000 + index) })));
  }
  assert.equal(last.status, 429);
});

test("API сеансов не отдаёт токены и отзывает по публичному id", async t => {
  const runtime = await createRuntime();
  t.after(() => runtime.close());
  runtime.phoneOf("owner");
  const list = await (await runtime.as("owner", () => routes.authSessions.GET())).json();
  assert.equal(list.sessions.length, 1);
  assert.notEqual(list.sessions[0].id, "sess-owner", "сырой токен не должен попадать в ответ");
  const removed = await runtime.as("owner", () => routes.authSessions.DELETE(new Request("https://app.example.test/api/auth/sessions?id=" + list.sessions[0].id, { method: "DELETE" })));
  assert.equal(removed.status, 200);
  assert.equal((await runtime.as("owner", () => routes.ledger.GET())).status, 401);
});

test("автор новой задачи подставляется сервером, подделка не проходит", async t => {
  const runtime = await createRuntime();
  t.after(() => runtime.close());
  const car = makeCar({ tasks: [{ id: "task-1", title: "Помыть", done: false, createdAt: "2026-10-02", author: "Подставной" }] });
  await runtime.as("owner", () => routes.ledger.PUT(ledgerRequest(makeLedger(car), 0)));
  const saved = JSON.parse(runtime.saved("owner").data);
  assert.equal(saved.cars[0].tasks[0].author, "Тест owner");
});