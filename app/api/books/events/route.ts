import { and, desc, eq, lt } from "drizzle-orm";
import { getDb } from "../../../../db";
import { auditEvents } from "../../../../db/schema";
import { getCurrentBook, getSessionUser } from "../../../auth";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers });
const entities = new Set(["car", "expense", "cash", "partner", "payout", "task", "part"]);

function parseJson(value: string | null): unknown {
  if (value === null) return null;
  try { return JSON.parse(value); } catch { return null; }
}

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return reply({ error: "Войдите, чтобы открыть ленту книги." }, 401);
  const book = await getCurrentBook();
  if (!book) return reply({ error: "Книга недоступна." }, 404);
  const params = new URL(request.url).searchParams;
  const carId = params.get("carId");
  const entity = params.get("entity");
  if (entity && !entities.has(entity)) return reply({ error: "Неизвестный тип события." }, 422);
  const limitRaw = params.get("limit");
  const limitNum = limitRaw === null ? 100 : Number(limitRaw);
  if (!Number.isSafeInteger(limitNum) || limitNum < 1) return reply({ error: "Некорректный лимит ленты." }, 400);
  const limit = Math.min(limitNum, 200);
  const cursorRaw = params.get("cursor");
  const cursor = cursorRaw === null ? 0 : Number(cursorRaw);
  if (cursorRaw !== null && (!Number.isSafeInteger(cursor) || cursor < 1)) return reply({ error: "Некорректный курсор ленты." }, 400);
  const conditions = [eq(auditEvents.bookId, book.bookId)];
  if (carId) conditions.push(eq(auditEvents.carId, carId));
  if (entity) conditions.push(eq(auditEvents.entity, entity));
  if (cursor > 0) conditions.push(lt(auditEvents.seq, cursor));
  const rows = await getDb().select().from(auditEvents)
    .where(and(...conditions)).orderBy(desc(auditEvents.seq)).limit(limit);
  return reply({
    events: rows.map(row => ({
      seq: row.seq, at: row.at, userId: row.userId, userName: row.userName, revision: row.revision,
      entity: row.entity, entityId: row.entityId, entityName: row.entityName, carId: row.carId,
      action: row.action, field: row.field, before: parseJson(row.before), after: parseJson(row.after),
    })),
    nextCursor: rows.length === limit ? rows[rows.length - 1].seq : null,
  });
}