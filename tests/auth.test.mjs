import assert from "node:assert/strict";
import test from "node:test";
import { cookieFrom, createRuntime, jsonRequest, loadRoutes } from "./support/api-runtime.mjs";

const routes = await loadRoutes();
const phone = "+79123456789";
const register = (runtime, body) => runtime.withCookie(null, () => routes.authRegister.POST(jsonRequest("/api/auth/register", body)));
const verify = (runtime, body) => runtime.withCookie(null, () => routes.authVerify.POST(jsonRequest("/api/auth/verify", body)));

test("регистрация: номер → код → пароль; неверный код не создаёт пользователя", async t => {
  const runtime = await createRuntime();
  t.after(() => runtime.close());
  assert.equal((await register(runtime, { phone: "123" })).status, 422);
  assert.equal((await register(runtime, { phone })).status, 200);
  const bad = await verify(runtime, { phone, code: "000000", password: "password1", name: "Пётр" });
  assert.equal(bad.status, 401);
  assert.equal(runtime.get("select count(*) as n from users where phone = ?", phone).n, 0);
  const good = await verify(runtime, { phone, code: "123456", password: "password1", name: "Пётр" });
  assert.equal(good.status, 200);
  assert.ok(cookieFrom(good, "avto_session"));
  assert.equal((await good.json()).user.name, "Пётр");
  assert.equal(runtime.get("select count(*) as n from users where phone = ?", phone).n, 1);
  assert.equal((await register(runtime, { phone })).status, 409);
});

test("лимиты OTP: пять неверных попыток, шестая отклонена; повтор раньше минуты отклонён", async t => {
  const runtime = await createRuntime();
  t.after(() => runtime.close());
  await register(runtime, { phone });
  for (let i = 0; i < 5; i++) {
    assert.equal((await verify(runtime, { phone, code: "000000", password: "password1", name: "Пётр" })).status, 401);
  }
  assert.equal((await verify(runtime, { phone, code: "123456", password: "password1", name: "Пётр" })).status, 429);
  const fresh = "+79000000001";
  await register(runtime, { phone: fresh });
  assert.equal((await register(runtime, { phone: fresh })).status, 429);
});

test("вход, сессии и выход: отозванная сессия не даёт доступ", async t => {
  const runtime = await createRuntime();
  t.after(() => runtime.close());
  await register(runtime, { phone });
  const created = await verify(runtime, { phone, code: "123456", password: "password1", name: "Пётр" });
  const session = cookieFrom(created, "avto_session");
  const cookie = "avto_session=" + session;
  assert.equal((await runtime.withCookie(null, () => routes.authLogin.POST(jsonRequest("/api/auth/login", { phone, password: "wrong" })))).status, 401);
  const login = await runtime.withCookie(null, () => routes.authLogin.POST(jsonRequest("/api/auth/login", { phone, password: "password1" })));
  assert.equal(login.status, 200);
  const list = await runtime.withCookie(cookie, () => routes.authSessions.GET());
  assert.equal(list.status, 200);
  const { sessions } = await list.json();
  assert.equal(sessions.length, 2);
  const other = sessions.find(item => item.id !== session);
  assert.equal((await runtime.withCookie(cookie, () => routes.authSessions.DELETE(jsonRequest("/api/auth/sessions?id=" + other.id, undefined, { method: "DELETE" })))).status, 200);
  assert.equal((await runtime.withCookie("avto_session=" + other.id, () => routes.authSessions.GET())).status, 401);
  const logout = await runtime.withCookie(cookie, () => routes.authLogout.POST(jsonRequest("/api/auth/logout", {})));
  assert.equal(logout.status, 200);
  assert.equal((await runtime.withCookie(cookie, () => routes.authSessions.GET())).status, 401);
});

test("сброс пароля по коду меняет пароль и гасит старые сессии", async t => {
  const runtime = await createRuntime();
  t.after(() => runtime.close());
  await register(runtime, { phone });
  const created = await verify(runtime, { phone, code: "123456", password: "password1", name: "Пётр" });
  const oldCookie = "avto_session=" + cookieFrom(created, "avto_session");
  assert.equal((await runtime.withCookie(null, () => routes.authReset.POST(jsonRequest("/api/auth/reset", { phone })))).status, 200);
  assert.equal((await runtime.withCookie(null, () => routes.authResetConfirm.POST(jsonRequest("/api/auth/reset-confirm", { phone, code: "123456", password: "password2" })))).status, 200);
  assert.equal((await runtime.withCookie(oldCookie, () => routes.authSessions.GET())).status, 401);
  assert.equal((await runtime.withCookie(null, () => routes.authLogin.POST(jsonRequest("/api/auth/login", { phone, password: "password1" })))).status, 401);
  assert.equal((await runtime.withCookie(null, () => routes.authLogin.POST(jsonRequest("/api/auth/login", { phone, password: "password2" })))).status, 200);
});
