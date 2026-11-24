import assert from "node:assert/strict";
import test from "node:test";
import { parsePartList } from "../app/part-import.ts";

const rows = [
  ["А.120", "Передние диски, 299 мм, 2 шт.", 18400],
  ["B-112", "Задние диски, 280 мм, 2 шт.", 12800],
  ["P 41 111", "Передние колодки, комплект", 5900],
  ["P 41 112", "Задние колодки, комплект", 4200],
  ["381450", "Передний левый амортизатор", 10800],
  ["381449", "Передний правый амортизатор", 10800],
  ["389063", "Задние амортизаторы, 2 шт.", 15600],
  ["C 123", "Воздушный фильтр", 2500],
  ["CU 234", "Салонный фильтр", 2300],
  ["W 345/67", "Масляный фильтр", 1700],
];

test("Excel rows keep the article, commas in the name and planned rubles; a total row is skipped", () => {
  const pasted = ["Артикул\tНазвание\tЦена", ...rows.map(([article, name, price]) =>
    [article, name, price.toLocaleString("ru-RU") + " ₽"].join("\t")), "\tИтого за запчасти\t85 000 ₽"].join("\r\n");
  const result = parsePartList(pasted);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.parts, rows.map(([article, name, price]) => ({ article, name, plannedPrice: price * 100 })));
  assert.equal(result.parts.reduce((sum, part) => sum + part.plannedPrice, 0), 8_500_000);
});

test("spreadsheet quotes and empty optional cells survive, without using a malformed price", () => {
  const result = parsePartList('Название\tЦена\tАртикул\n"Диски, 2 шт.\nНабор ""Стандарт"""\t1 234,50 руб.\t001\nФильтр\t\t\nРемень\t5-10\t002');
  assert.deepEqual(result.parts, [
    { article: "001", name: 'Диски, 2 шт. Набор "Стандарт"', plannedPrice: 123450 },
    { name: "Фильтр" },
  ]);
  assert.deepEqual(result.errors, [4]);
});

test("plain text keeps details in a multiline item while a one-line dictation yields separate items", () => {
  assert.deepEqual(parsePartList("- Диски, 299 мм, 2 шт.\n- Фильтр").parts, [
    { name: "Диски, 299 мм, 2 шт." }, { name: "Фильтр" },
  ]);
  assert.deepEqual(parsePartList("Нужны диски, фильтр запятая левая фара").parts, [
    { name: "диски" }, { name: "фильтр" }, { name: "левая фара" },
  ]);
});
