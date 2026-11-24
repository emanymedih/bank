"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import { emptyLedger, ledgerClientVersion } from "../ledger";
import type { Ledger } from "../ledger";
import { normalizePlate } from "../../lib/license-plate";

const today = () => new Date().toISOString().slice(0, 10);
const newId = () => crypto.randomUUID();

function parseRubles(value: string): number | null {
  const cleaned = value.replace(/\s|₽|руб\.?/gi, "").replace(",", ".");
  if (!cleaned) return null;
  const amount = Math.round(Number(cleaned) * 100);
  return Number.isFinite(amount) && Number.isSafeInteger(amount) && amount > 0 && amount <= 100_000_000_000 ? amount : null;
}

async function putLedger(ledger: Ledger, revision: number): Promise<{ ok: true; revision: number } | { ok: false; error: string }> {
  const response = await fetch("/api/ledger", { method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ledger, revision, clientVersion: ledgerClientVersion }) });
  const data = await response.json().catch(() => ({})) as { error?: string; revision?: number };
  return response.ok ? { ok: true, revision: data.revision ?? revision } : { ok: false, error: data.error ?? "Не удалось сохранить." };
}

export default function StartPage() {
  const [step, setStep] = useState(1);
  const [title, setTitle] = useState("Моя книга");
  const [bank, setBank] = useState("");
  const [carName, setCarName] = useState("");
  const [plate, setPlate] = useState("");
  const [buyPrice, setBuyPrice] = useState("");
  const [bought, setBought] = useState(today());
  const [revision, setRevision] = useState(0);
  const [bankAdded, setBankAdded] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function createBook(event: FormEvent) {
    event.preventDefault();
    setError(""); setBusy(true);
    try {
      const response = await fetch("/api/books", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title }) });
      const data = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) return setError(data.error ?? "Не удалось создать книгу.");
      setStep(2);
    } finally { setBusy(false); }
  }

  async function addBank(event: FormEvent) {
    event.preventDefault();
    setError("");
    const amount = parseRubles(bank);
    if (!amount) return setError("Введите сумму начального банка, например 500 000.");
    setBusy(true);
    try {
      const ledger: Ledger = { ...emptyLedger, cashEntries: [{ id: newId(), date: today(), name: "Начальный банк", amount, direction: "in" }] };
      const result = await putLedger(ledger, revision);
      if (!result.ok) return setError(result.error);
      setRevision(result.revision); setBankAdded(true); setStep(3);
    } finally { setBusy(false); }
  }

  async function addCar(event: FormEvent) {
    event.preventDefault();
    setError("");
    const buy = parseRubles(buyPrice);
    if (!carName.trim()) return setError("Укажите марку и модель автомобиля.");
    if (!buy) return setError("Введите цену покупки, например 850 000.");
    setBusy(true);
    try {
      const current = await fetch("/api/ledger").then(response => response.json()) as { ledger: Ledger; revision: number };
      const ledger: Ledger = current.ledger;
      const registration = normalizePlate(plate);
      ledger.cars = [...ledger.cars, {
        id: newId(), name: carName.trim(), vin: "", registration: registration || undefined,
        year: null, mileage: null, bought, buy, sold: null, price: null,
        cashPurchase: bankAdded, shares: [{ partner: "self", buy: bankAdded ? buy : 0, weight: 10_000, withdrawn: false }], expenses: [],
      }];
      const result = await putLedger(ledger, current.revision);
      if (!result.ok) return setError(result.error);
      window.location.assign("/");
    } finally { setBusy(false); }
  }

  return <main className="auth-shell">
    <div className="auth-card">
      <h1 className="auth-title">Настроим учёт за три шага</h1>
      <ol className="auth-steps" aria-label="Шаги настройки">
        {["Книга", "Начальный банк", "Первая машина"].map((label, index) =>
          <li key={label} className={step === index + 1 ? "current" : step > index + 1 ? "done" : ""} aria-current={step === index + 1 ? "step" : undefined}>
            <span className="auth-step-num">{index + 1}</span>{label}
          </li>)}
      </ol>

      {step === 1 && <form className="auth-form" onSubmit={createBook}>
        <p className="auth-note">Книга — это общий учёт сделок. Позже можно пригласить партнёров и вести несколько книг.</p>
        <label className="field wide">Название книги
          <input type="text" value={title} maxLength={80} onChange={event => setTitle(event.target.value)} required/>
        </label>
        {error && <p className="auth-error" role="alert">{error}</p>}
        <button className="button primary auth-submit" type="submit" disabled={busy}>{busy ? "Создаём…" : "Создать книгу"}</button>
      </form>}

      {step === 2 && <form className="auth-form" onSubmit={addBank}>
        <p className="auth-note">Сколько денег сейчас в общем банке? Сумму можно пропустить и добавить позже в разделе «Касса».</p>
        <label className="field wide">Начальный банк, ₽
          <input type="text" inputMode="decimal" placeholder="Например, 500 000" value={bank} onChange={event => setBank(event.target.value)}/>
        </label>
        {error && <p className="auth-error" role="alert">{error}</p>}
        <button className="button primary auth-submit" type="submit" disabled={busy}>{busy ? "Сохраняем…" : "Добавить банк"}</button>
        <button className="button secondary auth-submit" type="button" disabled={busy} onClick={() => { setError(""); setStep(3); }}>Пропустить</button>
      </form>}

      {step === 3 && <form className="auth-form" onSubmit={addCar}>
        <p className="auth-note">Первая машина появится в журнале сразу. Госномер поможет позже найти её по фото и документам.</p>
        <label className="field wide">Марка и модель
          <input type="text" placeholder="Например, Kia Rio" value={carName} maxLength={90} onChange={event => setCarName(event.target.value)} required/>
        </label>
        <label className="field wide">Госномер (необязательно)
          <input type="text" placeholder="А123ВС777" value={plate} maxLength={16} onChange={event => setPlate(event.target.value)}/>
        </label>
        <label className="field wide">Цена покупки, ₽
          <input type="text" inputMode="decimal" placeholder="Например, 850 000" value={buyPrice} onChange={event => setBuyPrice(event.target.value)} required/>
        </label>
        <label className="field wide">Дата покупки
          <input type="date" value={bought} max={today()} onChange={event => setBought(event.target.value)} required/>
        </label>
        {error && <p className="auth-error" role="alert">{error}</p>}
        <button className="button primary auth-submit" type="submit" disabled={busy}>{busy ? "Сохраняем…" : "Добавить машину и открыть учёт"}</button>
        <button className="button secondary auth-submit" type="button" disabled={busy} onClick={() => window.location.assign("/")}>Пропустить</button>
      </form>}
    </div>
  </main>;
}