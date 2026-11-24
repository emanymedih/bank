"use client";

import { Suspense, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { safeReturnTo } from "../../lib/safe-return-to";

type Mode = "login" | "register" | "reset";
const titles: Record<Mode, string> = { login: "Вход", register: "Регистрация", reset: "Сброс пароля" };

async function post(path: string, body: unknown): Promise<{ ok: boolean; error?: string; devCode?: string }> {
  const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json().catch(() => ({})) as { error?: string; devCode?: string };
  return response.ok ? { ok: true, devCode: data.devCode } : { ok: false, error: data.error ?? "Не получилось. Попробуйте ещё раз." };
}

export default function LoginPage() {
  return <Suspense fallback={<main className="auth-shell"/>}><LoginForm/></Suspense>;
}

function LoginForm() {
  const params = useSearchParams();
  const returnTo = safeReturnTo(params.get("return_to"));
  const [mode, setMode] = useState<Mode>("login");
  const [step, setStep] = useState<"form" | "code">("form");
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch("/api/auth/sessions").then(response => response.ok ? response.json() : null)
      .then(data => { const payload = data as { ok?: boolean; data?: { sessions?: unknown[] } } | null; if (alive && payload?.ok && payload.data?.sessions?.length) window.location.replace(returnTo); })
      .catch(() => { /* анонимный посетитель остаётся на форме */ });
    return () => { alive = false; };
  }, [returnTo]);

  function switchMode(next: Mode) {
    setMode(next); setStep("form"); setError(""); setNotice(""); setCode(""); setPassword("");
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(""); setBusy(true);
    try {
      if (mode === "login") {
        const result = await post("/api/auth/login", { phone, password });
        if (!result.ok) return setError(result.error!);
        window.location.assign(returnTo);
        return;
      }
      if (mode === "register" && step === "form") {
        const result = await post("/api/auth/register", { phone });
        if (!result.ok) return setError(result.error!);
        setStep("code");
        setNotice("Код отправлен на номер " + phone + (result.devCode ? ". В локальной версии код: " + result.devCode : "."));
        return;
      }
      if (mode === "register" && step === "code") {
        const result = await post("/api/auth/verify", { phone, code, password, name });
        if (!result.ok) return setError(result.error!);
        window.location.assign("/");
        return;
      }
      if (mode === "reset" && step === "form") {
        const result = await post("/api/auth/reset", { phone });
        if (!result.ok) return setError(result.error!);
        setStep("code");
        setNotice("Код отправлен на номер " + phone + (result.devCode ? ". В локальной версии код: " + result.devCode : "."));
        return;
      }
      const result = await post("/api/auth/reset-confirm", { phone, code, password });
      if (!result.ok) return setError(result.error!);
      switchMode("login");
      setNotice("Пароль обновлён. Войдите с новым паролем.");
    } finally {
      setBusy(false);
    }
  }

  return <main className="auth-shell">
    <div className="auth-card">
      <img className="auth-logo" src="/avtobank-wordmark.webp" width={584} height={106} alt="Автобанк"/>
      <p className="auth-tagline">Учёт перепродажи автомобилей: касса, доли и прибыль — вместо Excel и чатов.</p>
      <div className="auth-tabs" role="tablist" aria-label="Режим входа" onKeyDown={event => {
        if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
        event.preventDefault();
        switchMode(mode === "login" ? "register" : "login");
      }}>
        {(["login", "register"] as Mode[]).map(item =>
          <button key={item} id={"auth-tab-" + item} role="tab" aria-selected={mode === item} aria-controls="auth-panel"
            tabIndex={mode === item || (mode === "reset" && item === "login") ? 0 : -1} className={mode === item ? "auth-tab current" : "auth-tab"}
            onClick={() => switchMode(item)}>{titles[item]}</button>)}
      </div>
      <div role="tabpanel" id="auth-panel" aria-labelledby={mode === "reset" ? undefined : "auth-tab-" + mode}>
      <form className="auth-form" onSubmit={submit}>
        <label className="field wide">Номер телефона
          <input type="tel" inputMode="tel" autoComplete="tel" placeholder="+7 900 000-00-00" value={phone}
            onChange={event => setPhone(event.target.value)} required/>
        </label>
        {mode === "register" && step === "form" && <label className="field wide">Как к вам обращаться
          <input type="text" autoComplete="name" placeholder="Имя" value={name} maxLength={60}
            onChange={event => setName(event.target.value)} required/>
        </label>}
        {(mode === "login" || (mode === "register" && step === "form") || (mode === "reset" && step === "code")) &&
          <label className="field wide">{mode === "reset" ? "Новый пароль" : "Пароль"}
            <input type="password" autoComplete={mode === "login" ? "current-password" : "new-password"}
              placeholder="Минимум 8 символов" value={password} minLength={8}
              onChange={event => setPassword(event.target.value)} required/>
          </label>}
        {step === "code" && <label className="field wide">Код из SMS
          <input type="text" inputMode="numeric" autoComplete="one-time-code" placeholder="6 цифр" value={code}
            maxLength={6} onChange={event => setCode(event.target.value)} required/>
        </label>}
        {notice && <p className="auth-note" role="status">{notice}</p>}
        {error && <p className="auth-error" role="alert" aria-live="polite">{error}</p>}
        <button className="button primary auth-submit" type="submit" disabled={busy}>
          {busy ? "Подождите…" : mode === "login" ? "Войти"
            : step === "code" ? (mode === "register" ? "Завершить регистрацию" : "Сменить пароль")
            : "Получить код"}
        </button>
        {mode === "login" && <button type="button" className="link-button auth-reset" onClick={() => switchMode("reset")}>Забыли пароль?</button>}
        {mode === "reset" && <button type="button" className="link-button auth-reset" onClick={() => switchMode("login")}>Вернуться ко входу</button>}
      </form>
      </div>
      <p className="auth-footnote">Номер нужен только для входа и приглашений в общие книги. Продолжая, вы соглашаетесь на обработку номера телефона.</p>
    </div>
  </main>;
}