import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { users } from "../../../../db/schema";
import { clientIp, issueOtp, rateLimit, readJson } from "../../../auth";
import { normalizeRussianPhone } from "../../../../lib/phone";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers });

export async function POST(request: Request) {
  if (request.headers.get("sec-fetch-site") === "cross-site") return reply({ error: "Откройте сайт и повторите действие." }, 403);
  const body = await readJson(request);
  const phone = normalizeRussianPhone(body?.phone);
  if (!phone) return reply({ error: "Введите российский мобильный номер." }, 422);
  if (!await rateLimit("otp:" + clientIp(request), 10, 60 * 60_000)) return reply({ error: "Слишком много кодов. Подождите час." }, 429);
  const [existing] = await getDb().select({ id: users.id }).from(users).where(eq(users.phone, phone));
  // Не раскрываем, зарегистрирован ли номер; код уходит только существующему пользователю.
  if (existing) {
    const sent = await issueOtp(phone);
    if ("error" in sent) return reply({ error: sent.error }, sent.status);
  }
  return reply({ status: "code_sent" });
}
