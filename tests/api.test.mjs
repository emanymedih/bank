import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { beforeEach, afterEach } from "node:test";
import { emptyLedger } from "../app/ledger.ts";
import { alice, makeCar, makeLedger } from "./support/fixtures.mjs";
import { createRuntime, ledgerRequest, loadRoutes, photoBytes, photoContext, photoRequest } from "./support/api-runtime.mjs";

const routes = await loadRoutes();
let runtime;
beforeEach(async () => { runtime = await createRuntime(); });
afterEach(() => { runtime.close(); });

test("a ledger belongs to one account and requires authenticated access", async () => {
  assert.equal((await runtime.as(null, routes.ledger.GET)).status, 401);
  assert.equal((await runtime.as(null, () => routes.ledger.PUT(ledgerRequest(emptyLedger, 0)))).status, 401);
  const ledger = makeLedger(makeCar());
  const created = await runtime.as("owner-a", () => routes.ledger.PUT(ledgerRequest(ledger, 0)));
  assert.deepEqual(await created.json(), { revision: 1 });
  assert.deepEqual(await (await runtime.as("owner-a", routes.ledger.GET)).json(), { ledger, revision: 1 });
  assert.deepEqual(await (await runtime.as("owner-b", routes.ledger.GET)).json(), { ledger: emptyLedger, revision: 0 });
});

test("a stale writer cannot replace the winning revision", async () => {
  const original = makeLedger(makeCar());
  assert.equal((await runtime.as("owner", () => routes.ledger.PUT(ledgerRequest(original, 0)))).status, 200);
  const replies = await Promise.all(["Первая правка", "Вторая правка"].map(name =>
    runtime.as("owner", () => routes.ledger.PUT(ledgerRequest(makeLedger(makeCar({ name })), 1)))));
  assert.deepEqual(replies.map(res => res.status).sort(), [200, 409]);
  const winner = replies[0].status === 200 ? "Первая правка" : "Вторая правка";
  const saved = await (await runtime.as("owner", routes.ledger.GET)).json();
  assert.equal(saved.revision, 2);
  assert.equal(saved.ledger.cars[0].name, winner);
});

test("an edited ledger is readable after reopening the SQLite database", async t => {
  const dir = await mkdtemp(join(tmpdir(), "avtobank-ledger-test-"));
  const disk = await createRuntime({ path: join(dir, "ledger.sqlite") });
  t.after(async () => { disk.close(); await rm(dir, { recursive: true, force: true }); });
  const ledger = makeLedger(makeCar({ registration: "А123ВС250" }));
  assert.equal((await disk.as("owner", () => routes.ledger.PUT(ledgerRequest(ledger, 0)))).status, 200);
  disk.reopen();
  assert.deepEqual(await (await disk.as("owner", routes.ledger.GET)).json(), { ledger, revision: 1 });
});

test("only fields defined by the ledger schema are stored", async () => {
  const car = { ...makeCar(), buyer: { draft: "Синтетическая запись" } };
  const sent = { ...makeLedger(car), personalDraft: "Синтетическая запись" };
  assert.equal((await runtime.as("owner", () => routes.ledger.PUT(ledgerRequest(sent, 0)))).status, 200);
  const raw = JSON.parse(runtime.saved("owner").data);
  assert.deepEqual(raw, makeLedger(makeCar()));
});

test("unknown fields already present in a saved book are not returned", async () => {
  const car = { ...makeCar(), buyer: { draft: "Синтетическая запись" } };
  runtime.seed("owner", JSON.stringify(makeLedger(car)));
  const response = await runtime.as("owner", routes.ledger.GET);
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).ledger, makeLedger(makeCar()));
});

test("a corrupted stored ledger is kept in place so it can be recovered", async () => {
  const damaged = '{"cars":';
  runtime.seed("owner", damaged);
  assert.equal((await runtime.as("owner", routes.ledger.GET)).status, 500);
  const write = await runtime.as("owner", () => routes.ledger.PUT(ledgerRequest(makeLedger(makeCar()), 1)));
  assert.equal(write.status, 500);
  assert.deepEqual({ ...runtime.saved("owner") }, { data: damaged, revision: 1 });
});

test("the ledger size limit counts UTF-8 bytes", async () => {
  const oversized = { ...makeLedger(makeCar()), extra: "界".repeat(250_001) };
  assert.equal((await runtime.as("owner", () => routes.ledger.PUT(ledgerRequest(oversized, 0)))).status, 413);
  assert.equal(runtime.saved("owner"), undefined);
});

test("a malformed write or a cross-site request leaves no stored book", async () => {
  const malformed = new Request("https://app.example.test/api/ledger", { method: "PUT", body: "{" });
  assert.equal((await runtime.as("owner", () => routes.ledger.PUT(malformed))).status, 400);
  const invalid = makeLedger(makeCar({ sold: "2026-09-28", price: 120_000_000 }));
  assert.equal((await runtime.as("owner", () => routes.ledger.PUT(ledgerRequest(invalid, 0)))).status, 422);
  assert.equal((await runtime.as("owner", () =>
    routes.ledger.PUT(ledgerRequest(emptyLedger, 0, { "sec-fetch-site": "cross-site" })))).status, 403);
  assert.equal(runtime.saved("owner"), undefined);
});

test("a photo stays private, cannot move to another car via a book write, and is removed with its entry", async () => {
  const first = makeCar({ id: "first" });
  const second = makeCar({ id: "second" });
  runtime.seed("owner", JSON.stringify(makeLedger(first, second)));
  const upload = await runtime.as("owner", () => routes.photos.POST(photoRequest(first.id, 1), photoContext(first.id)));
  assert.equal(upload.status, 200);
  const { ledger, revision } = await upload.json();
  const photo = ledger.cars[0].photos[0];
  const image = new Request("https://app.example.test/api/photos/first?id=" + photo.id);
  const read = await runtime.as("owner", () => routes.photos.GET(image, photoContext(first.id)));
  assert.equal(read.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(new Uint8Array(await read.arrayBuffer()), photoBytes);
  assert.equal((await runtime.as("other", () => routes.photos.GET(image, photoContext(first.id)))).status, 404);
  assert.equal((await runtime.as(null, () => routes.photos.GET(image, photoContext(first.id)))).status, 401);

  const moved = makeLedger(first, { ...second, photos: [photo] });
  assert.equal((await runtime.as("owner", () => routes.ledger.PUT(ledgerRequest(moved, revision)))).status, 422);
  assert.equal(runtime.photos.size, 1);

  assert.equal((await runtime.as("owner", () => routes.ledger.PUT(ledgerRequest(makeLedger(second), revision)))).status, 200);
  assert.equal(runtime.photos.size, 0);
  assert.equal((await runtime.as("owner", () => routes.photos.GET(image, photoContext(first.id)))).status, 404);
});

test("a failed photo upload cleans staged files and leaves the saved revision intact", async () => {
  const car = makeCar({ id: "first", expenses: [
    { id: "expense", name: "Работа", amount: 1_000, payer: alice.id, date: "2026-10-10" },
  ] });
  runtime.seed("owner", JSON.stringify(makeLedger(car)));
  const put = runtime.env.BUCKET.put;
  let attempted = 0;
  runtime.env.BUCKET.put = async (...args) => {
    if (++attempted === 2) throw new Error("Synthetic storage failure");
    await put(...args);
  };
  const req = photoRequest(car.id, 1, { files: [photoBytes, photoBytes] });
  assert.equal((await runtime.as("owner", () => routes.photos.POST(req, photoContext(car.id)))).status, 503);
  assert.equal(attempted, 2);
  assert.equal(runtime.photos.size, 0);
  assert.equal(runtime.saved("owner").revision, 1);
});

test("a photo upload stores and returns only fields defined by the schema", async () => {
  const car = makeCar();
  runtime.seed("owner", JSON.stringify(makeLedger({ ...car, buyer: { draft: "Синтетическая запись" } })));
  const response = await runtime.as("owner", () => routes.photos.POST(photoRequest(car.id, 1), photoContext(car.id)));
  assert.equal(response.status, 200);
  const { ledger } = await response.json();
  assert.equal(ledger.cars[0].photos.length, 1);
  assert.equal("buyer" in ledger.cars[0], false);
  assert.deepEqual(JSON.parse(runtime.saved("owner").data), ledger);
});

test("photo routes preserve a saved book with an invalid structure", async () => {
  const damaged = '{"cars":[]}';
  const id = "test-car";
  runtime.seed("owner", damaged);
  const image = new Request("https://app.example.test/api/photos/test-car?id=test");
  assert.equal((await runtime.as("owner", () => routes.photos.GET(image, photoContext(id)))).status, 500);
  assert.equal((await runtime.as("owner", () => routes.photos.POST(photoRequest(id, 1), photoContext(id)))).status, 500);
  assert.deepEqual({ ...runtime.saved("owner") }, { data: damaged, revision: 1 });
  assert.equal(runtime.photos.size, 0);
});

function lookupRequest(plate, headers = {}) {
  return new Request("https://app.example.test/api/plate-lookup", {
    method: "POST", headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({ plate }),
  });
}

test("plate lookup checks authorization, configuration, and supported plates before spending a request", async t => {
  const request = t.mock.method(globalThis, "fetch", async () => { throw Error("Unexpected provider call"); });
  const lookup = (id, plate, headers) => runtime.as(id, () => routes.lookup.POST(lookupRequest(plate, headers)));
  assert.equal((await lookup(null, "А123ВС250")).status, 401);
  assert.deepEqual(await (await lookup("owner", "А123ВС250")).json(), { status: "not_enabled" });
  runtime.env.AVTO_VIN_COD_TOKEN = "synthetic-token";
  assert.equal((await lookup("owner", "А123ВС250", { "sec-fetch-site": "cross-site" })).status, 403);
  assert.deepEqual(await (await lookup("owner", "123ABC01")).json(), { status: "unsupported" });
  assert.equal(request.mock.callCount(), 0);
});

test("plate lookup keeps manual entry available for no match, exhausted balance, and inconsistent provider data", async t => {
  runtime.env.AVTO_VIN_COD_TOKEN = "synthetic-token";
  let reply;
  const request = t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(url.searchParams.get("plate"), "А123ВС250");
    assert.equal(options.headers.Authorization, "Bearer synthetic-token");
    return reply;
  });
  const cases = [
    [Response.json({ success: 0, status: "not_found" }), 200, { status: "not_found" }],
    [new Response(null, { status: 402 }), 200, { status: "balance" }],
    [Response.json({ success: 1, licensePlate: "А123ВС150", model: "Polo" }), 502, { status: "unavailable" }],
    [Response.json({ success: 1, testMode: true, model: "Polo" }), 502, { status: "unavailable" }],
    [Response.json({ success: 1, licensePlate: "А123ВС250", brand: "Volkswagen", model: "Polo", year: "2017" }),
      200, { status: "found", details: { name: "Volkswagen Polo", year: 2017 } }],
  ];
  for (const [providerReply, status, body] of cases) {
    reply = providerReply;
    const response = await runtime.as("owner", () => routes.lookup.POST(lookupRequest("A123BC250")));
    assert.equal(response.status, status);
    assert.deepEqual(await response.json(), body);
  }
  assert.equal(request.mock.callCount(), cases.length);
});

test("a photo cannot grow the ledger past the limit for a subsequent save", async () => {
  const ledger = makeLedger(...Array.from({ length: 6 }, (_, index) => makeCar({
    id: "car-" + index,
    works: Array.from({ length: 100 }, (_, work) => ({
      id: "work-" + work, name: "Работа", date: "2026-10-01", notes: "я".repeat(350),
    })),
  })));
  const targetBytes = 749_924;
  let remaining = targetBytes - Buffer.byteLength(JSON.stringify(ledger));
  for (const work of ledger.cars.flatMap(car => car.works)) {
    if (remaining <= 0) break;
    const letters = Math.min(399, Math.floor(remaining / 2));
    work.notes += "я".repeat(letters);
    remaining -= letters * 2;
    if (remaining === 1) {
      work.notes += "X";
      remaining = 0;
    }
  }
  assert.equal(Buffer.byteLength(JSON.stringify(ledger)), targetBytes);
  assert.equal((await runtime.as("owner", () => routes.ledger.PUT(ledgerRequest(ledger, 0)))).status, 200);

  const id = ledger.cars[0].id;
  const upload = await runtime.as("owner", () => routes.photos.POST(photoRequest(id, 1), photoContext(id)));
  assert.equal(upload.status, 413);
  assert.equal(runtime.saved("owner").revision, 1);
  assert.equal(runtime.photos.size, 0);
});

test("a photo upload cleans staged data if a concurrent ledger write removes its car", async () => {
  const car = makeCar();
  runtime.seed("owner", JSON.stringify(makeLedger(car)));
  const staged = Promise.withResolvers();
  const release = Promise.withResolvers();
  const put = runtime.env.BUCKET.put;
  runtime.env.BUCKET.put = async (...args) => {
    await put(...args);
    staged.resolve();
    await release.promise;
  };
  const upload = runtime.as("owner", () => routes.photos.POST(photoRequest(car.id, 1), photoContext(car.id)));
  try {
    await Promise.race([staged.promise, upload.then(() => assert.fail("Upload finished before staging"))]);
    const edited = await runtime.as("owner", () => routes.ledger.PUT(ledgerRequest(makeLedger(), 1)));
    assert.equal(edited.status, 200);
  } finally {
    release.resolve();
  }
  assert.equal((await upload).status, 409);
  assert.equal(runtime.photos.size, 0);
  assert.deepEqual(await (await runtime.as("owner", routes.ledger.GET)).json(), { ledger: makeLedger(), revision: 2 });
});
