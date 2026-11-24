"use client";

import { useCallback, useEffect, useState } from "react";
import { entityLabels, fieldLabels } from "../lib/ledger-audit";
import type { AuditEntity } from "../lib/ledger-audit";
import type { Partner } from "./ledger";
import { stageNames } from "./ledger";

type AuditEvent = {
  seq: number; at: string; userId: string; userName: string; revision: number;
  entity: AuditEntity; entityId: string; entityName: string; carId: string | null;
  action: "create" | "update" | "delete"; field: string | null; before: unknown; after: unknown;
};

const actionLabels = { create: "добавлено", update: "изменено", delete: "удалено" } as const;
const moneyFields = new Set(["amount", "buy", "price", "askingPrice"]);
const filters: { id: AuditEntity | "all"; label: string }[] = [
  { id: "all", label: "Все" }, { id: "cash", label: "Касса" }, { id: "car", label: "Авто" },
  { id: "expense", label: "Расходы" }, { id: "payout", label: "Выплаты" }, { id: "partner", label: "Партнёры" },
];

const rub = (kopecks: number) => (kopecks / 100).toLocaleString("ru-RU", { maximumFractionDigits: 2 }) + " ₽";

function formatValue(field: string | null, value: unknown, partners: Partner[]): string {
  if (value === null || value === undefined) return "—";
  if (field && moneyFields.has(field) && typeof value === "number") return rub(value);
  if (field === "stage" && typeof value === "string") return stageNames[value as keyof typeof stageNames] ?? value;
  if (field === "payer" && typeof value === "string") return new Map(partners.map(partner => [partner.id, partner.name])).get(value) ?? value;
  if (typeof value === "boolean") return value ? "да" : "нет";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    const names = new Map(partners.map(partner => [partner.id, partner.name]));
    if (field === "shares") return value.map(item => `${names.get((item as { partner: string }).partner) ?? (item as { partner: string }).partner} — ${((item as { weight: number }).weight / 100).toLocaleString("ru-RU")}%`).join(", ");
    if (field === "allocations") return value.map(item => `${names.get((item as { partner: string }).partner) ?? (item as { partner: string }).partner}: ${rub((item as { amount: number }).amount)}`).join(", ");
    return JSON.stringify(value);
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.amount === "number") return `${record.name ? record.name + " · " : ""}${rub(record.amount)}${record.date ? " от " + record.date : ""}`;
    if (typeof record.buy === "number") return `${record.name ?? ""} · покупка ${rub(record.buy)}${record.sold ? `, продажа ${rub(Number(record.price ?? 0))}` : ""}`;
    if (typeof record.name === "string") return record.name;
    return JSON.stringify(value);
  }
  return String(value);
}

function eventLine(event: AuditEvent, partners: Partner[]): string {
  const head = `${entityLabels[event.entity]} «${event.entityName}» — ${actionLabels[event.action]}`;
  if (!event.field) {
    const snapshot = event.action === "delete" ? event.before : event.after;
    const detail = formatValue(null, snapshot, partners);
    return detail && detail !== "—" ? `${head}: ${detail}` : head;
  }
  return `${head} · ${fieldLabels[event.field] ?? event.field}: ${formatValue(event.field, event.before, partners)} → ${formatValue(event.field, event.after, partners)}`;
}

const timeLabel = (iso: string) => new Date(iso).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export function ActivityFeed({ carId, partners = [], onSeen }: {
  carId?: string; partners?: Partner[]; onSeen?: (seq: number) => void;
}) {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [cursor, setCursor] = useState<number | null>(null);
  const [filter, setFilter] = useState<AuditEntity | "all">("all");
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (nextCursor: number | null, append: boolean) => {
    setBusy(true);
    try {
      const params = new URLSearchParams({ limit: "100" });
      if (carId) params.set("carId", carId);
      if (filter !== "all") params.set("entity", filter);
      if (nextCursor) params.set("cursor", String(nextCursor));
      const response = await fetch("/api/books/events?" + params.toString());
      if (!response.ok) { setState("error"); return; }
      const data = await response.json() as { events: AuditEvent[]; nextCursor: number | null };
      setEvents(previous => append ? [...previous, ...data.events] : data.events);
      setCursor(data.nextCursor);
      setState("ready");
      if (!append && !carId && data.events.length && onSeen) onSeen(data.events[0].seq);
    } catch { setState("error"); }
    finally { setBusy(false); }
  }, [carId, filter, onSeen]);

  useEffect(() => { void load(null, false); }, [load]);

  const visible = events;
  const groups: { key: string; userName: string; at: string; items: AuditEvent[] }[] = [];
  for (const event of visible) {
    const last = groups[groups.length - 1];
    if (last && last.key === `${event.revision}|${event.at}|${event.userId}`) last.items.push(event);
    else groups.push({ key: `${event.revision}|${event.at}|${event.userId}`, userName: event.userName, at: event.at, items: [event] });
  }

  return <section className="panel activity-feed" aria-label={carId ? "Правки автомобиля" : "Лента изменений книги"}>
    {!carId && <div className="tabs feed-filters" role="group" aria-label="Фильтр событий">
      {filters.map(item => <button key={item.id} type="button" className={filter === item.id ? "active" : ""}
        aria-pressed={filter === item.id} onClick={() => setFilter(item.id)}>{item.label}</button>)}
    </div>}
    {state === "loading" && <p className="feed-empty" role="status">Загружаем ленту…</p>}
    {state === "error" && <p className="feed-empty" role="alert">Не удалось загрузить ленту. <button className="button secondary" onClick={() => void load(null, false)}>Повторить</button></p>}
    {state === "ready" && !visible.length && <p className="feed-empty">Пока нет изменений. Правки книги появятся здесь с автором и суммами «было/стало».</p>}
    {groups.map(group => <article key={group.key} className="feed-group">
      <header className="feed-group-header"><strong>{group.userName}</strong><span>{timeLabel(group.at)}</span></header>
      <ul className="feed-lines">
        {group.items.map(event => <li key={event.seq}>{eventLine(event, partners)}</li>)}
      </ul>
    </article>)}
    {cursor && <button className="button secondary feed-more" disabled={busy} onClick={() => void load(cursor, true)}>{busy ? "Загружаем…" : "Показать ещё"}</button>}
  </section>;
}