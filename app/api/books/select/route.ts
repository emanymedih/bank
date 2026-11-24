import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getDb } from "../../../../db";
import { memberships } from "../../../../db/schema";
import { bookCookie, getSessionUser, isSecureRequest, readJson } from "../../../auth";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
const reply = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  Response.json(body, { status, headers: { ...headers, ...extra } });

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const bookId = new URL(request.url).searchParams.get("id") ?? "";
  const [membership] = await getDb().select().from(memberships)
    .where(and(eq(memberships.bookId, bookId), eq(memberships.userId, user.userId)));
  if (!membership) redirect("/account");
  return new Response(null, { status: 302, headers: { Location: "/", "Set-Cookie": bookCookie(bookId, isSecureRequest(request)) } });
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return reply({ error: "Войдите, чтобы выбрать книгу." }, 401);
  if (request.headers.get("sec-fetch-site") === "cross-site") return reply({ error: "Откройте сайт и повторите действие." }, 403);
  const body = await readJson(request);
  const bookId = typeof body?.id === "string" ? body.id : typeof body?.bookId === "string" ? body.bookId : "";
  const [membership] = await getDb().select().from(memberships)
    .where(and(eq(memberships.bookId, bookId), eq(memberships.userId, user.userId)));
  if (!membership) return reply({ error: "Эта книга вам недоступна." }, 403);
  return reply({ ok: true }, 200, { "Set-Cookie": bookCookie(bookId, isSecureRequest(request)) });
}
