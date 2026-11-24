import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { users } from "../../../../db/schema";
import { issueOtp, readJson } from "../../../auth";
import { normalizeRussianPhone } from "../../../../lib/phone";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers });

export async function POST(request: Request) {
  if (request.headers.get("sec-fetch-site") === "cross-site") return reply({ error: "Откройте сайт и повторите действие." }, 403);
  const body = await readJson(request);
  const phone = normalizeRussianPhone(body?.phone);
  if (!phone) return reply({ error: "Введите российский мобильный номер в формате +7 9XX XXX-XX-XX." }, 422);
  const [existing] = await getDb().select({ id: users.id }).from(users).where(eq(users.phone, phone));
  if (existing) return reply({ error: "Этот номер уже зарегистрирован. Войдите или восстановите пароль." }, 409);
  const sent = await issueOtp(phone);
  return "error" in sent ? reply({ error: sent.error }, sent.status) : reply({ status: "code_sent" });
}
