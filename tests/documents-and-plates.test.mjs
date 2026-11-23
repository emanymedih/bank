import assert from "node:assert/strict";
import test from "node:test";
import { contractMoney, contractSections } from "../app/sale-contract.ts";
import { formatRussianPlate, normalizePlate, plateCandidates } from "../lib/license-plate.ts";

test("Russian plates with 150/250 regions survive normalization and multiline OCR", () => {
  assert.equal(normalizePlate("a 123 bс-250"), "А123ВС250");
  assert.equal(formatRussianPlate("A123BC150"), "А123ВС150");
  assert.deepEqual(plateCandidates("A 123 BC\n250\nRUS"), ["А123ВС250"]);
  assert.deepEqual(plateCandidates("A123BC 150\nA123BC150"), ["А123ВС150"]);
});

test("an unrecognized image produces no guessed registration and an unsupported format stays manual", () => {
  assert.deepEqual(plateCandidates("Описание автомобиля без читаемого номера"), []);
  assert.deepEqual(plateCandidates("123ABC02"), ["123ABC02"]);
  assert.equal(formatRussianPlate("123ABC02"), null);
});

test("contract amounts parse spaces and decimal kopecks and reject ambiguous input", () => {
  assert.equal(contractMoney("1 490 000,50"), 1_490_000.5);
  for (const value of ["", "0", "-1", "20,123", "1e3"]) assert.equal(contractMoney(value), null);
});

test("a contract uses the supplied parties, vehicle and agreed price", () => {
  const party = { passport: "0000 000000", issuer: "Тестовый орган", issued: "2020-01-02", address: "Тестовый адрес" };
  const content = contractSections({
    city: "Тестовый город", date: "2026-11-23", price: "890000", payment: "Оплата при подписании",
    handover: "В день подписания", conditions: "Тестовое условие",
    seller: { ...party, name: "Тестовый продавец" }, buyer: { ...party, name: "Тестовый покупатель" },
    vehicle: { name: "Модель для проверки", registration: "А123ВС250", vin: "TESTVIN0000000001", year: "2017",
      mileage: "98400", documents: { pts: "00 ТЕ 000001" } },
  });
  assert.deepEqual(content.parties.map(p => p.name), ["Тестовый продавец", "Тестовый покупатель"]);
  assert.match(content.where, /23 ноября 2026/);
  assert.match(content.paragraphs[0].text, /TESTVIN0000000001/);
  assert.match(content.paragraphs[0].text, /00 ТЕ 000001/);
  assert.match(content.paragraphs[1].text, /890\s000,00\s₽/);
});
