import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { sessions, users } from "../../../../db/schema";
import { consumeOtp, hashPassword, readJson } from "../../../auth";
import { normalizeRussianPhone } from "../../../../lib/phone";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers });

export async function POST(request: Request) {
  if (request.headers.get("sec-fetch-site") === "cross-site") return reply({ error: "Откройте сайт и повторите действие." }, 403);
  const body = await readJson(request);
  const phone = normalizeRussianPhone(body?.phone);
  const password = typeof body?.password === "string" ? body.password : "";
  if (!phone) return reply({ error: "Введите российский мобильный номер." }, 422);
  if (password.length < 8) return reply({ error: "Пароль — минимум 8 символов." }, 422);
  const verified = await consumeOtp(phone, body?.code);
  if ("error" in verified) return reply({ error: verified.error }, verified.status);
  const db = getDb();
  const [user] = await db.select().from(users).where(eq(users.phone, phone));
  if (!user) return reply({ error: "Номер не зарегистрирован." }, 404);
  await db.update(users).set({ passwordHash: hashPassword(password) }).where(eq(users.id, user.id));
  await db.delete(sessions).where(eq(sessions.userId, user.id));
  return reply({ ok: true });
}
