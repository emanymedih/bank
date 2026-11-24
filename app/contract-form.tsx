"use client";

import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Download, Printer } from "lucide-react";
import { contractMoney, contractSections, exportSaleDocument, parseTransferDate, vehicleTransferSections } from "./sale-contract";
import type { ContractParty, SaleContract, VehicleTransfer } from "./sale-contract";
import type { Car } from "./ledger";

const docFields = [
  ["type", "Тип ТС"], ["color", "Цвет"], ["body", "Номер кузова"], ["chassis", "Номер шасси"],
  ["engine", "Номер двигателя"], ["pts", "Номер ПТС или ЭПТС"], ["ptsIssuer", "Кем выдан ПТС"],
  ["ptsDate", "Дата выдачи ПТС"], ["sts", "Серия и номер СТС"],
] as const;
const partyFields = [
  ["name", "ФИО", 115], ["passport", "Серия и номер паспорта", 32], ["issued", "Дата выдачи", 10],
  ["issuer", "Кем выдан паспорт", 190], ["address", "Адрес регистрации", 190],
] as const;

type SavedSeller = { party: ContractParty; city: string };
type DocumentView = "form" | "contract" | "transfer-form" | "transfer";

function PartyFields({ role, title, party }: { role: "seller" | "buyer"; title: string; party?: ContractParty }) {
  return <fieldset className="contract-fieldset">
    <legend>{title}</legend>
    <div className="form-grid">{partyFields.map(([field, label, limit]) =>
      <label key={field} className={field === "name" || field === "issuer" || field === "address" ? "field wide" : "field"}>
        {label}<input name={role + "-" + field} type={field === "issued" ? "date" : "text"}
          defaultValue={party?.[field]} maxLength={limit} required autoComplete="off"/>
      </label>)}</div>
  </fieldset>;
}

export function ContractForm({ car, sellerScope, today, busy, onRememberVehicle, onClose }: {
  car: Car; sellerScope?: string; today: string; busy: boolean;
  onRememberVehicle: (vehicle: SaleContract["vehicle"]) => Promise<boolean>; onClose: () => void;
}) {
  const key = sellerScope ? "avtobank-seller:" + sellerScope : undefined;
  const [seller, setSeller] = useState<SavedSeller>();
  const [sellerLoaded, setSellerLoaded] = useState(!key);
  const [draft, setDraft] = useState<SaleContract>();
  const [transfer, setTransfer] = useState<VehicleTransfer>();
  const [view, setView] = useState<DocumentView>("form");
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState("");
  const [vehicleOpen, setVehicleOpen] = useState(false);
  const [remember, setRemember] = useState(false);

  useEffect(() => {
    try {
      const saved = key ? localStorage.getItem(key) : null;
      if (saved) {
        const data = JSON.parse(saved) as SavedSeller;
        if (typeof data.party?.name === "string" && typeof data.city === "string") {
          setSeller(data);
          setRemember(true);
        }
      }
    } catch {}
    setSellerLoaded(true);
  }, [key]);

  async function prepare(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const value = (name: string) => String(form.get(name) ?? "").trim();
    const party = (role: string): ContractParty => ({
      name: value(role + "-name"), passport: value(role + "-passport"), issued: value(role + "-issued"),
      issuer: value(role + "-issuer"), address: value(role + "-address"),
    });
    const sellerParty = party("seller");
    const buyer = party("buyer");
    if ([...Object.values(sellerParty), ...Object.values(buyer)].some(field => !field)) {
      setError("Заполните сведения о продавце и покупателе."); return;
    }
    if (!contractMoney(value("price"))) { setError("Укажите согласованную цену автомобиля."); return; }
    if (!value("city") || !value("payment") || !value("handover")) {
      setError("Укажите место заключения договора и условия оплаты и передачи."); return;
    }
    const documents = Object.fromEntries(docFields.flatMap(([field]) => value(field) ? [[field, value(field)]] : []));
    const vehicle = { name: value("car-name"), vin: value("car-vin"), registration: value("car-plate"),
      year: value("car-year"), mileage: value("car-mileage"), documents };
    if (!vehicle.name || !vehicle.year || (!vehicle.vin && !documents.body && !documents.chassis) || !documents.pts) {
      setVehicleOpen(true); setError("Проверьте марку, год, VIN или номер кузова / шасси и номер ПТС или ЭПТС."); return;
    }
    setPreparing(true);
    setError("");
    try {
      const previousVehicle = { name: car.name, vin: car.vin, registration: car.registration ?? "",
        year: String(car.year ?? ""), mileage: String(car.mileage ?? ""), documents: car.documents ?? {} };
      if (form.has("rememberVehicle") && JSON.stringify(vehicle) !== JSON.stringify(previousVehicle)) {
        if (!await onRememberVehicle(vehicle)) {
          setError("Реквизиты не сохранились в карточке. Попробуйте заново или снимите отметку о сохранении."); return;
        }
      }
      const city = value("city");
      if (key) {
        try {
          if (remember) localStorage.setItem(key, JSON.stringify({ party: sellerParty, city }));
          else localStorage.removeItem(key);
        } catch { setError("Браузер не смог запомнить продавца. Договор готов к печати."); }
      }
      setDraft({
        city, date: value("date"), price: value("price"), payment: value("payment"), handover: value("handover"),
        conditions: value("conditions"), seller: sellerParty, buyer, vehicle,
      });
      setView("contract");
    } finally { setPreparing(false); }
  }

  function show(next: DocumentView) {
    setError("");
    setView(next);
  }

  function prepareTransfer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const value = (name: string) => String(form.get(name) ?? "").trim();
    const place = value("place");
    if (!place) { setError("Укажите место передачи автомобиля."); return; }
    const date = parseTransferDate(value("date"));
    if (!date) { setError("Укажите дату передачи с четырёхзначным годом."); return; }
    setTransfer({
      place, date, mileage: String(Number(value("mileage"))),
      keys: value("keys"), documents: value("documents"), notes: value("notes"),
    });
    show("transfer");
  }

  async function send(content: ReturnType<typeof contractSections>, print: boolean) {
    if (preparing) return;
    const target = print ? window.open("", "_blank") : undefined;
    if (print && !target) { setError("Браузер заблокировал окно печати. Можно скачать PDF и распечатать его."); return; }
    setPreparing(true);
    setError("");
    try { await exportSaleDocument(content, target ?? undefined); }
    catch {
      target?.close();
      setError("Не удалось подготовить документ. Попробуйте скачать PDF ещё раз.");
    } finally { setPreparing(false); }
  }

  if (!sellerLoaded) return <p role="status">Загружаем данные продавца…</p>;
  if (view === "transfer-form") return <form onSubmit={prepareTransfer} autoComplete="off">
    <fieldset className="contract-fieldset">
      <legend>Акт приёма-передачи</legend>
      <div className="form-grid">
        <label className="field">Место передачи<input name="place" maxLength={110} defaultValue={transfer?.place} required/></label>
        <label className="field">Дата передачи<input name="date" type="date" min="0001-01-01" max="9999-12-31"
          defaultValue={transfer?.date} required/></label>
        <label className="field wide">Показание одометра при передаче, км<input name="mileage" type="number" min="0" max="10000000"
          defaultValue={transfer?.mileage} required/></label>
        <label className="field wide">Переданные ключи<input name="keys" maxLength={160} defaultValue={transfer?.keys}/></label>
        <label className="field wide">Переданные документы<input name="documents" maxLength={300} defaultValue={transfer?.documents}/></label>
        <label className="field wide">Замечания при передаче<textarea name="notes" rows={2} maxLength={550} defaultValue={transfer?.notes}/></label>
      </div>
    </fieldset>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="form-footer">
      <button type="button" className="button secondary" onClick={() => show("contract")}>К договору</button>
      <button type="submit" className="button primary">Проверить акт</button>
    </div>
  </form>;
  if (view !== "form" && draft) {
    const isTransfer = view === "transfer";
    const content = isTransfer && transfer ? vehicleTransferSections(draft, transfer) : contractSections(draft);
    return <>
      <article className="contract-preview">
        <h3>{content.heading}</h3><p>{content.where}</p>
        {content.parties.map(person => <section key={person.label}><h4>{person.label} · {person.name}</h4><p>{person.details}</p></section>)}
        {content.paragraphs.map(paragraph => <section key={paragraph.name}><h4>{paragraph.name}</h4><p>{paragraph.text}</p></section>)}
        <div className="contract-signatures">{content.parties.map(person => <div key={person.label}>
          <strong>{person.label}</strong><p>Подпись __________________</p>
        </div>)}</div>
      </article>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="form-footer contract-footer">
        {isTransfer ? <>
          <button type="button" className="button secondary" disabled={preparing} onClick={() => show("contract")}>К договору</button>
          <button type="button" className="button secondary" disabled={preparing} onClick={() => show("transfer-form")}>Редактировать акт</button>
        </> : <>
          <button type="button" className="button secondary" disabled={preparing} onClick={() => show("form")}>Редактировать</button>
          <button type="button" className="button secondary" disabled={preparing} onClick={() => show("transfer-form")}>Подготовить акт</button>
        </>}
        <button type="button" className="button secondary" disabled={preparing} onClick={() => void send(content, false)}><Download size={17}/>Скачать PDF</button>
        <button type="button" className="button primary" disabled={preparing} onClick={() => void send(content, true)}><Printer size={17}/>Печать</button>
      </div>
    </>;
  }

  const vehicle = draft?.vehicle;
  return <form onSubmit={prepare} autoComplete="off">
    <p className="contract-intro">Договор для продажи между физлицами. Сверьте реквизиты с документами перед печатью.</p>
    <div className="form-grid">
      <label className="field">Место заключения<input name="city" maxLength={110} defaultValue={draft?.city ?? seller?.city} placeholder="Город" required/></label>
      <label className="field">Дата договора<input name="date" type="date" defaultValue={draft?.date ?? car.sold ?? today} required/></label>
      <label className="field wide">Согласованная цена, ₽<input name="price" inputMode="decimal" maxLength={20}
        defaultValue={draft?.price ?? (car.price === null ? car.askingPrice ? String(car.askingPrice / 100) : "" : String(car.price / 100))} required/></label>
    </div>
    <details className="form-shares contract-vehicle" open={vehicleOpen} onToggle={event => setVehicleOpen(event.currentTarget.open)}>
      <summary>Реквизиты автомобиля · {car.name}</summary>
      <div className="form-grid">
        <label className="field wide">Марка и модель<input name="car-name" maxLength={90} defaultValue={vehicle?.name ?? car.name}/></label>
        <label className="field">VIN<input name="car-vin" maxLength={32} defaultValue={vehicle?.vin ?? car.vin}/></label>
        <label className="field">Госномер<input name="car-plate" maxLength={20} defaultValue={vehicle?.registration ?? car.registration}/></label>
        <label className="field">Год выпуска<input name="car-year" type="number" min="1880" max="2100" defaultValue={vehicle?.year ?? car.year ?? ""}/></label>
        <label className="field">Пробег, км<input name="car-mileage" type="number" min="0" max="10000000" defaultValue={vehicle?.mileage ?? car.mileage ?? ""}/></label>
        {docFields.map(([field, label]) => <label key={field} className="field">{label}<input name={field}
          type={field === "ptsDate" ? "date" : "text"} maxLength={120} defaultValue={vehicle?.documents[field] ?? car.documents?.[field]}/></label>)}
      </div>
      <label className="option-check"><input type="checkbox" name="rememberVehicle" defaultChecked/>Сохранить реквизиты автомобиля в карточке</label>
    </details>
    <PartyFields role="seller" title="Продавец" party={draft?.seller ?? seller?.party}/>
    {key && <label className="option-check"><input type="checkbox" checked={remember}
      onChange={event => setRemember(event.target.checked)}/>Запомнить продавца на этом устройстве</label>}
    <PartyFields role="buyer" title="Покупатель" party={draft?.buyer}/>
    <p className="contract-intro">Данные покупателя используются только для подготовки договора и акта.</p>
    <fieldset className="contract-fieldset">
      <legend>Оплата и передача</legend>
      <div className="form-grid">
        <label className="field wide">Порядок оплаты<input name="payment" maxLength={240}
          defaultValue={draft?.payment ?? "Полная оплата в день подписания договора"} required/></label>
        <label className="field wide">Срок и порядок передачи<input name="handover" maxLength={240}
          defaultValue={draft?.handover ?? "В день подписания договора после оплаты"} required/></label>
        <label className="field wide">Состояние и особые условия<textarea name="conditions" rows={2} maxLength={550}
          defaultValue={draft?.conditions} placeholder="Известные недостатки, согласованные права третьих лиц и другие условия"/></label>
      </div>
    </fieldset>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="form-footer">
      <button type="button" className="button secondary" disabled={busy || preparing} onClick={onClose}>Закрыть</button>
      <button type="submit" className="button primary" disabled={busy || preparing}>{preparing ? "Подготавливаем…" : "Проверить договор"}</button>
    </div>
  </form>;
}
