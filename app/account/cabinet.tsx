"use client";

import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";

type Book = { id: string; title: string; role: "owner" | "editor" | "viewer" };
type Member = { userId: string; name: string; role: string; phone: string };
type Session = { id: string; device: string; createdAt: string };
const roleNames: Record<string, string> = { owner: "Владелец", editor: "Редактор", viewer: "Наблюдатель" };

async function json(path: string, init?: RequestInit): Promise<{ ok: boolean; data: any }> {
  const response = await fetch(path, init);
  const data = await response.json().catch(() => ({}));
  return { ok: response.ok, data };
}

export function Cabinet({ initialName, initialPhone }: { initialName: string; initialPhone: string }) {
  const [books, setBooks] = useState<Book[]>([]);
  const [current, setCurrent] = useState<string | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [removeMember, setRemoveMember] = useState<string | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [invitePhone, setInvitePhone] = useState("");
  const [inviteRole, setInviteRole] = useState<"editor" | "viewer">("editor");
  const [inviteUrl, setInviteUrl] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    const booksResult = await json("/api/books");
    if (!booksResult.ok) { window.location.assign("/login?return_to=%2Faccount"); return; }
    setBooks(booksResult.data.books); setCurrent(booksResult.data.current);
    const sessionsResult = await json("/api/auth/sessions");
    if (sessionsResult.ok) setSessions(sessionsResult.data.sessions);
    if (booksResult.data.current) {
      const membersResult = await json("/api/books/members");
      setMembers(membersResult.ok ? membersResult.data.members : []);
    } else setMembers([]);
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  const currentBook = books.find(book => book.id === current);
  const isOwner = currentBook?.role === "owner";

  async function run(action: () => Promise<{ ok: boolean; data: { error?: string } }>, success?: string) {
    setError(""); setNotice(""); setBusy(true);
    try {
      const result = await action();
      if (!result.ok) setError(result.data.error ?? "Не получилось. Попробуйте ещё раз.");
      else { if (success) setNotice(success); await reload(); }
    } finally { setBusy(false); }
  }

  const post = (path: string, body: unknown) => json(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

  async function switchBook(id: string) {
    await run(() => post("/api/books/select", { id }), "Книга открыта.");
    window.location.assign("/");
  }

  async function invite(event: FormEvent) {
    event.preventDefault();
    setInviteUrl("");
    await run(async () => {
      const result = await post("/api/books/members", { phone: invitePhone, role: inviteRole });
      if (result.ok) setInviteUrl(window.location.origin + result.data.inviteUrl);
      return result;
    }, "Приглашение создано. Отправьте ссылку участнику.");
    setInvitePhone("");
  }

  async function createBook(event: FormEvent) {
    event.preventDefault();
    await run(() => post("/api/books", { title: newTitle }), "Книга создана.");
    setNewTitle("");
  }

  async function logout() {
    await json("/api/auth/logout", { method: "POST" });
    window.location.assign("/login");
  }

  return <main className="auth-shell account-shell">
    <div className="auth-card account-card">
      <header className="account-header">
        <div>
          <h1 className="auth-title">Кабинет</h1>
          <p className="auth-note">{initialName} · {initialPhone}</p>
        </div>
        <div className="account-actions">
          <a className="button secondary" href="/">К учёту</a>
          <button className="button secondary" onClick={logout}>Выйти</button>
        </div>
      </header>

      {notice && <p className="auth-note" role="status">{notice}</p>}
      {error && <p className="auth-error" role="alert">{error}</p>}

      <section className="account-section" aria-label="Книги">
        <h2>Книги</h2>
        <ul className="account-list">
          {books.map(book => <li key={book.id}>
            <span>{book.title} <em className="account-role">{roleNames[book.role]}</em>{book.id === current && <em className="account-role current">открыта</em>}</span>
            {book.id !== current && <button className="button secondary" disabled={busy} onClick={() => switchBook(book.id)}>Открыть</button>}
          </li>)}
        </ul>
        <form className="account-inline" onSubmit={createBook}>
          <label className="field">Новая книга
            <input type="text" placeholder="Название" value={newTitle} maxLength={80} onChange={event => setNewTitle(event.target.value)} required/>
          </label>
          <button className="button secondary" type="submit" disabled={busy}>Создать</button>
        </form>
      </section>

      <section className="account-section" aria-label="Участники">
        <h2>Участники {currentBook ? `книги «${currentBook.title}»` : ""}</h2>
        {!currentBook && <p className="auth-note">Откройте книгу, чтобы управлять участниками.</p>}
        <ul className="account-list">
          {members.map(member => <li key={member.userId}>
            <span>{member.name} · {member.phone} <em className="account-role">{roleNames[member.role] ?? member.role}</em></span>
            {isOwner && member.role !== "owner" && (removeMember === member.userId
              ? <span className="inline-confirm" role="alert">Удалить из книги? Участник потеряет доступ, его доли и история правок сохранятся.
                  <button className="button danger" disabled={busy}
                    onClick={() => { setRemoveMember(null); void run(() => json("/api/books/members?userId=" + encodeURIComponent(member.userId), { method: "DELETE" }), "Участник удалён из книги."); }}>Удалить</button>
                  <button className="button secondary" disabled={busy} onClick={() => setRemoveMember(null)}>Отмена</button>
                </span>
              : <button className="button secondary" disabled={busy} onClick={() => setRemoveMember(member.userId)}>Удалить</button>)}
          </li>)}
        </ul>
        {isOwner && <form className="account-inline" onSubmit={invite}>
          <label className="field">Номер участника
            <input type="tel" placeholder="+7 900 000-00-00" value={invitePhone} onChange={event => setInvitePhone(event.target.value)} required/>
          </label>
          <label className="field">Роль
            <select value={inviteRole} onChange={event => setInviteRole(event.target.value as "editor" | "viewer")}>
              <option value="editor">Редактор — ведёт учёт</option>
              <option value="viewer">Наблюдатель — только смотрит</option>
            </select>
          </label>
          <button className="button primary" type="submit" disabled={busy}>Пригласить</button>
        </form>}
        {inviteUrl && <p className="auth-note invite-link">Ссылка-приглашение: <a href={inviteUrl}>{inviteUrl}</a>
          <button className="button secondary" type="button" onClick={() => { void navigator.clipboard?.writeText(inviteUrl); setNotice("Ссылка скопирована."); }}>Копировать</button>
        </p>}
        {isOwner && <p className="auth-footnote">Участник входит под своим номером и принимает приглашение по ссылке. Партнёры в сделках и участники книги — разные списки: связать их можно в разделе «Мои партнёры».</p>}
      </section>

      <section className="account-section" aria-label="Сеансы">
        <h2>Активные сеансы</h2>
        <ul className="account-list">
          {sessions.map(session => <li key={session.id}>
            <span>{session.device} <em className="account-role">с {new Date(session.createdAt).toLocaleDateString("ru-RU")}</em></span>
            <button className="button secondary" disabled={busy}
              onClick={() => run(() => json("/api/auth/sessions?id=" + encodeURIComponent(session.id), { method: "DELETE" }), "Сеанс завершён.")}>Завершить</button>
          </li>)}
        </ul>
        <p className="auth-footnote">Завершение текущего сеанса выйдет из кабинета на этом устройстве.</p>
      </section>
    </div>
  </main>;
}