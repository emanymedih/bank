import test from "node:test";
import assert from "node:assert/strict";
import { safeReturnTo } from "../lib/safe-return-to.ts";
import { todayIn } from "../app/format.ts";

test("safeReturnTo пропускает только внутренние пути", () => {
  assert.equal(safeReturnTo("/"), "/");
  assert.equal(safeReturnTo("/account"), "/account");
  assert.equal(safeReturnTo("/?book=1"), "/?book=1");
  assert.equal(safeReturnTo(null), "/");
  assert.equal(safeReturnTo(undefined), "/");
});

test("safeReturnTo отклоняет open-redirect", () => {
  assert.equal(safeReturnTo("//evil.com"), "/");
  assert.equal(safeReturnTo("/\\evil.com"), "/");
  assert.equal(safeReturnTo("https://evil.com"), "/");
  assert.equal(safeReturnTo("javascript:alert(1)"), "/");
  assert.equal(safeReturnTo(""), "/");
});

test("todayIn возвращает дату в нужной зоне в формате ISO", () => {
  const value = todayIn("Europe/Moscow");
  assert.match(value, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(todayIn("UTC"), new Date().toISOString().slice(0, 10));
});
