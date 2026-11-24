import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "../db";
import { memberships, otpChallenges, rateLimits, sessions, users } from "../db/schema";
import { hashCode, hashPassword, verifyPassword } from "../lib/password";

export { hashCode, hashPassword, verifyPassword };

export type SessionUser = { userId: string; phone: string; name: string };
export type BookRole = "owner" | "editor" | "viewer";
const roleRank: Record<BookRole, number> = { viewer: 0, editor: 1, owner: 2 };

export const SESSION_COOKIE = "avto_session";
export const BOOK_COOKIE = "avto_book";
const SESSION_DAYS = 30;
const OTP_TTL_MS = 5 * 60_000;
const OTP_RESEND_MS = 60_000;
const OTP_MAX_ATTEMPTS = 5;

export function sessionCookie(token: string, secure: boolean, maxAgeSeconds = SESSION_DAYS * 86400): string {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure ? "; Secure" : ""}`;
}

export function expiredSessionCookie(secure: boolean): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`;
}

export function bookCookie(bookId: string, secure: boolean): string {
  return `${BOOK_COOKIE}=${encodeURIComponent(bookId)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure ? "; Secure" : ""}`;
}

export const isSecureRequest = (request: Request) => new URL(request.url).protocol === "https:";
export const humanizeDevice = (ua: string) => {
  if (!ua) return "Неизвестное устройство";
  if (!ua.startsWith("Mozilla/")) return ua;
  const browser = /Edg\//.test(ua) ? "Edge" : /OPR\/|Opera/.test(ua) ? "Opera" : /Firefox\//.test(ua) ? "Firefox"
    : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Браузер";
  const os = /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS"
    : /Mac OS/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "";
  return os ? browser + " на " + os : browser;
};
export const clientDevice = (request: Request) => humanizeDevice(request.headers.get("user-agent") ?? "");

async function cookieValue(name: string): Promise<string | null> {
  const jar = await cookies();
  return jar.get(name)?.value ?? null;
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const token = await cookieValue(SESSION_COOKIE);
  if (!token) return null;
  const [row] = await getDb().select({
    userId: sessions.userId, expiresAt: sessions.expiresAt, phone: users.phone, name: users.name,
  }).from(sessions).innerJoin(users, eq(sessions.userId, users.id)).where(eq(sessions.id, token));
  if (!row || row.expiresAt <= new Date().toISOString()) return null;
  return { userId: row.userId, phone: row.phone, name: row.name };
}

export async function requireUser(returnTo: string): Promise<SessionUser> {
  const user = await getSessionUser();
  if (user) return user;
  redirect("/login?return_to=" + encodeURIComponent(returnTo));
}

export async function createSession(userId: string, device: string): Promise<string> {
  const token = randomBytes(32).toString("hex");
  const now = Date.now();
  await getDb().insert(sessions).values({
    id: token, userId, device, createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + SESSION_DAYS * 86400_000).toISOString(),
  });
  return token;
}

export async function dropCurrentSession(): Promise<void> {
  const token = await cookieValue(SESSION_COOKIE);
  if (token) await getDb().delete(sessions).where(eq(sessions.id, token));
}

export async function getCurrentBook(): Promise<{ bookId: string; role: BookRole } | null> {
  const user = await getSessionUser();
  const bookId = await cookieValue(BOOK_COOKIE);
  if (!user || !bookId) return null;
  const [membership] = await getDb().select().from(memberships)
    .where(and(eq(memberships.bookId, bookId), eq(memberships.userId, user.userId)));
  return membership ? { bookId, role: membership.role as BookRole } : null;
}

export async function requireBook(minRole: BookRole = "viewer"): Promise<{ user: SessionUser; bookId: string; role: BookRole } | null> {
  const user = await getSessionUser();
  if (!user) return null;
  const book = await getCurrentBook();
  if (!book || roleRank[book.role] < roleRank[minRole]) return null;
  return { user, ...book };
}

export async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const value = await request.json();
    return value && typeof value === "object" ? value as Record<string, unknown> : null;
  } catch { return null; }
}

// SMS-провайдер — абстракция: в dev-режиме код фиксирован и логируется, боевой шлюз подключается позже.
async function sendCode(phone: string, code: string): Promise<void> {
  console.log(`[sms] код для ${phone}: ${code}`);
}

export async function issueOtp(phone: string): Promise<{ ok: true; devCode?: string } | { error: string; status: number }> {
  const db = getDb();
  const now = Date.now();
  const [existing] = await db.select().from(otpChallenges).where(eq(otpChallenges.phone, phone));
  if (existing && now - Date.parse(existing.lastSentAt) < OTP_RESEND_MS) {
    return { error: "Код уже отправлен. Повторить можно через минуту.", status: 429 };
  }
  const dev = process.env.SMS_DEV_MODE === "1";
  const code = dev ? "123456" : String(randomBytes(4).readUInt32BE(0) % 1_000_000).padStart(6, "0");
  await sendCode(phone, code);
  const row = { phone, codeHash: hashCode(phone + ":" + code), expiresAt: new Date(now + OTP_TTL_MS).toISOString(), attempts: 0, lastSentAt: new Date(now).toISOString() };
  if (existing) await db.update(otpChallenges).set(row).where(eq(otpChallenges.phone, phone));
  else await db.insert(otpChallenges).values(row);
  return { ok: true, devCode: dev ? code : undefined };
}

export async function consumeOtp(phone: string, code: unknown): Promise<{ ok: true } | { error: string; status: number }> {
  const db = getDb();
  const [challenge] = await db.select().from(otpChallenges).where(eq(otpChallenges.phone, phone));
  if (!challenge || challenge.expiresAt <= new Date().toISOString()) return { error: "Код устарел. Запросите новый.", status: 401 };
  if (challenge.attempts >= OTP_MAX_ATTEMPTS) return { error: "Слишком много попыток. Запросите новый код.", status: 429 };
  if (typeof code !== "string" || hashCode(phone + ":" + code) !== challenge.codeHash) {
    await db.update(otpChallenges).set({ attempts: challenge.attempts + 1 }).where(eq(otpChallenges.phone, phone));
    return { error: "Неверный код из SMS.", status: 401 };
  }
  await db.delete(otpChallenges).where(eq(otpChallenges.phone, phone));
  return { ok: true };
}

export const newId = () => randomUUID();

// Публичный идентификатор сеанса: сам токен cookie наружу не отдаём.
export const publicSessionId = (token: string) => createHash("sha256").update(token).digest("hex").slice(0, 32);

export const clientIp = (request: Request) =>
  request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "local";

// Скользящее окно: true — запрос разрешён, false — лимит исчерпан.
export async function rateLimit(key: string, limit: number, windowMs: number): Promise<boolean> {
  const db = getDb();
  const now = Date.now();
  const [row] = await db.select().from(rateLimits).where(eq(rateLimits.key, key));
  if (!row || now - Date.parse(row.windowStart) >= windowMs) {
    const fresh = { hits: 1, windowStart: new Date(now).toISOString() };
    if (row) await db.update(rateLimits).set(fresh).where(eq(rateLimits.key, key));
    else await db.insert(rateLimits).values({ key, ...fresh });
    return true;
  }
  if (row.hits >= limit) return false;
  await db.update(rateLimits).set({ hits: row.hits + 1 }).where(eq(rateLimits.key, key));
  return true;
}
