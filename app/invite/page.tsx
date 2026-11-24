"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

export default function InvitePage() {
  return <Suspense fallback={<main className="auth-shell"/>}><InviteForm/></Suspense>;
}

function InviteForm() {
  const token = useSearchParams().get("token") ?? "";
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");
  const [error, setError] = useState("");

  async function accept() {
    setState("busy"); setError("");
    const response = await fetch("/api/invites/accept", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) });
    const data = await response.json().catch(() => ({})) as { error?: string };
    if (response.ok) { setState("done"); return; }
    if (response.status === 401) { window.location.assign("/login?return_to=" + encodeURIComponent("/invite?token=" + token)); return; }
    setState("error");
    setError(data.error ?? "Приглашение недействительно.");
  }

  useEffect(() => { if (token) void accept(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return <main className="auth-shell">
    <div className="auth-card">
      <h1 className="auth-title">Приглашение в общую книгу</h1>
      {state === "busy" && <p className="auth-note" role="status">Принимаем приглашение…</p>}
      {state === "done" && <>
        <p className="auth-note" role="status">Готово: книга добавлена в ваш кабинет.</p>
        <a className="button primary auth-submit" href="/">Открыть учёт</a>
      </>}
      {state === "error" && <>
        <p className="auth-error" role="alert">{error}</p>
        <p className="auth-footnote">Если приглашение пришло на другой номер, войдите под ним и откройте ссылку снова.</p>
        <a className="button secondary auth-submit" href="/login">Сменить номер</a>
      </>}
      {!token && <p className="auth-error" role="alert">В ссылке нет кода приглашения. Попросите владельца книги отправить её заново.</p>}
    </div>
  </main>;
}