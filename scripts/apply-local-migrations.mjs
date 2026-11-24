// Применяет drizzle/*.sql к локальной D1 (miniflare) из .wrangler/state.
// Запуск: node scripts/apply-local-migrations.mjs (dev-сервер лучше остановить).
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const stateDir = root + ".wrangler/state/v3/d1";
let dirs;
try { dirs = readdirSync(stateDir, { withFileTypes: true }).filter(entry => entry.isDirectory()); }
catch { console.error("Нет локальной D1: сначала запустите npm run dev."); process.exit(1); }

const migrations = readdirSync(root + "drizzle").filter(name => name.endsWith(".sql")).sort();
let applied = 0;
for (const dir of dirs) {
  const files = readdirSync(stateDir + "/" + dir.name).filter(name => name.endsWith(".sqlite"));
  for (const file of files) {
    const db = new DatabaseSync(stateDir + "/" + dir.name + "/" + file);
    const tables = db.prepare("select name from sqlite_master where type = 'table'").all().map(row => row.name);
    if (file === "metadata.sqlite") { db.close(); continue; } // служебная база miniflare
    db.exec("create table if not exists _local_migrations (name text primary key, applied_at text not null)");
    const done = new Set(db.prepare("select name from _local_migrations").all().map(row => row.name));
    for (const name of migrations) {
      if (done.has(name)) continue;
      db.exec(readFileSync(root + "drizzle/" + name, "utf8"));
      db.prepare("insert into _local_migrations values (?, ?)").run(name, new Date().toISOString());
      console.log("применена", name, "к", file);
      applied++;
    }
    db.close();
  }
}
if (!applied) console.error("D1-база не найдена.");