import assert from "node:assert/strict";
import test from "node:test";
import { contractSections, parseTransferDate, vehicleTransferSections } from "../app/sale-contract.ts";

const party = { issuer: "Тестовый орган", issued: "2020-01-02", address: "Тестовый адрес" };
const contract = {
  city: "Место договора", date: "2026-11-20", price: "890000", payment: "Условия оплаты",
  handover: "Условия договора о передаче", conditions: "Особые условия договора",
  seller: { ...party, name: "Тестовый продавец", passport: "0000 000001" },
  buyer: { ...party, name: "Тестовый покупатель", passport: "0000 000002" },
  vehicle: { name: "Тестовая модель", registration: "А123ВС250", vin: "TESTVIN0000000001", year: "2017",
    mileage: "98400", documents: { pts: "00 ТЕ 000001", sts: "00 ТЕ 000002" } },
};

test("an act reuses the parties and vehicle, and records the actual handover", () => {
  const act = vehicleTransferSections(contract, {
    place: "Место передачи", date: "2026-11-23", mileage: "98520",
    keys: "Два ключа", documents: "СТС и сервисная книжка", notes: "Царапина на правой двери",
  });

  assert.equal(act.heading, "Акт приёма-передачи автомобиля");
  assert.match(act.where, /^Место передачи · 23 ноября 2026/);
  assert.deepEqual(act.parties, [
    { label: "Продавец", name: "Тестовый продавец", details: "Паспорт: 0000 000001" },
    { label: "Покупатель", name: "Тестовый покупатель", details: "Паспорт: 0000 000002" },
  ]);
  assert.match(act.paragraphs[0].text, /20 ноября 2026/);
  assert.match(act.paragraphs[0].text, /Тестовая модель.*2017.*TESTVIN0000000001.*А123ВС250.*98520 км/);
  assert.deepEqual(act.paragraphs.slice(1), [
    { name: "Переданные ключи", text: "Два ключа" },
    { name: "Переданные документы", text: "СТС и сервисная книжка" },
    { name: "Замечания при передаче", text: "Царапина на правой двери" },
  ]);
  assert.doesNotMatch(JSON.stringify(act), /890000|98400|Тестовый адрес|Тестовый орган|Место договора|Условия оплаты|Условия договора|Особые условия/);
  assert.match(contractSections(contract).paragraphs[0].text, /98400 км/);
});

test("an act can use a chassis number in place of a VIN and show a zero odometer", () => {
  const act = vehicleTransferSections({
    ...contract, vehicle: { ...contract.vehicle, vin: "", documents: { ...contract.vehicle.documents, chassis: "TEST-FRAME" } },
  }, { place: "Место передачи", date: "2026-11-23", mileage: "0", keys: "", documents: "", notes: "" });

  assert.equal(act.paragraphs.length, 1);
  assert.match(act.paragraphs[0].text, /Пробег: 0 км .*Шасси: TEST-FRAME/);
  assert.doesNotMatch(act.paragraphs[0].text, /VIN|ПТС|СТС/);
});

test("handover dates use real calendar dates with four-digit years", () => {
  for (const value of ["0001-01-01", "2024-02-29", "9999-12-31"]) assert.equal(parseTransferDate(value), value);
  for (const value of ["", "0000-01-01", "2026-02-29", "2026-13-01", "10000-01-01"]) assert.equal(parseTransferDate(value), null);
});
