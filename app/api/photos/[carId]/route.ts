import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { ledgers } from "../../../../db/schema";
import { getPhotoBucket, photoKey } from "../../../../lib/ledger-media";
import { getCurrentBook, getSessionUser } from "../../../auth";
import { ledgerClientVersion, maxCarPhotos, maxLedgerBytes, maxPhotoBytes, maxPhotosPerUpload, parseLedger, readStoredLedger } from "../../../ledger";
import type { CarPhoto } from "../../../ledger";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ carId: string }> };
const headers = { "Cache-Control": "private, no-store" };
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers });

async function readLedger(bookId: string) {
  const [saved] = await getDb().select().from(ledgers).where(eq(ledgers.bookId, bookId));
  return saved ? { ledger: readStoredLedger(saved.data), revision: saved.revision } : null;
}

export async function GET(request: Request, context: Context) {
  const user = await getSessionUser();
  if (!user) return reply({ error: "Войдите, чтобы открыть фотографии." }, 401);
  const book = await getCurrentBook();
  if (!book) return reply({ error: "Выберите книгу учёта." }, 404);
  const { carId } = await context.params;
  const photoId = new URL(request.url).searchParams.get("id");
  const saved = await readLedger(book.bookId);
  if (saved && !saved.ledger) return reply({ error: "Не удалось прочитать сохранённую книгу учёта." }, 500);
  const photo = saved?.ledger?.cars.find(car => car.id === carId)?.photos?.find(photo => photo.id === photoId);
  if (!photo) return reply({ error: "Фотография не найдена." }, 404);
  const stored = await getPhotoBucket()?.get(photoKey(book.bookId, photo.id));
  if (!stored) return reply({ error: "Файл фотографии недоступен." }, 404);
  return new Response(stored.body, { headers: {
    ...headers, "Content-Type": "image/jpeg", "X-Content-Type-Options": "nosniff",
  } });
}

export async function POST(request: Request, context: Context) {
  const user = await getSessionUser();
  if (!user) return reply({ error: "Войдите, чтобы добавить фотографии." }, 401);
  const book = await getCurrentBook();
  if (!book) return reply({ error: "Выберите книгу учёта." }, 404);
  if (book.role === "viewer") return reply({ error: "Наблюдатель не может загружать фотографии." }, 403);
  if (request.headers.get("sec-fetch-site") === "cross-site") return reply({ error: "Откройте карточку автомобиля." }, 403);
  if (Number(request.headers.get("content-length") ?? "0") > maxPhotosPerUpload * maxPhotoBytes + 64_000) {
    return reply({ error: "Слишком большой объём фотографий для одной загрузки." }, 413);
  }
  const bucket = getPhotoBucket();
  if (!bucket) return reply({ error: "Хранилище фотографий пока недоступно." }, 503);
  const { carId } = await context.params;
  const saved = await readLedger(book.bookId);
  if (saved && !saved.ledger) return reply({ error: "Не удалось прочитать сохранённую книгу учёта." }, 500);
  const car = saved?.ledger?.cars.find(item => item.id === carId);
  if (!saved?.ledger || !car) return reply({ error: "Карточка автомобиля не найдена." }, 404);

  let form: FormData;
  try { form = await request.formData(); }
  catch { return reply({ error: "Форма загрузки имеет неверный формат." }, 400); }
  const revision = Number(form.get("revision"));
  if (revision !== saved.revision) return reply({ error: "Книга обновилась. Повторите загрузку.", conflict: true }, 409);
  const files = form.getAll("photos");
  const phase = form.get("phase");
  const workId = form.get("workId");
  if (phase !== "before" && phase !== "work" && phase !== "after") return reply({ error: "Выберите раздел для фотографий." }, 422);
  if (phase === "work" && !car.works?.some(work => work.id === workId)) return reply({ error: "Работа не найдена." }, 404);
  if (!files.length || files.length > maxPhotosPerUpload || (car.photos?.length ?? 0) + files.length > maxCarPhotos) {
    return reply({ error: "Можно загрузить до 8 фотографий за раз и до 64 на автомобиль." }, 422);
  }

  const pictures: { photo: CarPhoto; file: File }[] = [];
  for (const file of files) {
    if (typeof file === "string" || file.size < 4 || file.size > maxPhotoBytes || file.type !== "image/jpeg") {
      return reply({ error: "Файл должен быть в формате JPEG и помещаться в 1,2 МБ после сжатия." }, 422);
    }
    const signature = new Uint8Array(await file.slice(0, 3).arrayBuffer());
    if (signature[0] !== 0xff || signature[1] !== 0xd8 || signature[2] !== 0xff) return reply({ error: "Файл JPEG повреждён." }, 422);
    pictures.push({ photo: { id: crypto.randomUUID(), phase, workId: phase === "work" ? String(workId) : undefined }, file });
  }

  const next = parseLedger({ ...saved.ledger, cars: saved.ledger.cars.map(item =>
    item.id === carId ? { ...item, photos: [...(item.photos ?? []), ...pictures.map(({ photo }) => photo)] } : item) });
  if (!next) return reply({ error: "Не удалось обновить историю автомобиля." }, 422);
  // The response can become the next whole-book save request.
  const nextBook = { ledger: next, revision: revision + 1 };
  const saveBody = JSON.stringify({ ...nextBook, clientVersion: ledgerClientVersion });
  if (new TextEncoder().encode(saveBody).byteLength > maxLedgerBytes) {
    return reply({ error: "Превышен размер книги учёта." }, 413);
  }
  const data = JSON.stringify(next);
  const keys = pictures.map(({ photo }) => photoKey(book.bookId, photo.id));
  let cleanable = true;
  try {
    for (const [index, { file }] of pictures.entries()) {
      await bucket.put(keys[index], await file.arrayBuffer(), { httpMetadata: { contentType: "image/jpeg" } });
    }
    cleanable = false;
    const updated = await getDb().update(ledgers).set({ data, revision: nextBook.revision })
      .where(and(eq(ledgers.bookId, book.bookId), eq(ledgers.revision, revision))).returning({ revision: ledgers.revision });
    if (!updated.length) {
      cleanable = true;
      return reply({ error: "Книга обновилась. Повторите загрузку.", conflict: true }, 409);
    }
    return reply(nextBook);
  } catch {
    return reply({ error: "Не удалось сохранить фотографии. Попробуйте ещё раз." }, 503);
  } finally {
    if (cleanable) await bucket.delete(keys).catch(() => {});
  }
}
