import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { sessions } from "../../../../db/schema";
import { getSessionUser } from "../../../auth";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers });

export async function GET() {
  const user = await getSessionUser();
  if (!user) return reply({ error: "Войдите, чтобы открыть кабинет." }, 401);
  const rows = await getDb().select().from(sessions).where(eq(sessions.userId, user.userId));
  return reply({ sessions: rows.map(row => ({ id: row.id, device: row.device, createdAt: row.createdAt })) });
}

export async function DELETE(request: Request) {
  const user = await getSessionUser();
  if (!user) return reply({ error: "Войдите, чтобы открыть кабинет." }, 401);
  if (request.headers.get("sec-fetch-site") === "cross-site") return reply({ error: "Откройте сайт и повторите действие." }, 403);
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return reply({ error: "Укажите сессию." }, 422);
  await getDb().delete(sessions).where(and(eq(sessions.id, id), eq(sessions.userId, user.userId)));
  return reply({ ok: true });
}
