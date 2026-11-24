import { dropCurrentSession, expiredSessionCookie, isSecureRequest } from "../../../auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (request.headers.get("sec-fetch-site") === "cross-site") return Response.json({ error: "Откройте сайт и повторите действие." }, { status: 403 });
  await dropCurrentSession();
  return Response.json({ ok: true }, { headers: { "Cache-Control": "private, no-store", "Set-Cookie": expiredSessionCookie(isSecureRequest(request)) } });
}
