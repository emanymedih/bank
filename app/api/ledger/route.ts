import { getPhotoBucket, hasOnlyStoredPhotos, photoKey, removedPhotos } from "../../../lib/ledger-media";
import { and, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { ledgers } from "../../../db/schema";
import { getChatGPTUser } from "../../chatgpt-auth";
import { emptyLedger, maxLedgerBytes, parseLedger, readStoredLedger } from "../../ledger";

export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "private, no-store" };
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers });
const unreadable = () => reply({ error: "Не удалось прочитать сохранённую книгу учёта." }, 500);

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return reply({ error: "Войдите, чтобы открыть свой учёт." }, 401);
  const db = getDb();
  const [saved] = await db.select().from(ledgers).where(eq(ledgers.userId, user.userId));
  if (!saved) return reply({ ledger: emptyLedger, revision: 0 });
  const ledger = readStoredLedger(saved.data);
  return ledger ? reply({ ledger, revision: saved.revision }) : unreadable();
}

export async function PUT(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return reply({ error: "Сеанс завершён. Войдите снова." }, 401);
  if (request.headers.get("sec-fetch-site") === "cross-site") {
    return reply({ error: "Откройте приложение и повторите действие." }, 403);
  }

  const body = await request.arrayBuffer();
  if (body.byteLength > maxLedgerBytes) return reply({ error: "Превышен размер книги учёта." }, 413);
  let data;
  try { data = JSON.parse(new TextDecoder().decode(body)); }
  catch { return reply({ error: "Данные имеют неверный формат." }, 400); }

  const ledger = parseLedger(data?.ledger);
  if (!Number.isSafeInteger(data?.revision) || data.revision < 0 || !ledger) {
    return reply({ error: "Проверьте даты, суммы и доли участников." }, 422);
  }

  const db = getDb();
  const [previous] = data.revision === 0 ? [] : await db.select().from(ledgers).where(eq(ledgers.userId, user.userId));
  if (previous && previous.revision !== data.revision) {
    return reply({ error: "Книга обновилась в другой вкладке или на другом устройстве.", conflict: true }, 409);
  }
  const previousLedger = previous ? readStoredLedger(previous.data) : undefined;
  if (previousLedger === null) return unreadable();
  if (!hasOnlyStoredPhotos(previousLedger, ledger)) return reply({ error: "Фотографии нужно загрузить через карточку автомобиля." }, 422);

  const revision = data.revision + 1;
  const serialized = JSON.stringify(ledger);
  const changed = data.revision === 0
    ? await db.insert(ledgers).values({ userId: user.userId, data: serialized, revision })
      .onConflictDoNothing().returning({ revision: ledgers.revision })
    : await db.update(ledgers).set({ data: serialized, revision })
      .where(and(eq(ledgers.userId, user.userId), eq(ledgers.revision, data.revision)))
      .returning({ revision: ledgers.revision });

  if (!changed.length) return reply({ error: "Книга обновилась в другой вкладке или на другом устройстве.", conflict: true }, 409);
  if (previousLedger) {
    const keys = removedPhotos(previousLedger, ledger).map(id => photoKey(user.userId, id));
    const bucket = getPhotoBucket();
    if (keys.length && bucket) await bucket.delete(keys).catch(() => {});
  }
  return reply({ revision });
}
