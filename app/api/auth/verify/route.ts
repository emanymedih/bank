import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { users } from "../../../../db/schema";
import { consumeOtp, createSession, clientDevice, clientIp, hashPassword, isSecureRequest, newId, rateLimit, readJson, sessionCookie } from "../../../auth";
import { normalizeRussianPhone } from "../../../../lib/phone";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
const reply = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  Response.json(body, { status, headers: { ...headers, ...extra } });

export async function POST(request: Request) {
  if (request.headers.get("sec-fetch-site") === "cross-site") return reply({ error: "Откройте сайт и повторите действие." }, 403);
  const body = await readJson(request);
  const phone = normalizeRussianPhone(body?.phone);
  if (!phone) return reply({ error: "Введите российский мобильный номер." }, 422);
  const password = typeof body?.password === "string" ? body.password : "";
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (password.length < 8) return reply({ error: "Пароль — минимум 8 символов." }, 422);
  if (!name || name.length > 60) return reply({ error: "Укажите имя (до 60 символов)." }, 422);
  if (!await rateLimit("verify:" + clientIp(request), 30, 60 * 60_000)) return reply({ error: "Слишком много попыток. Подождите час." }, 429);
  const verified = await consumeOtp(phone, body?.code);
  if ("error" in verified) return reply({ error: verified.error }, verified.status);
  const db = getDb();
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.phone, phone));
  if (existing) return reply({ error: "Этот номер уже зарегистрирован. Войдите." }, 409);
  const userId = newId();
  await db.insert(users).values({ id: userId, phone, passwordHash: hashPassword(password), name, createdAt: new Date().toISOString() });
  const token = await createSession(userId, clientDevice(request));
  return reply({ user: { userId, phone, name } }, 200, { "Set-Cookie": sessionCookie(token, isSecureRequest(request)) });
}
