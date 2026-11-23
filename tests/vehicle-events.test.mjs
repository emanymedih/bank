import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { figures } from "../app/ledger.ts";
import { expense, makeCar } from "./support/fixtures.mjs";

const result = await build({
  entryPoints: ["app/vehicle-workspace.tsx"], bundle: true, write: false, platform: "node", format: "esm",
});
const { vehicleEvents } = await import("data:text/javascript;base64," + Buffer.from(result.outputFiles[0].contents).toString("base64"));

test("a linked expense appears once in the vehicle timeline and remains traceable", () => {
  const paid = expense();
  const car = makeCar({
    expenses: [paid],
    works: [
      { id: "same-day", name: "Работа", date: paid.date, notes: "", expenseId: paid.id },
      { id: "later", name: "Повторный осмотр", date: "2026-11-23", notes: "", expenseId: paid.id },
    ],
  });
  const events = vehicleEvents(car);
  assert.equal(events[0].id, "work:later");
  assert.equal(events[0].amount, null);
  assert.equal(events[0].expense.id, paid.id);
  assert.equal(events.find(event => event.id === "work:same-day").amount, paid.amount);
  assert(!events.some(event => event.id === "expense:" + paid.id));
  assert.equal(events.filter(event => event.type === "work" || event.type === "expense")
    .reduce((sum, event) => sum + (event.amount ?? 0), 0), figures(car).expenses);
});
