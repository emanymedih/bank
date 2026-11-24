import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { books, invites, memberships, users } from "../../../../db/schema";
import { getCurrentBook, getSessionUser, newId, readJson } from "../../../auth";
import { maskPhone, normalizeRussianPhone } from "../../../../lib/phone";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers });
const roles = new Set(["editor", "viewer"]);

export async function GET() {
  const access = await getCurrentBook();
  const user = await getSessionUser();
  if (!user || !access) return reply({ error: "Книга недоступна." }, 403);
  const rows = await getDb().select({ userId: memberships.userId, role: memberships.role, name: users.name, phone: users.phone })
    .from(memberships).innerJoin(users, eq(memberships.userId, users.id))
    .where(eq(memberships.bookId, access.bookId));
  return reply({ members: rows.map(row => ({
    userId: row.userId, name: row.name, role: row.role,
    phone: row.userId === user.userId ? row.phone : maskPhone(row.phone),
  })) });
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  const access = await getCurrentBook();
  if (!user || !access) return reply({ error: "Книга недоступна." }, 403);
  if (access.role !== "owner") return reply({ error: "Приглашать участников может только владелец книги." }, 403);
  if (request.headers.get("sec-fetch-site") === "cross-site") return reply({ error: "Откройте сайт и повторите действие." }, 403);
  const body = await readJson(request);
  const phone = normalizeRussianPhone(body?.phone);
  const role = typeof body?.role === "string" && roles.has(body.role) ? body.role : null;
  if (!phone) return reply({ error: "Введите российский мобильный номер участника." }, 422);
  if (!role) return reply({ error: "Выберите роль: редактор или наблюдатель." }, 422);
  const [existing] = await getDb().select().from(memberships)
    .innerJoin(users, eq(memberships.userId, users.id))
    .where(and(eq(memberships.bookId, access.bookId), eq(users.phone, phone)));
  if (existing) return reply({ error: "Этот номер уже участник книги." }, 409);
  const token = newId();
  await getDb().insert(invites).values({
    id: newId(), bookId: access.bookId, phone, role, token,
    expiresAt: new Date(Date.now() + 7 * 86400_000).toISOString(),
  });
  return reply({ token, inviteUrl: "/invite?token=" + token });
}

export async function DELETE(request: Request) {
  const user = await getSessionUser();
  const access = await getCurrentBook();
  if (!user || !access) return reply({ error: "Книга недоступна." }, 403);
  if (access.role !== "owner") return reply({ error: "Управлять участниками может только владелец книги." }, 403);
  if (request.headers.get("sec-fetch-site") === "cross-site") return reply({ error: "Откройте сайт и повторите действие." }, 403);
  const userId = new URL(request.url).searchParams.get("userId");
  if (!userId || userId === user.userId) return reply({ error: "Нельзя удалить самого себя из книги." }, 422);
  const [book] = await getDb().select().from(books).where(eq(books.id, access.bookId));
  if (book?.ownerId === userId) return reply({ error: "Владельца книги удалить нельзя." }, 422);
  await getDb().delete(memberships).where(and(eq(memberships.bookId, access.bookId), eq(memberships.userId, userId)));
  return reply({ ok: true });
}
