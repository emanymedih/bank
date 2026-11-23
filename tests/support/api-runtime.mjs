import { AsyncLocalStorage } from "node:async_hooks";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

// Real route handlers and SQL, with local stand-ins for request identity and object storage.
const context = new AsyncLocalStorage();
const runtimeKey = Symbol.for("avtobank.api-test-context");
globalThis[runtimeKey] = context;
const files = {
  ledger: "app/api/ledger/route.ts",
  photos: "app/api/photos/[carId]/route.ts",
  lookup: "app/api/plate-lookup/route.ts",
};

export async function loadRoutes() {
  const runtime = 'globalThis[Symbol.for("avtobank.api-test-context")].getStore()';
  const stubs = {
    "cloudflare:workers": `export const env = new Proxy({}, { get: (_, key) => ${runtime}.env[key] });`,
    "next/headers": `export const headers = async () => ${runtime}.headers;`,
    "next/navigation": 'export function redirect() { throw new Error("Unexpected redirect"); }',
  };
  const modules = await Promise.all(Object.entries(files).map(async ([name, entry]) => {
    const result = await build({
      absWorkingDir: fileURLToPath(new URL("../../", import.meta.url)), entryPoints: [entry],
      bundle: true, write: false, platform: "node", format: "esm",
      plugins: [{ name: "local-platform", setup(api) {
        api.onResolve({ filter: /^(cloudflare:workers|next\/headers|next\/navigation)$/ },
          args => ({ path: args.path, namespace: "local-platform" }));
        api.onLoad({ filter: /.*/, namespace: "local-platform" }, args => ({ contents: stubs[args.path] }));
      } }],
    });
    return [name, await import("data:text/javascript;base64," + Buffer.from(result.outputFiles[0].contents).toString("base64"))];
  }));
  return Object.fromEntries(modules);
}

export async function createRuntime({ path = ":memory:" } = {}) {
  let db = new DatabaseSync(path);
  db.exec(await readFile(new URL("../../drizzle/0000_bumpy_reaper.sql", import.meta.url), "utf8"));
  const photos = new Map();
  const env = {
    DB: {
      prepare(query) {
        const statement = db.prepare(query);
        return { bind: (...args) => ({ raw: async () => statement.all(...args).map(row => Object.values(row)) }) };
      },
    },
    BUCKET: {
      put: async (key, data) => photos.set(key, data),
      get: async key => photos.has(key) ? { body: new Uint8Array(photos.get(key)) } : null,
      delete: async keys => { for (const key of keys) photos.delete(key); },
    },
  };

  return {
    env,
    photos,
    as(id, fn) {
      const headers = id ? new Headers({
        "oai-authenticated-user-id": id,
        "oai-authenticated-user-email": id + "@example.test",
      }) : new Headers();
      return context.run({ headers, env }, fn);
    },
    seed(id, raw, revision = 1) { db.prepare("insert into ledgers values (?, ?, ?)").run(id, raw, revision); },
    saved(id) { return db.prepare("select data, revision from ledgers where user_id = ?").get(id); },
    reopen() {
      db.close();
      db = new DatabaseSync(path);
    },
    close() { db.close(); },
  };
}

export function ledgerRequest(ledger, revision, headers = {}) {
  return new Request("https://app.example.test/api/ledger", {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({ ledger, revision }),
  });
}

export const photoBytes = Uint8Array.of(0xff, 0xd8, 0xff, 0xd9);
export const photoContext = id => ({ params: Promise.resolve({ carId: id }) });

export function photoRequest(id, revision, { files = [photoBytes], phase = "before", workId } = {}) {
  const form = new FormData();
  form.set("phase", phase);
  form.set("revision", String(revision));
  if (workId) form.set("workId", workId);
  for (const bytes of files) form.append("photos", new File([bytes], "test.jpg", { type: "image/jpeg" }));
  return new Request("https://app.example.test/api/photos/" + id, { method: "POST", body: form });
}
