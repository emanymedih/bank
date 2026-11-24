import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { users } from "../../../../db/schema";
import { createSession, clientDevice, clientIp, isSecureRequest, rateLimit, readJson, sessionCookie, verifyPassword } from "../../../auth";
import { normalizeRussianPhone } from "../../../../lib/phone";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
const reply = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  Response.json(body, { status, headers: { ...headers, ...extra } });

export async function POST(request: Request) {
  if (request.headers.get("sec-fetch-site") === "cross-site") return reply({ error: "Откройте сайт и повторите действие." }, 403);
  const body = await readJson(request);
  const phone = normalizeRussianPhone(body?.phone);
  const password = typeof body?.password === "string" ? body.password : "";
  if (!phone || !password) return reply({ error: "Введите номер телефона и пароль." }, 422);
  if (!await rateLimit("login:" + clientIp(request), 20, 15 * 60_000)) {
    return reply({ error: "Слишком много попыток входа. Подождите 15 минут." }, 429);
  }
  const [user] = await getDb().select().from(users).where(eq(users.phone, phone));
  if (!user || !verifyPassword(password, user.passwordHash)) {
    return reply({ error: "Неверный номер или пароль." }, 401);
  }
  const token = await createSession(user.id, clientDevice(request));
  return reply({ user: { userId: user.id, phone: user.phone, name: user.name } }, 200, { "Set-Cookie": sessionCookie(token, isSecureRequest(request)) });
}
