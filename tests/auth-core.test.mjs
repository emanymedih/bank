import assert from "node:assert/strict";
import test from "node:test";
import { normalizeRussianPhone, maskPhone } from "../lib/phone.ts";
import { hashPassword, verifyPassword } from "../lib/password.ts";

test("нормализация российского мобильного номера принимает 8/+7/9 и отклоняет мусор", () => {
  for (const input of ["+7 912 345-67-89", "8 (912) 345-67-89", "79123456789", "9123456789"]) {
    assert.equal(normalizeRussianPhone(input), "+79123456789");
  }
  for (const input of ["", "+7 812 345-67-89", "8912345678", "+1 912 345 6789", "abc", null, 89123456789]) {
    assert.equal(normalizeRussianPhone(input), null);
  }
});

test("маска телефона скрывает середину номера", () => {
  assert.equal(maskPhone("+79123456789"), "+79 *** *** 89");
});

test("scrypt-хеш проверяет верный пароль и отклоняет неверный и повреждённый", () => {
  const stored = hashPassword("correct horse battery");
  assert.notEqual(stored, hashPassword("correct horse battery"));
  assert.ok(verifyPassword("correct horse battery", stored));
  assert.ok(!verifyPassword("wrong password", stored));
  assert.ok(!verifyPassword("correct horse battery", "broken"));
  assert.ok(!verifyPassword("correct horse battery", ""));
});
