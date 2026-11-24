"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Mic, Square } from "lucide-react";
import { buildExpenseBatch, parseExpenseAmount, parseExpenseDictation } from "../lib/expense-dictation";
import type { ExpenseBatchRow } from "../lib/expense-dictation";
import { expenseCategories } from "./ledger";
import type { Car, Expense, Partner } from "./ledger";

type SpeechResult = ArrayLike<{ transcript: string }> & { isFinal: boolean };
type SpeechController = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: { resultIndex: number; results: ArrayLike<SpeechResult> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

const rubles = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 });
const plural = new Intl.PluralRules("ru-RU");
const countLabel = (count: number) => `${count} ${plural.select(count) === "one" ? "расход" : plural.select(count) === "few" ? "расхода" : "расходов"}`;
const fieldErrors = {
  name: "Введите название до 90 знаков.",
  amount: "Введите положительную сумму в рублях с точностью до копеек.",
  date: "Укажите дату расхода. Подходит день покупки или любая дата позже.",
  payer: "Выберите партнёра или общую кассу.",
};

export function BatchExpenseForm({ car, partners, defaultDate, error, busy, onCancel, onSave }: {
  car: Car;
  partners: Partner[];
  defaultDate: string;
  error: string;
  busy: boolean;
  onCancel: () => void;
  onSave: (expenses: Expense[]) => Promise<void>;
}) {
  const [value, setValue] = useState("");
  const [reviewedSource, setReviewedSource] = useState<string | null>(null);
  const [review, setReview] = useState(false);
  const [rows, setRows] = useState<ExpenseBatchRow[]>([]);
  const [inputError, setInputError] = useState("");
  const [reviewError, setReviewError] = useState("");
  const [invalid, setInvalid] = useState<{ rowId: string; field: keyof typeof fieldErrors }>();
  const [voiceStatus, setVoiceStatus] = useState("");
  const [recording, setRecording] = useState<"idle" | "active" | "stopping">("idle");
  const voice = useRef<SpeechController | null>(null);
  const reviewHeading = useRef<HTMLHeadingElement>(null);
  const sourceInput = useRef<HTMLTextAreaElement>(null);
  const saving = useRef(false);
  const helpId = useId();
  const reviewHelpId = useId();
  const included = rows.filter(row => row.included);
  const amounts = included.map(row => parseExpenseAmount(row.amount));
  const total = amounts.every(amount => amount !== null) ? amounts.reduce((sum, amount) => sum + amount, 0) : null;
  const available = 500 - car.expenses.length;
  const overLimit = included.length > available;

  useEffect(() => () => {
    const engine = voice.current;
    if (!engine) return;
    engine.onresult = null;
    engine.onend = null;
    engine.onerror = null;
    engine.abort();
  }, []);

  useEffect(() => {
    if (review) reviewHeading.current?.focus();
    else if (reviewedSource !== null) sourceInput.current?.focus();
  }, [review, reviewedSource]);

  function startVoice() {
    if (voice.current) return;
    const browser = window as Window & {
      SpeechRecognition?: new () => SpeechController;
      webkitSpeechRecognition?: new () => SpeechController;
    };
    const Recognition = browser.SpeechRecognition ?? browser.webkitSpeechRecognition;
    if (!Recognition) {
      setVoiceStatus("В этом браузере можно вставить текст или надиктовать его через клавиатуру телефона.");
      return;
    }
    try {
      const engine = new Recognition();
      let receivedTranscript = false;
      let failed = false;
      engine.lang = "ru-RU";
      engine.continuous = true;
      engine.interimResults = false;
      engine.onresult = event => {
        const text = Array.from(event.results).slice(event.resultIndex).filter(result => result.isFinal)
          .map(result => result[0]?.transcript.trim()).filter(Boolean).join(" ");
        if (!text) return;
        const separator = receivedTranscript ? " " : "\n";
        receivedTranscript = true;
        setValue(current => current.trimEnd() ? current.trimEnd() + separator + text : text);
        setInputError("");
      };
      engine.onerror = event => {
        failed = true;
        setVoiceStatus(event.error === "not-allowed" || event.error === "service-not-allowed"
          ? "Разрешите доступ к микрофону в браузере или введите расходы текстом."
          : "Распознать речь не получилось. Попробуйте ещё раз или введите расходы текстом.");
      };
      engine.onend = () => {
        if (voice.current !== engine) return;
        voice.current = null;
        setRecording("idle");
        if (!failed) setVoiceStatus(receivedTranscript ? "" : "Речь не распознана. Попробуйте ещё раз или введите расходы текстом.");
      };
      voice.current = engine;
      engine.start();
      setRecording("active");
      setVoiceStatus("Слушаю…");
      setInputError("");
    } catch {
      voice.current = null;
      setRecording("idle");
      setVoiceStatus("Диктовка недоступна. Можно ввести расходы с клавиатуры или вставить текст.");
    }
  }

  function stopVoice() {
    const engine = voice.current;
    if (!engine) return;
    try {
      engine.stop();
      setRecording("stopping");
      setVoiceStatus("Завершаю диктовку…");
    } catch {
      voice.current = null;
      setRecording("idle");
      setVoiceStatus("Можно продолжить с клавиатуры или вставить текст.");
      engine.abort();
    }
  }

  function preview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || recording !== "idle") return;
    if (value !== reviewedSource) {
      const date = defaultDate < car.bought ? car.bought : defaultDate;
      const payer = car.cashPurchase ? null : car.shares[0]?.partner ?? null;
      const drafts = parseExpenseDictation(value, partners, payer);
      if (!drafts.length) {
        setInputError("Введите хотя бы один расход.");
        sourceInput.current?.focus();
        return;
      }
      setRows(drafts.map(draft => ({ ...draft, id: crypto.randomUUID(), date, included: true })));
      setReviewedSource(value);
    }
    setReviewError("");
    setInvalid(undefined);
    setReview(true);
  }

  function editRow(id: string, patch: Partial<ExpenseBatchRow>) {
    setRows(current => current.map(row => row.id === id ? { ...row, ...patch } : row));
    if (invalid?.rowId === id && (invalid.field in patch || patch.included === false)) setInvalid(undefined);
    setReviewError("");
  }

  async function confirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || saving.current || overLimit || !included.length) return;
    const result = buildExpenseBatch(rows, car.bought);
    if (!("expenses" in result)) {
      setInvalid(result);
      const field = event.currentTarget.elements.namedItem(`${result.rowId}-${result.field}`);
      if (field instanceof HTMLElement) field.focus();
      return;
    }
    setInvalid(undefined);
    setReviewError("");
    saving.current = true;
    try {
      await onSave(result.expenses);
    } catch {
      setReviewError("Сохранить расходы не получилось. Проверьте связь и попробуйте ещё раз.");
    } finally {
      saving.current = false;
    }
  }

  if (!review) return <form className="batch-expenses" onSubmit={preview}>
    <label className="field">Текст расходов<textarea ref={sourceInput} rows={5} value={value} aria-describedby={helpId}
      placeholder={"Покрасили два крыла, отдали 62 тысячи\nАвито 7 500"} disabled={busy}
      onChange={event => { setValue(event.target.value); setInputError(""); }}/></label>
    <p className="prep-help" id={helpId}>Пишите каждый расход с новой строки. При диктовке скажите «следующий расход» между записями.</p>
    <button type="button" className="button secondary voice-button" disabled={busy || recording === "stopping"}
      onClick={recording === "idle" ? startVoice : stopVoice}>
      {recording === "idle" ? <Mic size={17} aria-hidden="true"/> : <Square size={15} aria-hidden="true"/>}
      {recording === "idle" ? "Начать диктовку" : "Закончить диктовку"}
    </button>
    <p className="prep-help">Для диктовки нужен микрофон. Речь может обрабатывать сервис браузера.</p>
    {voiceStatus && <p className="prep-help" role="status">{voiceStatus}</p>}
    {inputError && <p className="form-error" role="alert">{inputError}</p>}
    <div className="form-footer">
      <button className="button secondary" type="button" onClick={onCancel} disabled={busy}>Отмена</button>
      <button className="button primary" type="submit" disabled={busy || recording !== "idle"}>Проверить расходы</button>
    </div>
  </form>;

  return <form className="batch-expenses" noValidate onSubmit={confirm} aria-describedby={reviewHelpId}>
    <h3 ref={reviewHeading} tabIndex={-1}>Черновик расходов</h3>
    <p className="prep-help" id={reviewHelpId}>Проверьте суммы, даты и плательщиков. В книгу попадут отмеченные расходы.</p>
    {rows.map((row, index) => {
      const invalidField = invalid?.rowId === row.id ? invalid.field : undefined;
      const issue = invalidField ? fieldErrors[invalidField] : "";
      const issueId = `expense-draft-${row.id}-error`;
      const fieldProps = (field: keyof typeof fieldErrors) => ({
        name: `${row.id}-${field}`, disabled: busy || !row.included,
        "aria-invalid": invalidField === field || undefined, "aria-describedby": invalidField === field ? issueId : undefined,
      });
      return <fieldset className="form-shares batch-expense-row" key={row.id}>
        <legend>Расход {index + 1}</legend>
        <p className="prep-help batch-expense-source">{row.source}</p>
        <div className="form-grid">
          <label className="field wide">На что потратили<input value={row.name} maxLength={90} {...fieldProps("name")}
            onChange={event => editRow(row.id, { name: event.target.value })}/></label>
          <label className="field">Сумма, ₽<input inputMode="decimal" value={row.amount} placeholder="Укажите сумму" {...fieldProps("amount")}
            onChange={event => editRow(row.id, { amount: event.target.value })}/></label>
          <label className="field">Дата расхода<input type="date" min={car.bought} value={row.date} {...fieldProps("date")}
            onChange={event => editRow(row.id, { date: event.target.value })}/></label>
          <label className="field">Статья<select value={row.category ?? ""} disabled={busy || !row.included}
            onChange={event => editRow(row.id, { category: expenseCategories.find(category => category === event.target.value) })}>
            <option value="">Без статьи</option>{expenseCategories.map(category => <option key={category}>{category}</option>)}
          </select></label>
          <label className="field">Кто оплатил<select value={row.payer === undefined ? "" : row.payer === null ? "cash" : "partner:" + row.payer}
            {...fieldProps("payer")} onChange={event => {
              const option = event.target.value;
              editRow(row.id, { payer: option === "cash" ? null : option ? option.slice("partner:".length) : undefined });
            }}>
            <option value="" disabled>Выберите плательщика</option><option value="cash">Общая касса</option>
            {partners.map(partner => <option key={partner.id} value={"partner:" + partner.id}>{partner.name}</option>)}
          </select></label>
        </div>
        {issue && <p className="form-error" id={issueId} role="alert">{issue}</p>}
        <label className="payout batch-expense-row-actions"><input type="checkbox" checked={row.included} disabled={busy}
          onChange={event => editRow(row.id, { included: event.target.checked })}/>Сохранить этот расход</label>
      </fieldset>;
    })}
    <p className="part-preview batch-expense-summary">{included.length ? <>
      <b>{countLabel(included.length)} к сохранению</b>{total !== null && <> · {rubles.format(total / 100)} ₽</>}
    </> : "Отметьте расходы для сохранения."}</p>
    {overLimit && <p className="form-error" role="alert">В карточке помещается 500 расходов. Можно добавить ещё {countLabel(available)}.</p>}
    {(reviewError || error) && <p className="form-error" role="alert">{reviewError || error}</p>}
    <div className="form-footer">
      <button className="button secondary" type="button" disabled={busy} onClick={() => setReview(false)}>К тексту</button>
      <button className="button primary" type="submit" disabled={busy || overLimit || !included.length}>
        {busy ? "Сохраняем…" : "Сохранить расходы"}
      </button>
    </div>
  </form>;
}
