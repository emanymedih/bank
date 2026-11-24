"use client";

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Camera, Check, ChevronRight, ListChecks, ReceiptText, Wrench, X } from "lucide-react";
import { VehicleMark } from "./vehicle-mark";
import { stageNames } from "./ledger";
import type { Car, CarPhoto, Expense, WorkEntry } from "./ledger";

export function useWideInspector() {
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(min-width: 1180px)");
    const update = () => setWide(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return wide;
}

export function DesktopInspector({ identity, inactive, onClose, children }: {
  identity: string; inactive: boolean; onClose: () => void; children: ReactNode;
}) {
  const closeButton = useRef<HTMLButtonElement>(null);
  const region = useRef<HTMLElement>(null);
  useEffect(() => {
    closeButton.current?.focus({ preventScroll: true });
    if (region.current) region.current.scrollTop = 0;
  }, [identity]);

  return <aside className="desktop-inspector" ref={region} aria-label="Карточка автомобиля" onKeyDown={event => {
    if (event.key === "Escape" && !inactive) { event.stopPropagation(); onClose(); }
  }}>
    <header className="dialog-header vehicle-toolbar">
      <span>Карточка автомобиля</span>
      <button ref={closeButton} type="button" className="icon-button" aria-label="Закрыть карточку" onClick={onClose}><X size={21}/></button>
    </header>
    <div className="dialog-content">{children}</div>
  </aside>;
}

export function VehicleCover({ car, source, onHistory }: {
  car: Car; source: (photo: CarPhoto) => string; onHistory: () => void;
}) {
  const before = car.photos?.find(photo => photo.phase === "before");
  const after = car.photos?.find(photo => photo.phase === "after");
  const [selected, setSelected] = useState<"before" | "after">("after");
  const current = selected === "before" ? before ?? after : after ?? before;
  if (!current) return null;
  return <figure className="vehicle-cover">
    <button type="button" className="vehicle-cover-image" onClick={onHistory} aria-label="Открыть историю фотографий">
      <img src={source(current)} alt={current.caption || car.name}/>
    </button>
    <figcaption>
      {before && after ? <div className="cover-toggle" role="group" aria-label="Сравнить фотографии">
        <button aria-pressed={selected === "before"} onClick={() => setSelected("before")}>До</button>
        <button aria-pressed={selected === "after"} onClick={() => setSelected("after")}>После</button>
      </div> : <span>{current.phase === "after" ? "После подготовки" : "При покупке"}</span>}
      <button className="text-button" onClick={onHistory}>Все фотографии</button>
    </figcaption>
  </figure>;
}

type Event =
  | { id: string; type: "purchase" | "sale" | "stage"; date: string; name: string; amount: number | null }
  | { id: string; type: "expense"; date: string; name: string; amount: number; expense: Expense }
  | { id: string; type: "work"; date: string; name: string; amount: number | null; work: WorkEntry; expense?: Expense };

const icons = { sale: Check, stage: ListChecks, expense: ReceiptText, work: Wrench };
const eventLabels = { purchase: "Покупка", sale: "Продажа", stage: "Этап", expense: "Расход", work: "Работа" };

export function vehicleEvents(car: Car): Event[] {
  const items: Event[] = [{ id: "purchase", type: "purchase", date: car.bought, name: "Автомобиль куплен", amount: car.buy }];
  const expenses = new Map(car.expenses.map(expense => [expense.id, expense]));
  const combined = new Set<string>();
  for (const work of car.works ?? []) {
    const expense = work.expenseId ? expenses.get(work.expenseId) : undefined;
    const canCombine = expense && expense.date === work.date && !combined.has(expense.id);
    if (canCombine) combined.add(expense.id);
    items.push({ id: "work:" + work.id, type: "work", date: work.date, name: work.name, amount: canCombine ? expense.amount : null,
      work, expense });
  }
  for (const expense of car.expenses) {
    if (!combined.has(expense.id)) items.push({ id: "expense:" + expense.id, type: "expense", date: expense.date,
      name: expense.name, amount: expense.amount, expense });
  }
  for (const [index, entry] of [...(car.stageHistory ?? [])].reverse().entries()) {
    if (entry.source !== "purchase") items.push({ id: "stage:" + index, type: "stage", date: entry.date,
      name: stageNames[entry.stage], amount: null });
  }
  if (car.sold) items.push({ id: "sale", type: "sale", date: car.sold, name: "Автомобиль продан", amount: car.price });
  return items.sort((a, b) => b.date.localeCompare(a.date) || Number(b.type === "sale") - Number(a.type === "sale") ||
    Number(a.type === "purchase") - Number(b.type === "purchase"));
}

export function VehicleTimeline({ car, dateLabel, rub, onExpense, onWork, onPhotos, onCashPurchase }: {
  car: Car; dateLabel: (date: string) => string; rub: (amount: number) => string;
  onExpense: (id: string) => void; onWork: (id: string) => void; onPhotos: () => void; onCashPurchase?: () => void;
}) {
  const events = vehicleEvents(car);
  return <section className="vehicle-timeline" aria-labelledby="vehicle-timeline-title">
    <h3 id="vehicle-timeline-title">Лента автомобиля</h3>
    <ol>{events.map(event => {
      const Icon = event.type === "purchase" ? null : icons[event.type];
      const photos = event.type === "work" ? car.photos?.filter(photo => photo.workId === event.work.id).length ?? 0 : 0;
      return <li key={event.id}>
        {Icon ? <span className={"timeline-icon event-" + event.type} aria-hidden="true"><Icon size={16}/></span>
          : <VehicleMark name={car.name} className="timeline-icon event-purchase"/>}
        <div className="event-content">
          <small><time dateTime={event.date}>{dateLabel(event.date)}</time> · {eventLabels[event.type]}</small>
          {event.type === "work" ? <button type="button" className="event-name" onClick={() => onWork(event.work.id)}>{event.name}</button>
          : event.type === "expense" ? <button type="button" className="event-name" onClick={() => onExpense(event.expense.id)}>{event.name}</button>
          : <b>{event.name}</b>}
          {event.type === "purchase" && <div className="event-links purchase-event-source">
            <small>{car.cashPurchase ? "Из общей кассы" : "Из личных средств"}</small>
            {onCashPurchase && <button type="button" className="text-button" onClick={onCashPurchase}>Учесть в кассе</button>}
          </div>}
          {event.type === "work" && (event.expense || photos > 0) && <div className="event-links">
            {event.expense && <button type="button" className="text-button" onClick={() => onExpense(event.expense!.id)}>Связанный расход</button>}
            {photos > 0 && <button type="button" className="text-button" onClick={onPhotos}><Camera size={14}/>Фото · {photos}</button>}
          </div>}
        </div>
        {event.amount !== null && <strong className={"event-amount " + (event.type === "sale" ? "positive" : "")}>{rub(event.amount)}</strong>}
        {event.amount === null && event.type === "work" && <ChevronRight size={15} className="muted" aria-hidden="true"/>}
      </li>;
    })}</ol>
  </section>;
}
