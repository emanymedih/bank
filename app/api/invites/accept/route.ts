import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { invites, memberships } from "../../../../db/schema";
import { bookCookie, getSessionUser, isSecureRequest, readJson } from "../../../auth";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
const reply = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  Response.json(body, { status, headers: { ...headers, ...extra } });

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return reply({ error: "Войдите под номером, на который пришло приглашение." }, 401);
  if (request.headers.get("sec-fetch-site") === "cross-site") return reply({ error: "Откройте сайт и повторите действие." }, 403);
  const body = await readJson(request);
  const token = typeof body?.token === "string" ? body.token : "";
  const [invite] = await getDb().select().from(invites).where(eq(invites.token, token));
  if (!invite || invite.acceptedAt || invite.expiresAt <= new Date().toISOString()) {
    return reply({ error: "Приглашение недействительно или уже использовано." }, 404);
  }
  if (invite.phone !== user.phone) return reply({ error: "Приглашение пришло на другой номер. Войдите под ним." }, 403);
  const db = getDb();
  await db.insert(memberships).values({ bookId: invite.bookId, userId: user.userId, role: invite.role })
    .onConflictDoNothing();
  await db.update(invites).set({ acceptedAt: new Date().toISOString() }).where(eq(invites.id, invite.id));
  return reply({ bookId: invite.bookId }, 200, { "Set-Cookie": bookCookie(invite.bookId, isSecureRequest(request)) });
}
