import { getPhotoBucket, hasOnlyStoredPhotos, photoKey, removedPhotos } from "../../../lib/ledger-media";
import { and, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { ledgers } from "../../../db/schema";
import { getCurrentBook, getSessionUser } from "../../auth";
import { emptyLedger, maxLedgerBytes, parseLedger, readStoredLedger } from "../../ledger";

export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "private, no-store" };
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers });
const unreadable = () => reply({ error: "Не удалось прочитать сохранённую книгу учёта." }, 500);

export async function GET() {
  const user = await getSessionUser();
  if (!user) return reply({ error: "Войдите, чтобы открыть свой учёт." }, 401);
  const book = await getCurrentBook();
  if (!book) return reply({ ledger: emptyLedger, revision: 0 });
  const db = getDb();
  const [saved] = await db.select().from(ledgers).where(eq(ledgers.bookId, book.bookId));
  if (!saved) return reply({ ledger: emptyLedger, revision: 0 });
  const ledger = readStoredLedger(saved.data);
  return ledger ? reply({ ledger, revision: saved.revision }) : unreadable();
}

export async function PUT(request: Request) {
  const user = await getSessionUser();
  if (!user) return reply({ error: "Сеанс завершён. Войдите снова." }, 401);
  const book = await getCurrentBook();
  if (!book) return reply({ error: "Выберите книгу учёта." }, 404);
  if (book.role === "viewer") return reply({ error: "Наблюдатель не может сохранять книгу." }, 403);
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
  const [previous] = data.revision === 0 ? [] : await db.select().from(ledgers).where(eq(ledgers.bookId, book.bookId));
  if (previous && previous.revision !== data.revision) {
    return reply({ error: "Книга обновилась в другой вкладке или на другом устройстве.", conflict: true }, 409);
  }
  const previousLedger = previous ? readStoredLedger(previous.data) : undefined;
  if (previousLedger === null) return unreadable();
  // Older editors cannot round-trip all cash movements, part fields and vehicle records.
  const version = Number.isInteger(data.clientVersion) ? data.clientVersion : 1;
  const losesNewFields = version < 4 && (previousLedger?.cashEntries?.some(entry => entry.allocations?.length)
    || previousLedger?.cars.some(car => car.parts?.some(part => part.plannedPrice || part.expenseId)));
  const losesCarFields = previousLedger?.cars.some(car =>
    (version < 3 && car.cashPurchase && car.shares.some(share => share.buy > 0))
    || (version < 2 && (car.stageHistory?.length || car.shares.some(share => share.payouts?.length))));
  if (losesNewFields || losesCarFields) {
    return reply({ error: "Обновите страницу перед сохранением. В книге есть данные, которые эта вкладка не поддерживает." }, 409);
  }
  if (!hasOnlyStoredPhotos(previousLedger, ledger)) return reply({ error: "Фотографии нужно загрузить через карточку автомобиля." }, 422);

  const revision = data.revision + 1;
  const serialized = JSON.stringify(ledger);
  const changed = data.revision === 0
    ? await db.insert(ledgers).values({ bookId: book.bookId, data: serialized, revision })
      .onConflictDoNothing().returning({ revision: ledgers.revision })
    : await db.update(ledgers).set({ data: serialized, revision })
      .where(and(eq(ledgers.bookId, book.bookId), eq(ledgers.revision, data.revision)))
      .returning({ revision: ledgers.revision });

  if (!changed.length) return reply({ error: "Книга обновилась в другой вкладке или на другом устройстве.", conflict: true }, 409);
  if (previousLedger) {
    const keys = removedPhotos(previousLedger, ledger).map(id => photoKey(book.bookId, id));
    const bucket = getPhotoBucket();
    if (keys.length && bucket) await bucket.delete(keys).catch(() => {});
  }
  return reply({ revision });
}
