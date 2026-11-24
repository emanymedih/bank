import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";
import { vehicleBrand } from "../app/vehicle-brand.ts";

test("recognizes brands at the start of a vehicle name, including Latin and Cyrillic spellings", () => {
  for (const [name, brand] of [
    ["Mazda 6", "mazda"], ["БМВ 5er", "bmw"], ["BMW530d", "bmw"], ["  Škoda Fabia", "skoda"],
    ["Mercedes-Benz E", "mercedes-benz"], ["VW Polo", "volkswagen"], ["ВАЗ-2108", "lada"],
    ["Хёндэ Solaris", "hyundai"], ["Land-Rover Discovery", "landrover"], ["Ли Авто L9", "li_auto"],
  ]) {
    assert.equal(vehicleBrand(name), brand);
    assert(existsSync(new URL(`../public/brand-marks/${brand}.webp`, import.meta.url)));
  }
});

test("uses the generic mark without a recognized brand", () => {
  assert.equal(vehicleBrand("Неизвестный автомобиль"), undefined);
  assert.equal(vehicleBrand("Подбор Mazda 6"), undefined);
  assert.equal(vehicleBrand("Tankard"), undefined);
});
