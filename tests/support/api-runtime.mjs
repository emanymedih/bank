import { AsyncLocalStorage } from "node:async_hooks";
import { readdirSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

// Real route handlers and SQL, with local stand-ins for request identity and object storage.
const context = new AsyncLocalStorage();
const runtimeKey = Symbol.for("avtobank.api-test-context");
globalThis[runtimeKey] = context;
process.env.SMS_DEV_MODE ??= "1";
const files = {
  ledger: "app/api/ledger/route.ts",
  photos: "app/api/photos/[carId]/route.ts",
  lookup: "app/api/plate-lookup/route.ts",
  authRegister: "app/api/auth/register/route.ts",
  authVerify: "app/api/auth/verify/route.ts",
  authLogin: "app/api/auth/login/route.ts",
  authLogout: "app/api/auth/logout/route.ts",
  authSessions: "app/api/auth/sessions/route.ts",
  authReset: "app/api/auth/reset/route.ts",
  authResetConfirm: "app/api/auth/reset-confirm/route.ts",
  books: "app/api/books/route.ts",
  booksSelect: "app/api/books/select/route.ts",
  booksMembers: "app/api/books/members/route.ts",
  booksEvents: "app/api/books/events/route.ts",
  invitesAccept: "app/api/invites/accept/route.ts",
};

export async function loadRoutes() {
  const runtime = 'globalThis[Symbol.for("avtobank.api-test-context")].getStore()';
  const stubs = {
    "cloudflare:workers": `export const env = new Proxy({}, { get: (_, key) => ${runtime}.env[key] });`,
    "next/headers": `export const headers = async () => ${runtime}.headers;
export const cookies = async () => ({ get: (name) => {
  const raw = ${runtime}.headers.get("cookie") || "";
  for (const part of raw.split(";")) { const [k, ...v] = part.trim().split("="); if (k === name) return { name, value: v.join("=") }; }
  return undefined;
} });`,
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
  const migrationsDir = new URL("../../drizzle/", import.meta.url);
  for (const name of readdirSync(migrationsDir).filter(file => file.endsWith(".sql")).sort()) {
    db.exec(readFileSync(new URL(name, migrationsDir), "utf8"));
  }
  const photos = new Map();
  const env = {
    SMS_DEV_MODE: "1",
    DB: {
      prepare(query) {
        const statement = db.prepare(query);
        return { bind: (...args) => {
          // Эмуляция лимита Cloudflare D1: не больше 100 параметров на запрос.
          if (args.length > 100) throw new Error("D1 limit: too many SQL parameters (" + args.length + ")");
          return {
          raw: async () => statement.all(...args).map(row => Object.values(row)),
          run: async () => { const result = statement.run(...args); return { meta: { changes: result.changes, last_row_id: Number(result.lastInsertRowid) } }; },
          };
        } };
      },
    },
    BUCKET: {
      put: async (key, data) => photos.set(key, data),
      get: async key => photos.has(key) ? { body: new Uint8Array(photos.get(key)) } : null,
      delete: async keys => { for (const key of keys) photos.delete(key); },
    },
  };

  const phones = new Map();
  const currentBook = new Map();
  function ensure(id) {
    if (!phones.has(id)) {
      const phone = "+79" + String(phones.size).padStart(9, "0");
      phones.set(id, phone);
      db.prepare("insert into users values (?, ?, ?, ?, ?)").run(id, phone, "test-hash", "Тест " + id, "2026-01-01T00:00:00.000Z");
      db.prepare("insert into books values (?, ?, ?, ?)").run("book-" + id, "Книга " + id, id, "2026-01-01T00:00:00.000Z");
      db.prepare("insert into memberships values (?, ?, ?, null)").run("book-" + id, id, "owner");
      db.prepare("insert into sessions values (?, ?, ?, ?, ?)").run("sess-" + id, id, "test", "2026-01-01T00:00:00.000Z", "2099-01-01T00:00:00.000Z");
    }
    return phones.get(id);
  }

  return {
    env,
    photos,
    as(id, fn) {
      if (id) ensure(id);
      const bookId = currentBook.get(id) ?? "book-" + id;
      const headers = id ? new Headers({ cookie: `avto_session=sess-${id}; avto_book=${bookId}` }) : new Headers();
      return context.run({ headers, env }, async () => {
        const result = await fn();
        if (result instanceof Response) {
          const match = (result.headers.get("set-cookie") ?? "").match(/avto_book=([^;]+)/);
          if (match && id) currentBook.set(id, match[1]);
        }
        return result;
      });
    },
    withCookie(cookie, fn) {
      return context.run({ headers: new Headers(cookie ? { cookie } : {}), env }, fn);
    },
    phoneOf(id) { return ensure(id); },
    seed(id, raw, revision = 1) {
      ensure(id);
      db.prepare("insert or replace into ledgers values (?, ?, ?)").run("book-" + id, raw, revision);
    },
    saved(id) { return db.prepare("select data, revision from ledgers where book_id = ?").get("book-" + id); },
    get(sql, ...args) { return db.prepare(sql).get(...args); },
    run(sql, ...args) { return db.prepare(sql).run(...args); },
    reopen() {
      db.close();
      db = new DatabaseSync(path);
    },
    close() { db.close(); },
  };
}

export function ledgerRequest(ledger, revision, headers = {}, clientVersion) {
  return new Request("https://app.example.test/api/ledger", {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({ ledger, revision, clientVersion }),
  });
}

export function jsonRequest(path, body, { method = "POST", cookie } = {}) {
  return new Request("https://app.example.test" + path, {
    method,
    headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export function cookieFrom(response, name) {
  const raw = response.headers.get("set-cookie") ?? "";
  for (const part of raw.split(/,(?=[^ ])/)) {
    const [pair] = part.trim().split(";");
    const [key, ...value] = pair.split("=");
    if (key === name) return value.join("=");
  }
  return null;
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
