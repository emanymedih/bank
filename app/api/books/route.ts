import { eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { books, memberships } from "../../../db/schema";
import { bookCookie, getCurrentBook, getSessionUser, isSecureRequest, newId, readJson } from "../../auth";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
const reply = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  Response.json(body, { status, headers: { ...headers, ...extra } });

export async function GET() {
  const user = await getSessionUser();
  if (!user) return reply({ error: "Войдите, чтобы открыть свои книги." }, 401);
  const rows = await getDb().select({ id: books.id, title: books.title, role: memberships.role })
    .from(memberships).innerJoin(books, eq(memberships.bookId, books.id))
    .where(eq(memberships.userId, user.userId));
  const current = await getCurrentBook();
  return reply({ books: rows, current: current?.bookId ?? null, user: { userId: user.userId, name: user.name, phone: user.phone } });
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return reply({ error: "Войдите, чтобы создать книгу." }, 401);
  if (request.headers.get("sec-fetch-site") === "cross-site") return reply({ error: "Откройте сайт и повторите действие." }, 403);
  const body = await readJson(request);
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  if (!title || title.length > 80) return reply({ error: "Название книги — от 1 до 80 символов." }, 422);
  const bookId = newId();
  const db = getDb();
  await db.insert(books).values({ id: bookId, title, ownerId: user.userId, createdAt: new Date().toISOString() });
  await db.insert(memberships).values({ bookId, userId: user.userId, role: "owner" });
  return reply({ book: { id: bookId, title, role: "owner" } }, 200, { "Set-Cookie": bookCookie(bookId, isSecureRequest(request)) });
}
