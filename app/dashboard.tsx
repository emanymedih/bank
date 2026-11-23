"use client";

import { useEffect, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import {
  ArrowDown, ArrowDownLeft, ArrowUp, ArrowUpRight, Banknote, BarChart3, CarFront, Check, ChevronDown,
  CircleDollarSign, ClipboardList, Download, Ellipsis, FileText, Gauge, LayoutDashboard, Pencil, Plus,
  Search, Settings2, TrendingUp, Trash2, UsersRound, Wallet, X, Mic,
} from "lucide-react";
import { cashSummary, defaultWeights, emptyLedger, expenseCategories, figures, initialLedger, maxCarPhotos, splitAmount, stageNames, totals, validLedger, vehicleStage, vehicleStages } from "./ledger";
import { Analytics, CashJournal } from "./insights";
import { parsePartList, PartPlan, preparePhotos, WorkHistory } from "./car-prep";
import { downloadBuyerReport } from "./car-report";
import { PlatePhoto } from "./plate-photo";
import { ContractForm } from "./contract-form";
import { formatRussianPlate, normalizePlate, plateKey } from "../lib/license-plate";
import type { PlateDetails } from "../lib/license-plate";
import type { Car, CarPart, CarPhoto, CashEntry, Expense, Ledger, Partner, PhotoPhase, VehicleStage, WorkEntry } from "./ledger";

type Filter = "all" | "active" | VehicleStage;
const boardStages = [...vehicleStages, "sold"] as const;
const sectionNames = { cars: "Автомобили", partners: "Партнёры", analytics: "Аналитика", cash: "Касса" };
type View = keyof typeof sectionNames;
const carTabs = { summary: "Сделка и расходы", history: "Работы и фото", parts: "Запчасти" };
type CarTab = keyof typeof carTabs;
type Dialog =
  | { type: "car"; id?: string }
  | { type: "expense"; id: string; expense?: string; partId?: string }
  | { type: "work"; id: string; workId?: string }
  | { type: "part"; id: string; partId?: string }
  | { type: "part-list"; id: string }
  | { type: "photo"; id: string; photoId: string }
  | { type: "report"; id: string }
  | { type: "sale"; id: string }
  | { type: "contract"; id: string }
  | { type: "progress"; id: string }
  | { type: "payout"; id: string; partnerId: string }
  | { type: "cash"; id?: string }
  | { type: "partner"; id?: string }
  | { type: "confirm"; title: string; message: string; action: () => Promise<boolean>; label: string };

const format = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 });
const dateFormat = new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
const rub = (value: number) => format.format(value / 100) + " ₽";
const dateLabel = (value: string) => dateFormat.format(new Date(value)).replace(/\sг\.$/, "").replace(/\.(?=\s)/g, "");
const today = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Moscow" }).format();
const short = (person: Partner) => /\d$/.test(person.name) ? person.name : person.name.split(/\s+/)[0];
const initials = (person: Partner) => person.name.split(/\s+/).map(part => part[0]).slice(0, 2).join("").toUpperCase();
const personBy = (ledger: Ledger, id: string) => ledger.partners.find(p => p.id === id);
const moneyText = (value: number) => String(value / 100).replace(".", ",");
const range = (n: number, low: number, high: number) => Number.isFinite(n) && n >= low && n <= high;

function parseMoney(input: FormDataEntryValue | null) {
  const value = String(input ?? "").replace(/\s/g, "").replace(",", ".");
  return /^\d+(?:\.\d{1,2})?$/.test(value) ? Math.round(Number(value) * 100) : NaN;
}

function exportLedger(ledger: Ledger) {
  const summary = totals(ledger);
  const columns = ["Автомобиль", "Год выпуска", "Госномер", "VIN", "Пробег", "Дата покупки", "Дата продажи", "Покупка, ₽", "Расходы, ₽", "Продажа, ₽", "Чистая прибыль, ₽",
    ...ledger.partners.flatMap(p => [p.name + " — забрал прибыль", p.name + " — накопления, ₽"]), "Накопленная прибыль, ₽"];
  const rows = ledger.cars.map(c => {
    const deal = figures(c);
    const balance = summary.timeline.get(c.id);
    return [c.name, c.year ?? "", c.registration ?? "", c.vin, c.mileage ?? "", c.bought, c.sold ?? "", moneyText(c.buy), moneyText(deal.expenses),
      c.price === null ? "" : moneyText(c.price), deal.net === null ? "" : moneyText(deal.net),
      ...ledger.partners.flatMap(p => {
        const share = deal.people[p.id];
        return [c.sold && share?.profit > 0 ? share.withdrawn ? "Да" : "Нет" : "", balance ? moneyText(balance.people[p.id]) : ""];
      }), balance ? moneyText(balance.bank) : ""];
  });
  const csv = [columns, ...rows].map(row => row.map(cell => {
    const value = String(cell);
    const escaped = /^[=+@\-\t\r]/.test(value) && !/^-\d+(,\d+)?$/.test(value) ? "'" + value : value;
    return '"' + escaped.replaceAll('"', '""') + '"';
  }).join(";")).join("\r\n");
  const url = URL.createObjectURL(new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "avtobank.csv";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function Dashboard({ signedIn, signInUrl, sellerScope }: { signedIn: boolean; signInUrl: string; sellerScope?: string }) {
  const [ledger, setLedger] = useState(signedIn ? emptyLedger : initialLedger);
  const [revision, setRevision] = useState(0);
  const [loaded, setLoaded] = useState(!signedIn);
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<View>("cars");
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState("recent");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [carTab, setCarTab] = useState<CarTab>("summary");
  const demoPhotoUrls = useRef(new Map<string, string>());
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [actions, setActions] = useState(false);
  const writeLock = useRef(false);
  const selectedCar = ledger.cars.find(c => c.id === selected);
  const summary = totals(ledger);
  const demo = ledger.cars.some(c => c.demo);
  const currentDate = today();
  const cash = cashSummary(ledger, currentDate);
  const stages = { purchased: 0, preparation: 0, listed: 0, sold: 0 };
  for (const car of ledger.cars) stages[vehicleStage(car)]++;
  const overdue = ledger.cars.filter(car => !car.sold && car.nextAction?.due && car.nextAction.due < currentDate).length;
  const carName = selectedCar?.name;
  const photoSource = (photo: CarPhoto) => demoPhotoUrls.current.get(photo.id) ??
    "/api/photos/" + encodeURIComponent(selectedCar?.id ?? "") + "?id=" + encodeURIComponent(photo.id);

  async function load() {
    try {
      const response = await fetch("/api/ledger", { cache: "no-store" });
      if (!response.ok) throw Error("Книга не загрузилась. Попробуйте ещё раз.");
      const data = await response.json() as { ledger: Ledger; revision: number };
      setLedger(data.ledger);
      setRevision(data.revision);
      setLoaded(true);
      setLoadError("");
    } catch (failure) {
      setLoadError(failure instanceof Error ? failure.message : "Не удалось загрузить книгу.");
    }
  }

  useEffect(() => { if (signedIn) void load(); }, [signedIn]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 3300);
    return () => clearTimeout(timer);
  }, [toast]);

  const open = (next: Dialog | null) => { setError(""); setActions(false); setDialog(next); };
  const select = (id: string | null) => { setSelected(id); setCarTab("summary"); setError(""); setActions(false); };
  const changeView = (next: View) => { setView(next); select(null); };
  const requireSignIn = () => window.top?.location.assign(signInUrl);

  async function save(next: Ledger, message: string) {
    if (writeLock.current || !loaded) return false;
    if (!validLedger(next)) { setError("Проверьте даты, суммы и доли участников."); return false; }
    if (signedIn) {
      writeLock.current = true;
      setBusy(true);
      try {
        const response = await fetch("/api/ledger", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ revision, ledger: next }),
        });
        const result = await response.json() as { revision: number; conflict?: boolean; error?: string };
        if (!response.ok) {
          if (result.conflict) {
            await load();
            open(null);
            setToast("Книга обновилась. Откройте запись заново.");
            return false;
          }
          throw Error(result.error ?? "Сохранение не удалось. Попробуйте ещё раз.");
        }
        setRevision(result.revision);
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : "Сохранение не удалось.");
        return false;
      } finally {
        writeLock.current = false;
        setBusy(false);
      }
    }
    setLedger(next);
    setError("");
    setToast(message);
    return true;
  }

  async function saveCar(car: Car, message: string) {
    const current = ledger.cars.find(c => c.id === car.id);
    if (current) {
      const before = figures(current).people;
      const after = figures(car).people;
      const adjusted = Object.keys(before).some(id =>
        before[id].withdrawn && after[id]?.withdrawn && before[id].profit !== after[id].profit);
      if (adjusted) {
        setError("Сначала отмените отметки о выплатах, суммы которых изменятся.");
        return false;
      }
    }
    const cars = current ? ledger.cars.map(c => c.id === car.id ? car : c) : [car, ...ledger.cars];
    return save({ ...ledger, cars }, message);
  }

  async function uploadPhotos(car: Car, phase: PhotoPhase, files: File[], workId?: string) {
    if (writeLock.current) return;
    if ((car.photos?.length ?? 0) + files.length > maxCarPhotos) {
      setError("В карточке можно хранить до 64 фотографий."); return;
    }
    writeLock.current = true;
    setBusy(true);
    setError("");
    try {
      const compressed = await preparePhotos(files);
      if (signedIn) {
        const data = new FormData();
        data.set("revision", String(revision));
        data.set("phase", phase);
        if (workId) data.set("workId", workId);
        for (const file of compressed) data.append("photos", file);
        const response = await fetch("/api/photos/" + encodeURIComponent(car.id), { method: "POST", body: data });
        const result = await response.json() as { ledger: Ledger; revision: number; conflict?: boolean; error?: string };
        if (!response.ok) {
          if (result.conflict) await load();
          throw Error(result.error ?? "Фотографии не сохранились.");
        }
        setLedger(result.ledger);
        setRevision(result.revision);
      } else {
        const photos = compressed.map(file => {
          const id = crypto.randomUUID();
          demoPhotoUrls.current.set(id, URL.createObjectURL(file));
          return { id, phase, workId };
        });
        setLedger({ ...ledger, cars: ledger.cars.map(item => item.id === car.id
          ? { ...car, photos: [...(car.photos ?? []), ...photos] } : item) });
      }
      setToast("Фотографии добавлены");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Фотографии не сохранились.");
    } finally {
      writeLock.current = false;
      setBusy(false);
    }
  }

  function removeDemoPhotos(ids: string[]) {
    for (const id of ids) {
      const source = demoPhotoUrls.current.get(id);
      if (source) URL.revokeObjectURL(source);
      demoPhotoUrls.current.delete(id);
    }
  }

  const cars = ledger.cars.filter(c => {
    const term = query.trim().toLocaleLowerCase("ru").normalize("NFD").replace(/\p{Diacritic}/gu, "");
    const normalized = (c.name + " " + c.vin).toLocaleLowerCase("ru").normalize("NFD").replace(/\p{Diacritic}/gu, "");
    const plateTerm = plateKey(query);
    const plateMatches = Boolean(c.registration && plateTerm && plateKey(c.registration).includes(plateTerm));
    return (normalized.includes(term) || plateMatches) && (filter === "all" || (filter === "active" ? !c.sold : vehicleStage(c) === filter));
  }).sort((a, b) => {
    if (sort === "old") return a.bought.localeCompare(b.bought);
    if (sort === "profit") return (figures(b).net ?? -Infinity) - (figures(a).net ?? -Infinity);
    return b.bought.localeCompare(a.bought);
  });

  function confirmDelete(car: Car) {
    open({ type: "confirm", title: "Удалить автомобиль?", message: "Карточка «" + car.name + "», расходы и связанные движения кассы исчезнут из книги.",
      label: "Удалить автомобиль", action: async () => {
        const ok = await save({ ...ledger, cars: ledger.cars.filter(c => c.id !== car.id) }, "Автомобиль удалён");
        if (ok) { removeDemoPhotos((car.photos ?? []).map(photo => photo.id)); select(null); }
        return ok;
      } });
  }

  function clearDemo() {
    open({ type: "confirm", title: "Удалить демоданные?", message: "Примеры автомобилей будут удалены. Добавленные вами машины и список партнёров сохранятся.",
      label: "Удалить демоданные", action: () => save({ ...ledger, cars: ledger.cars.filter(c => !c.demo) }, "Демоданные удалены") });
  }

  return <div className="shell">
    <aside className="sidebar">
      <button className="brand" onClick={() => changeView("cars")} aria-label="Автобанк, главная">
        <span className="brand-icon"><CarFront size={22} strokeWidth={2.3}/></span>
        <span>Автобанк<small>Учёт автомобилей</small></span>
      </button>
      <nav aria-label="Разделы">
        <button className={view === "cars" ? "nav-item current" : "nav-item"} onClick={() => changeView("cars")}><LayoutDashboard size={19}/> <span>Автомобили</span></button>
        <button className={view === "partners" ? "nav-item current" : "nav-item"} onClick={() => changeView("partners")}><UsersRound size={19}/> <span>Партнёры</span></button>
        <button className={view === "analytics" ? "nav-item current" : "nav-item"} onClick={() => changeView("analytics")}><BarChart3 size={19}/> <span>Аналитика</span></button>
        <button className={view === "cash" ? "nav-item current" : "nav-item"} onClick={() => changeView("cash")}><Wallet size={19}/> <span>Касса</span></button>
      </nav>
      <div className="sidebar-bottom">
        {(demo || !signedIn) && <div className="demo-panel">
          <div className="demo-heading"><span className="demo-dot"/>Демо-данные</div>
          <p>{signedIn ? "В книге есть примеры сделок." : "Изменения в демо действуют до перезагрузки."}</p>
          {signedIn ? <button onClick={clearDemo} disabled={!loaded}>Удалить примеры</button> : <button onClick={requireSignIn}>Войти через ChatGPT</button>}
        </div>}
        <div className="workspace"><span className="workspace-icon"><Wallet size={18}/></span><div><b>Книга учёта</b><small>{signedIn ? "Личное пространство" : "Демонстрация"}</small></div></div>
      </div>
    </aside>

    <main className="main">
      <header className="topbar">
        <div className="breadcrumb"><span>Книга учёта</span><span className="slash">/</span><b>{sectionNames[view]}</b></div>
        <div className="header-right">
          {view === "cars" && <button className="button secondary export" aria-label="Экспорт CSV" onClick={() => exportLedger(ledger)} disabled={!loaded}><Download size={16}/><span>Экспорт CSV</span></button>}
          {view !== "analytics" && <button className="button primary" onClick={() => open({ type: view === "cars" ? "car" : view === "cash" ? "cash" : "partner" })}
            disabled={!loaded}><Plus size={19}/><span>{view === "cars" ? "Добавить авто" : view === "cash" ? "Добавить движение" : "Добавить партнёра"}</span></button>}
        </div>
      </header>
      <div className="content">
        <div className="page-title">
          <h1>{sectionNames[view]}</h1>
          <p>{{ cars: "Покупки, продажи и прибыль по каждой машине.", partners: "Остатки прибыли и выплаты по завершённым сделкам.",
            analytics: "Расходы, продажи и доходность по бюджету покупки.", cash: "Деньги в обороте и доступный остаток." }[view]}</p>
        </div>
        {loadError ? <div className="empty panel"><p role="alert">{loadError}</p><button className="button primary" onClick={() => void load()}>Повторить</button></div>
          : !loaded ? <div className="empty panel" role="status">Загружаем книгу учёта…</div>
          : <>
              {view === "analytics" ? <Analytics ledger={ledger} today={currentDate} rub={rub}/>
              : view === "cash" ? <CashJournal ledger={ledger} today={currentDate} rub={rub} formatDate={dateLabel}
                onAdd={() => open({type: "cash"})} onEdit={id => open({type: "cash", id})} onCar={select}/>
              : <>
              <div className="metrics">
                <div className="metric hero">
                  <div className="metric-title"><span className="metric-icon"><Wallet size={19}/></span><span>Доступно на покупку</span></div>
                  <strong>{cash.entries.length ? rub(cash.balance) : "—"}</strong>
                  <button className="metric-link" onClick={() => changeView("cash")}>{cash.entries.length ? "Открыть кассу" : "Добавить остаток в кассу"}</button>
                  <div className="hero-lines" aria-hidden="true"><i/><i/><i/><i/><i/></div>
                </div>
                <div className="metric">
                  <div className="metric-title"><span className="metric-icon mint"><TrendingUp size={19}/></span><span>Накопленная прибыль</span></div>
                  <strong>{rub(summary.bank)}</strong><small>За вычетом выплат партнёрам</small>
                </div>
                <div className="metric">
                  <div className="metric-title"><span className="metric-icon apricot"><Banknote size={19}/></span><span>Вложено в авто</span></div>
                  <strong>{rub(summary.invested)}</strong><small>Покупки и расходы по авто в работе</small>
                </div>
                <div className="metric">
                  <div className="metric-title"><span className="metric-icon blue"><CarFront size={19}/></span><span>В работе</span></div>
                  <strong>{summary.active} <span className="unit">авто</span></strong><small>Продано · {summary.sold}</small>
                </div>
              </div>
              {view === "cars" ? <>
                <section className="stage-board" aria-label="Этапы продажи">
                  <div className="stage-heading"><h2>Этапы продажи</h2>{overdue > 0 && <span>{overdue} · с просроченным шагом</span>}</div>
                  <div className="stage-grid">
                    {boardStages.map(stage => <button key={stage} className={"stage-card stage-" + stage} aria-pressed={filter === stage}
                      onClick={() => setFilter(filter === stage ? "all" : stage)}>
                      <span>{stageNames[stage]}</span><strong>{stages[stage]}</strong>
                    </button>)}
                  </div>
                </section>
                <section className="panel registry">
                <div className="section-header"><div><h2>Реестр сделок</h2><p>Откройте автомобиль, чтобы посмотреть расходы и расчёт.</p></div></div>
                <div className="table-controls">
                  <div className="tabs" role="group" aria-label="Статус автомобиля">
                    {([["all", "Все", ledger.cars.length], ["active", "В работе", summary.active], ["sold", "Продано", summary.sold]] as const).map(([value, label, count]) =>
                      <button key={value} aria-pressed={filter === value} className={filter === value ? "active" : ""} onClick={() => setFilter(value)}>{label}<span>{count}</span></button>)}
                  </div>
                  {filter !== "all" && filter !== "active" && filter !== "sold" && <button className="button secondary clear-stage" onClick={() => setFilter("all")}>{stageNames[filter]}<X size={14}/></button>}
                  <div className="tools">
                    <label className="search"><Search size={17}/><input type="search" value={query} onChange={e => setQuery(e.target.value)} aria-label="Поиск по авто, VIN или номеру" placeholder="Авто, VIN или госномер"/></label>
                    <label className="sort"><Settings2 size={17}/><select aria-label="Сортировка" value={sort} onChange={e => setSort(e.target.value)}>
                      <option value="recent">Сначала новые</option><option value="old">Сначала старые</option><option value="profit">По прибыли</option>
                    </select><ChevronDown size={14}/></label>
                  </div>
                </div>
                {cars.length ? <>
                  <div className="table-scroll" tabIndex={0} role="region" aria-label="Таблица сделок с горизонтальной прокруткой">
                    <table className="deal-table">
                      <thead><tr>
                        <th scope="col">Автомобиль</th><th scope="col">Статус</th>
                        <th scope="col"><span className="with-icon">Дата покупки {sort === "old" ? <ArrowUp size={13}/> : sort === "recent" ? <ArrowDown size={13}/> : null}</span></th>
                        <th scope="col">Дата продажи</th><th scope="col" className="num">Покупка</th><th scope="col" className="num">Расходы</th>
                        <th scope="col" className="num">Продажа</th><th scope="col" className="num">Чистая прибыль</th>
                        {ledger.partners.map(p => <th scope="col" key={p.id} className="num" title={p.name}>{short(p)} <small>Выплата · Остаток</small></th>)}
                        <th scope="col" className="num">Накоплено из прибыли</th>
                      </tr></thead>
                      <tbody>{cars.map((c, index) => {
                        const numbers = figures(c);
                        const snapshot = summary.timeline.get(c.id);
                        return <tr key={c.id} onClick={() => select(c.id)}>
                          <td><button className="vehicle" onClick={e => { e.stopPropagation(); select(c.id); }}>
                            <span className={"vehicle-icon tone-" + (index % 4)}><CarFront size={21}/></span>
                            <span><b>{c.name}</b><small>{[c.year, c.mileage === null ? c.vin : format.format(c.mileage) + " км"].filter(Boolean).join(" · ") || "Карточка авто"}</small></span>
                          </button></td>
                          <td><Badge stage={vehicleStage(c)}/></td>
                          <td className="date">{dateLabel(c.bought)}</td><td className="date">{c.sold ? dateLabel(c.sold) : "—"}</td>
                          <td className="num">{rub(c.buy)}</td><td className="num">{rub(numbers.expenses)}</td>
                          <td className="num">{c.price === null ? "—" : rub(c.price)}</td>
                          <td className={"num " + profitColor(numbers.net)}>{numbers.net === null ? "—" : (numbers.net > 0 ? "+" : "") + rub(numbers.net)}</td>
                          {ledger.partners.map(p => <td className="num" key={p.id}>{snapshot ? <>
                            <span>{rub(snapshot.people[p.id])}</span>
                            {numbers.people[p.id]?.profit > 0 && <small className="cell-caption">{numbers.people[p.id].withdrawn ? "Забрал" : "В банке"}</small>}
                          </> : "—"}</td>)}
                          <td className="num">{snapshot ? rub(snapshot.bank) : "—"}</td>
                        </tr>;
                      })}</tbody>
                    </table>
                  </div>
                  <div className="mobile-cars">{cars.map((c, index) => {
                    const calc = figures(c);
                    return <button key={c.id} className="mobile-car" onClick={() => select(c.id)}>
                      <span className="mobile-car-top"><span className="vehicle"><span className={"vehicle-icon tone-" + (index % 4)}><CarFront size={21}/></span><span><b>{c.name}</b><small>{c.year ? c.year + " · " : ""}{dateLabel(c.bought)}</small></span></span><Badge stage={vehicleStage(c)}/></span>
                      <span className="mobile-car-bottom"><span><small>Покупка</small><b>{rub(c.buy)}</b></span><span><small>Расходы</small><b>{rub(calc.expenses)}</b></span><span><small>Прибыль</small><b className={profitColor(calc.net)}>{calc.net === null ? "—" : rub(calc.net)}</b></span></span>
                    </button>;
                  })}</div>
                </> : <div className="empty"><div className="empty-icon"><CarFront size={26}/></div><h3>{ledger.cars.length ? "Автомобили не найдены" : "В книге пока нет автомобилей"}</h3>
                  <p>{ledger.cars.length ? "Измените поиск или статус сделки." : "Добавьте первую покупку, чтобы начать учёт."}</p>
                  {!ledger.cars.length && <button className="button primary" onClick={() => open({ type: "car" })}><Plus size={17}/>Добавить авто</button>}
                </div>}
                <div className="table-footer"><span>Автомобилей в списке · {cars.length} из {ledger.cars.length}</span><span>Все суммы в рублях</span></div>
              </section></> : <section className="panel partners">
                <div className="section-header"><div><h2>Расчёты с партнёрами</h2><p>Доли прибыли и внесённые средства задаются в карточке автомобиля.</p></div></div>
                <div className="partner-grid">
                  {ledger.partners.map((p, index) => {
                    const withdrawn = ledger.cars.reduce((sum, c) => {
                      const share = figures(c).people[p.id];
                      return sum + (share?.withdrawn ? share.profit : 0);
                    }, 0);
                    return <div className="partner" key={p.id}>
                      <div className="partner-head"><span className={"avatar tone-" + (index % 4)}>{initials(p)}</span><b>{p.name}</b><button className="icon-button" onClick={() => open({ type: "partner", id: p.id })} aria-label={"Редактировать " + p.name}><Pencil size={17}/></button></div>
                      <div className="partner-totals"><div><small>В банке</small><strong>{rub(summary.balances[p.id])}</strong></div><div><small>Забрал</small><strong>{rub(withdrawn)}</strong></div></div>
                    </div>;
                  })}
                </div>
              </section>}
              </>}
            </>}
      </div>
    </main>
    {selectedCar && <Overlay side title={carName ?? "Автомобиль"} onClose={() => select(null)} inactive={Boolean(dialog)}>
      <div className="detail-heading">
        <div><Badge stage={vehicleStage(selectedCar)}/><h2>{selectedCar.name}</h2><div className="detail-meta">
          {selectedCar.year && <span>{selectedCar.year} г.</span>}
          {selectedCar.mileage !== null && <span><Gauge size={16}/> {format.format(selectedCar.mileage)} км</span>}
          {selectedCar.registration && <span className="car-registration">{selectedCar.registration}</span>}
          <span>VIN {selectedCar.vin || "—"}</span>
        </div></div>
        <div className="detail-actions"><button className="button secondary" onClick={() => open({ type: "car", id: selectedCar.id })}><Pencil size={15}/>Изменить</button>
          <button className="icon-button bordered" aria-expanded={actions} aria-label="Действия с автомобилем" onClick={() => setActions(!actions)}><Ellipsis size={20}/></button>
          {actions && <button className="delete-action" onClick={() => confirmDelete(selectedCar)}><Trash2 size={16}/>Удалить авто</button>}
        </div>
      </div>
      <div className="vehicle-progress">
        <div className="vehicle-progress-info">
          {selectedCar.nextAction && !selectedCar.sold ? <><b>{selectedCar.nextAction.title}</b>{selectedCar.nextAction.due &&
            <span className={selectedCar.nextAction.due < currentDate ? "negative" : ""}>
              {selectedCar.nextAction.due < currentDate ? "Просрочено · " : "Срок · "}{dateLabel(selectedCar.nextAction.due)}</span>}</>
          : !selectedCar.sold ? <span>Следующий шаг пока не указан</span> : <span>Сделка завершена</span>}
        </div>
        <div className="vehicle-progress-actions">
          {!selectedCar.sold && <button className="button secondary" onClick={() => open({type:"progress", id:selectedCar.id})}><Pencil size={15}/>Этап и шаг</button>}
          <button className="button primary" onClick={() => open({type:"contract", id:selectedCar.id})}><FileText size={16}/>Договор</button>
        </div>
      </div>
      <div className="tabs car-tabs" role="group" aria-label="Раздел карточки">
        {(Object.keys(carTabs) as CarTab[]).map(tab => <button key={tab} type="button" className={carTab === tab ? "active" : ""}
          aria-pressed={carTab === tab} onClick={() => { setCarTab(tab); setError(""); }}>{carTabs[tab]}</button>)}
      </div>
      {carTab === "history" ? <WorkHistory car={selectedCar} busy={busy} error={dialog ? "" : error} source={photoSource} dateLabel={dateLabel}
        onUpload={(phase, files, workId) => uploadPhotos(selectedCar, phase, files, workId)}
        onWork={work => open({type:"work", id:selectedCar.id, workId:work?.id})}
        onPhoto={photo => open({type:"photo", id:selectedCar.id, photoId:photo.id})}
        onReport={() => open({type:"report", id:selectedCar.id})}/>
      : carTab === "parts" ? <PartPlan car={selectedCar} busy={busy} error={dialog ? "" : error}
        onAdd={() => open({type:"part", id:selectedCar.id})} onBatch={() => open({type:"part-list", id:selectedCar.id})}
        onEdit={part => open({type:"part", id:selectedCar.id, partId:part.id})}
        onExpense={part => open({type:"expense", id:selectedCar.id, partId:part.id})}
        onToggle={part => void saveCar({ ...selectedCar, parts: selectedCar.parts?.map(item =>
          item.id === part.id ? { ...item, acquired: !item.acquired } : item) }, part.acquired ? "Позиция отмечена к покупке" : "Позиция отмечена купленной")}
        onRemove={part => open({ type:"confirm", title:"Удалить запчасть из списка?", message:part.name,
          label:"Удалить позицию", action:() => saveCar({ ...selectedCar, parts: selectedCar.parts?.filter(item => item.id !== part.id) }, "Позиция удалена") })}/>
      : <CarDetails car={selectedCar} ledger={ledger} busy={busy} error={dialog ? "" : error}
        onExpense={expense => open({ type: "expense", id: selectedCar.id, expense })}
        onDeleteExpense={expense => open({ type: "confirm", title: "Удалить расход?", message: "Расход «" + expense.name + "» исчезнет из сделки.",
          label: "Удалить расход", action: () => saveCar({
            ...selectedCar, expenses: selectedCar.expenses.filter(e => e.id !== expense.id),
            works: selectedCar.works?.map(work => work.expenseId === expense.id ? { ...work, expenseId: undefined } : work),
          }, "Расход удалён") })}
        onSale={() => open({ type: "sale", id: selectedCar.id })}
        onWithdraw={async (id, withdrawn) => {
          if (withdrawn) {
            open({ type: "payout", id: selectedCar.id, partnerId: id });
            return;
          }
          await saveCar({ ...selectedCar, shares: selectedCar.shares.map(s => s.partner === id
            ? { ...s, withdrawn: false, cashWithdrawalDate: undefined } : s) }, "Отметка о выплате снята");
        }}/>}
    </Overlay>}
    {dialog && <Overlay title={dialogTitle(dialog)} onClose={() => { if (!busy) open(null); }}>
      {dialog.type === "confirm" ? <>
        <p className="confirm-copy">{dialog.message}</p>
        <FormFooter error={error} busy={busy} onCancel={() => open(null)} submit={dialog.label} danger
          onConfirm={async () => { if (await dialog.action()) open(null); }}/>
      </> : dialog.type === "car" ? <CarForm car={ledger.cars.find(c => c.id === dialog.id)} partners={ledger.partners}
        knownCars={ledger.cars} signedIn={signedIn}
        error={error} setError={setError} busy={busy} onCancel={() => open(null)} onSave={async car => {
          if (await saveCar(car, dialog.id ? "Карточка обновлена" : "Автомобиль добавлен")) {
            setQuery(""); setFilter("all"); select(car.id); open(null);
          }
        }}/>
      : dialog.type === "expense" ? selectedCar && <ExpenseForm car={selectedCar} partners={ledger.partners}
        expense={selectedCar.expenses.find(e => e.id === dialog.expense)} preset={selectedCar.parts?.find(part => part.id === dialog.partId)?.name}
        error={error} setError={setError} busy={busy} onCancel={() => open(null)}
        onSave={async expense => {
          const expenses = dialog.expense ? selectedCar.expenses.map(e => e.id === expense.id ? expense : e) : [...selectedCar.expenses, expense];
          const parts = selectedCar.parts?.map(part => part.id === dialog.partId ? { ...part, acquired: true } : part);
          if (await saveCar({ ...selectedCar, expenses, parts }, dialog.expense ? "Расход обновлён" : "Расход добавлен")) open(null);
        }}/>
      : dialog.type === "work" ? selectedCar && <WorkForm car={selectedCar}
        work={selectedCar.works?.find(work => work.id === dialog.workId)} error={error} setError={setError} busy={busy} onCancel={() => open(null)}
        onSave={async work => {
          const works = selectedCar.works ?? [];
          const next = dialog.workId ? works.map(item => item.id === work.id ? work : item) : [...works, work];
          if (await saveCar({ ...selectedCar, works: next }, "Работа сохранена")) open(null);
        }} onDelete={dialog.workId ? () => open({
          type:"confirm", title:"Удалить работу?", message:"Работа и её фотографии исчезнут из истории автомобиля.",
          label:"Удалить работу", action:async () => {
            const removed = (selectedCar.photos ?? []).filter(photo => photo.workId === dialog.workId);
            const ok = await saveCar({ ...selectedCar,
              works:selectedCar.works?.filter(work => work.id !== dialog.workId),
              photos:selectedCar.photos?.filter(photo => photo.workId !== dialog.workId) }, "Работа удалена");
            if (ok) removeDemoPhotos(removed.map(photo => photo.id));
            return ok;
          },
        }) : undefined}/>
      : dialog.type === "part" ? selectedCar && <PartForm part={selectedCar.parts?.find(part => part.id === dialog.partId)}
        error={error} setError={setError} busy={busy} onCancel={() => open(null)} onSave={async part => {
          const parts = selectedCar.parts ?? [];
          const next = dialog.partId ? parts.map(item => item.id === part.id ? part : item) : [...parts, part];
          if (await saveCar({ ...selectedCar, parts:next }, "Запчасть сохранена")) open(null);
        }}/>
      : dialog.type === "part-list" ? selectedCar && <PartListForm error={error} setError={setError} busy={busy} onCancel={() => open(null)}
        onSave={async names => {
          const parts = selectedCar.parts ?? [];
          if (parts.length + names.length > 100) { setError("В списке может быть до 100 позиций."); return; }
          const next = names.map(name => ({id:crypto.randomUUID(), name, acquired:false}));
          if (await saveCar({ ...selectedCar, parts:[...parts, ...next] }, "Список пополнен")) open(null);
        }}/>
      : dialog.type === "photo" ? selectedCar && <PhotoForm photo={selectedCar.photos?.find(photo => photo.id === dialog.photoId)}
        error={error} busy={busy} onCancel={() => open(null)}
        onSave={async caption => {
          const photos = selectedCar.photos?.map(photo => photo.id === dialog.photoId ? { ...photo, caption } : photo);
          if (await saveCar({ ...selectedCar, photos }, "Подпись сохранена")) open(null);
        }} onDelete={() => open({
          type:"confirm", title:"Удалить фотографию?", message:"Снимок исчезнет из карточки и из будущих PDF.",
          label:"Удалить фото", action:async () => {
            const ok = await saveCar({ ...selectedCar, photos:selectedCar.photos?.filter(photo => photo.id !== dialog.photoId) }, "Фото удалено");
            if (ok) removeDemoPhotos([dialog.photoId]);
            return ok;
          },
        })}/>
      : dialog.type === "report" ? selectedCar && <ReportForm car={selectedCar} error={error} setError={setError}
        busy={busy} onCancel={() => open(null)} onSave={async (askingPrice, includeVin) => {
          setBusy(true); setError("");
          try {
            await downloadBuyerReport({ car:selectedCar, askingPrice, includeVin, photoSource, rub, dateLabel });
            setToast("Отчёт подготовлен");
            open(null);
          } catch (failure) {
            setError(failure instanceof Error ? failure.message : "Не удалось подготовить PDF.");
          } finally { setBusy(false); }
        }}/>
      : dialog.type === "contract" ? selectedCar && <ContractForm car={selectedCar} today={currentDate} sellerScope={sellerScope} busy={busy}
        onRememberVehicle={vehicle => saveCar({
          ...selectedCar, name: vehicle.name, vin: vehicle.vin.toUpperCase(), registration: normalizePlate(vehicle.registration) || undefined,
          year: Number(vehicle.year), mileage: vehicle.mileage ? Number(vehicle.mileage) : null, documents: vehicle.documents,
        }, "Реквизиты сохранены в карточке")}
        onClose={() => open(null)}/>
      : dialog.type === "progress" ? selectedCar && <ProgressForm car={selectedCar} error={error} setError={setError}
        busy={busy} onCancel={() => open(null)} onSave={async edited => {
          if (await saveCar(edited, "Этап сделки обновлён")) open(null);
        }}/>
      : dialog.type === "sale" ? selectedCar && <SaleForm car={selectedCar} error={error} setError={setError} busy={busy} onCancel={() => open(null)} onSave={async (sold, price, cashSale) => {
        if (await saveCar({ ...selectedCar, sold, price, cashSale }, selectedCar.sold ? "Продажа обновлена" : "Продажа оформлена")) open(null);
      }}/>
      : dialog.type === "payout" ? selectedCar && <PayoutForm car={selectedCar} person={personBy(ledger, dialog.partnerId)}
        error={error} busy={busy} onCancel={() => open(null)} onSave={async cashWithdrawalDate => {
          const shares = selectedCar.shares.map(share => share.partner === dialog.partnerId
            ? { ...share, withdrawn: true, cashWithdrawalDate } : share);
          if (await saveCar({ ...selectedCar, shares }, "Выплата отмечена")) open(null);
        }}/>
      : dialog.type === "cash" ? <CashForm entry={ledger.cashEntries?.find(entry => entry.id === dialog.id)}
        error={error} setError={setError} busy={busy} onCancel={() => open(null)} onSave={async entry => {
          const entries = ledger.cashEntries ?? [];
          const cashEntries = dialog.id ? entries.map(item => item.id === entry.id ? entry : item) : [...entries, entry];
          if (await save({ ...ledger, cashEntries }, "Движение кассы сохранено")) open(null);
        }} onDelete={dialog.id ? () => open({
          type: "confirm", title: "Удалить движение?", message: "Касса пересчитается после удаления записи.", label: "Удалить движение",
          action: () => save({ ...ledger, cashEntries: (ledger.cashEntries ?? []).filter(entry => entry.id !== dialog.id) }, "Движение удалено"),
        }) : undefined}/>
      : <PartnerForm person={personBy(ledger, dialog.id ?? "")} error={error} busy={busy} onCancel={() => open(null)} onSave={async name => {
        if (ledger.partners.some(p => p.id !== dialog.id && p.name.toLocaleLowerCase("ru") === name.toLocaleLowerCase("ru"))) {
          setError("Партнёр с таким именем уже есть."); return;
        }
        if (!dialog.id && ledger.partners.length >= 16) { setError("В книге можно учитывать до 16 партнёров."); return; }
        const partners = dialog.id ? ledger.partners.map(p => p.id === dialog.id ? { ...p, name } : p)
          : [...ledger.partners, { id: crypto.randomUUID(), name }];
        if (await save({ ...ledger, partners }, "Партнёр сохранён")) open(null);
      }}/>}
    </Overlay>}
    {toast && <div className="toast" role="status"><Check size={18}/>{toast}</div>}
  </div>;
}

function profitColor(net: number | null) {
  if (net === null || net === 0) return "muted";
  return net > 0 ? "positive" : "negative";
}

function Badge({ stage }: { stage: VehicleStage }) {
  return <span className={"badge badge-" + stage}><span/>{stageNames[stage]}</span>;
}

function dialogTitle(dialog: Dialog) {
  if (dialog.type === "confirm") return dialog.title;
  if (dialog.type === "car") return dialog.id ? "Редактировать автомобиль" : "Добавить автомобиль";
  if (dialog.type === "expense") return dialog.expense ? "Редактировать расход" : "Добавить расход";
  if (dialog.type === "sale") return "Дата и цена продажи";
  if (dialog.type === "contract") return "Договор купли-продажи";
  if (dialog.type === "progress") return "Этап и следующий шаг";
  if (dialog.type === "cash") return dialog.id ? "Изменить движение кассы" : "Добавить движение кассы";
  if (dialog.type === "payout") return "Отметить выплату";
  if (dialog.type === "work") return dialog.workId ? "Изменить работу" : "Добавить выполненную работу";
  if (dialog.type === "part") return dialog.partId ? "Изменить запчасть" : "Добавить запчасть";
  if (dialog.type === "part-list") return "Добавить список запчастей";
  if (dialog.type === "photo") return "Подпись к фотографии";
  if (dialog.type === "report") return "PDF для покупателя";
  return dialog.id ? "Редактировать партнёра" : "Добавить партнёра";
}

function Overlay({ side, title, onClose, inactive, children }: {
  side?: boolean; title: string; onClose: () => void; inactive?: boolean; children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const node = ref.current;
    node?.showModal();
    return () => node?.close();
  }, []);
  const titleId = side ? "drawer-title" : "modal-title";
  return <dialog ref={ref} className={side ? "drawer" : "dialog"} aria-labelledby={titleId}
    onCancel={e => { e.preventDefault(); if (!inactive) onClose(); }}
    onClick={e => { if (e.target === e.currentTarget && !inactive) onClose(); }}>
    <div className="dialog-inner">
      <header className="dialog-header">
        {side ? <div className="drawer-label" id={titleId}><ClipboardList size={17}/> Карточка автомобиля</div> : <h2 id={titleId}>{title}</h2>}
        <button className="icon-button" aria-label="Закрыть" onClick={onClose}><X size={22}/></button>
      </header>
      <div className="dialog-content">{children}</div>
    </div>
  </dialog>;
}

function CarDetails({ car, ledger, busy, error, onExpense, onDeleteExpense, onSale, onWithdraw }: {
  car: Car; ledger: Ledger; busy: boolean; error: string;
  onExpense: (expense?: string) => void; onDeleteExpense: (expense: Expense) => void; onSale: () => void;
  onWithdraw: (id: string, withdrawn: boolean) => Promise<void>;
}) {
  const calc = figures(car);
  const snapshot = totals(ledger).timeline.get(car.id);
  const people = ledger.partners.filter(p => {
    const person = calc.people[p.id];
    return Boolean(person?.buy || person?.expenses || car.shares.find(s => s.partner === p.id)?.weight);
  });
  return <>
    <div className="detail-summary">
      <div><span><ArrowDownLeft size={16}/> Покупка</span><strong>{rub(car.buy)}</strong><small>{dateLabel(car.bought)}</small></div>
      <div><span><Wallet size={16}/> Расходы</span><strong>{rub(calc.expenses)}</strong><small>Всего вложено {rub(calc.invested)}</small></div>
      <div><span><ArrowUpRight size={16}/> Продажа</span><strong>{car.price === null ? "—" : rub(car.price)}</strong><small>{car.sold ? dateLabel(car.sold) : "В работе"}</small></div>
      <div className="detail-net"><span><TrendingUp size={16}/> Чистая прибыль</span><strong className={profitColor(calc.net)}>{calc.net === null ? "—" : rub(calc.net)}</strong><small>Продажа минус вложения</small></div>
    </div>
    <div className="sale-action"><button className={"button " + (car.sold ? "secondary" : "primary")} onClick={onSale}>{car.sold ? <Pencil size={16}/> : <Check size={18}/>} {car.sold ? "Изменить продажу" : "Оформить продажу"}</button></div>
    <section className="detail-section">
      <div className="detail-section-header"><h3>Расходы</h3><button className="button secondary" onClick={() => onExpense()}><Plus size={17}/>Добавить расход</button></div>
      {car.expenses.length ? <div className="expense-list">
        {[...car.expenses].sort((a, b) => b.date.localeCompare(a.date)).map(e => <div className="expense-row" key={e.id}>
          <div><b>{e.name}</b><small>{[dateLabel(e.date), e.category, e.payer === null ? "Общая касса" : personBy(ledger, e.payer)?.name].filter(Boolean).join(" · ")}</small></div>
          <strong>{rub(e.amount)}</strong>
          <button className="icon-button" onClick={() => onExpense(e.id)} aria-label={"Изменить " + e.name}><Pencil size={16}/></button>
          <button className="icon-button" onClick={() => onDeleteExpense(e)} aria-label={"Удалить " + e.name}><Trash2 size={16}/></button>
        </div>)}
      </div> : <p className="inline-empty">По этому автомобилю пока нет расходов.</p>}
    </section>
    <section className="detail-section">
      <div className="detail-section-header"><h3>Расчёт по партнёрам</h3></div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="settlements">{people.map((p, index) => {
        const person = calc.people[p.id];
        const advance = person.buy + person.expenses;
        const weight = car.shares.find(s => s.partner === p.id)?.weight ?? 0;
        return <div className="settlement" key={p.id}>
          <div className="partner-head"><span className={"avatar tone-" + (index % 4)}>{initials(p)}</span><div><b>{p.name}</b><small>Доля прибыли · {format.format(weight / 100)}%</small></div></div>
          <dl>
            <div><dt>Внёс на покупку</dt><dd>{rub(person.buy)}</dd></div>
            <div><dt>Оплатил расходы</dt><dd>{rub(person.expenses)}</dd></div>
            {car.sold && <>
              <div><dt>Возврат вложений</dt><dd>{rub(advance)}</dd></div>
              <div><dt>{person.profit < 0 ? "Доля убытка" : "Доля прибыли"}</dt><dd className={profitColor(person.profit)}>{rub(person.profit)}</dd></div>
              <div><dt>Итого по сделке</dt><dd>{rub(advance + person.profit)}</dd></div>
              <div><dt>Накопления после сделки</dt><dd>{rub(snapshot?.people[p.id] ?? 0)}</dd></div>
            </>}
          </dl>
          {car.sold && person.profit > 0 && <label className="payout"><input type="checkbox" checked={person.withdrawn}
            disabled={busy} onChange={e => void onWithdraw(p.id, e.target.checked)}/><span>Забрал прибыль</span><b>{person.withdrawn ? "Да" : "Нет"}</b></label>}
        </div>;
      })}</div>
      {snapshot && <div className="deal-bank"><Wallet size={18}/><span>Накопленная прибыль с учётом сделки</span><strong>{rub(snapshot.bank)}</strong></div>}
    </section>
  </>;
}

type FormProps = { error: string; busy: boolean; onCancel: () => void };

function FormFooter({ error, busy, onCancel, submit = "Сохранить", danger, onConfirm }: FormProps & {
  submit?: string; danger?: boolean; onConfirm?: () => void;
}) {
  return <>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="form-footer">
      <button type="button" className="button secondary" disabled={busy} onClick={onCancel}>Отмена</button>
      <button type={onConfirm ? "button" : "submit"} className={"button " + (danger ? "danger" : "primary")}
        onClick={onConfirm} disabled={busy}>{busy ? "Сохраняем…" : submit}</button>
    </div>
  </>;
}

function MoneyField({ name, value, minLabel = "0", required = true }: { name: string; value?: string; minLabel?: string; required?: boolean }) {
  return <input name={name} inputMode="decimal" defaultValue={value} placeholder={minLabel} required={required} maxLength={18}/>;
}

const identityFields = ["name", "vin", "year"] as const;
type IdentityValues = Record<(typeof identityFields)[number], string>;
type DraftIdentity = { values: IdentityValues; filled: Partial<IdentityValues> };

function fillIdentity(draft: DraftIdentity, details: PlateDetails): DraftIdentity {
  const values = { ...draft.values };
  const filled = { ...draft.filled };
  for (const field of identityFields) {
    const value = details[field];
    if (!values[field].trim() && value) {
      values[field] = String(value);
      filled[field] = String(value);
    }
  }
  return { values, filled };
}

function forgetAutofill(draft: DraftIdentity): DraftIdentity {
  const values = { ...draft.values };
  for (const field of identityFields) {
    if (draft.filled[field] === values[field]) values[field] = "";
  }
  return { values, filled: {} };
}

function storedPlateDetails(cars: Car[], plate: string, currentId?: string): PlateDetails | null {
  const key = plateKey(plate);
  if (!key) return null;
  const matches = cars.filter(car => car.id !== currentId && plateKey(car.registration ?? "") === key);
  if (!matches.length) return null;
  const vins = new Set(matches.map(car => car.vin).filter(Boolean));
  if (vins.size > 1) return null;
  const names = new Set(matches.map(car => car.name));
  const years = new Set(matches.map(car => car.year).filter((year): year is number => Boolean(year)));
  const details = {
    name: names.size === 1 ? matches[0].name : undefined,
    vin: vins.size === 1 ? [...vins][0] : undefined,
    year: years.size === 1 ? [...years][0] : undefined,
  };
  return Object.values(details).some(Boolean) ? details : null;
}

function CarForm({ car, partners, knownCars, signedIn, error, setError, busy, onCancel, onSave }: FormProps & {
  car?: Car; partners: Partner[]; knownCars: Car[]; signedIn: boolean; setError: (error: string) => void; onSave: (car: Car) => Promise<void>;
}) {
  const [registration, setRegistration] = useState(car?.registration ?? "");
  const plateRef = useRef(plateKey(car?.registration ?? ""));
  const [identity, setIdentity] = useState<DraftIdentity>({
    values: { name: car?.name ?? "", vin: car?.vin ?? "", year: car?.year ? String(car.year) : "" }, filled: {},
  });
  const [lookupAvailable, setLookupAvailable] = useState(false);
  const [lookupBusy, setLookupBusy] = useState(false);
  const [plateMessage, setPlateMessage] = useState("");
  const [buyInput, setBuyInput] = useState(car ? moneyText(car.buy) : "");
  const [manual, setManual] = useState(Boolean(car && car.shares.length > 1));
  const [cashPurchase, setCashPurchase] = useState(Boolean(car?.cashPurchase));
  const [selectedPartners, setSelectedPartners] = useState(partners.filter(p => !car || car.shares.some(s => s.partner === p.id && (s.weight || s.buy))).map(p => p.id));
  const included = partners.filter(p => selectedPartners.includes(p.id));
  const ratios = defaultWeights(included.length || 1);
  const buyValid = parseMoney(buyInput);
  const preview = splitAmount(!cashPurchase && Number.isFinite(buyValid) ? buyValid : 0, ratios);

  useEffect(() => {
    if (!signedIn) return;
    const request = new AbortController();
    void fetch("/api/plate-lookup", { signal: request.signal, cache: "no-store" })
      .then(response => response.ok ? response.json() as Promise<{ available: boolean }> : null)
      .then(result => { if (result?.available) setLookupAvailable(true); }).catch(() => {});
    return () => request.abort();
  }, [signedIn]);

  function changeRegistration(value: string, find = false) {
    const key = plateKey(value);
    const changed = key !== plateRef.current;
    plateRef.current = key;
    setRegistration(value);
    if (changed || find) {
      const match = find ? storedPlateDetails(knownCars, value, car?.id) : null;
      setIdentity(previous => {
        const next = changed ? forgetAutofill(previous) : previous;
        return match ? fillIdentity(next, match) : next;
      });
      setPlateMessage(match ? "Данные подставлены из вашей книги. Сверьте VIN и год."
        : find ? "В вашей книге данных по этому номеру нет. Можно заполнить карточку вручную." : "");
    }
  }

  function editIdentity(field: (typeof identityFields)[number], value: string) {
    setIdentity(previous => ({
      values: { ...previous.values, [field]: value },
      filled: { ...previous.filled, [field]: undefined },
    }));
  }

  async function lookupPlate() {
    const plate = formatRussianPlate(registration);
    if (!plate || lookupBusy) return;
    setLookupBusy(true);
    setPlateMessage("");
    try {
      const response = await fetch("/api/plate-lookup", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plate }) });
      const result = await response.json() as { status: string; details?: PlateDetails };
      if (plateRef.current !== plateKey(plate)) return;
      if (result.status === "found" && result.details) {
        const details = result.details;
        setIdentity(previous => fillIdentity(previous, details));
        setPlateMessage("Подставлены найденные данные. Сверьте их с документами и заполните пустые поля.");
      } else if (result.status === "not_found") {
        setPlateMessage("База не нашла машину. Госномер можно сохранить, остальные поля заполните вручную.");
      } else if (result.status === "balance") {
        setPlateMessage("У сервиса поиска недостаточно средств на балансе. Можно заполнить данные вручную.");
      } else {
        setPlateMessage("База сейчас недоступна. Госномер можно сохранить, остальные поля заполните вручную.");
      }
    } catch {
      if (plateRef.current === plateKey(plate)) setPlateMessage("Не удалось получить данные. Можно заполнить карточку вручную.");
    } finally {
      setLookupBusy(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const name = String(values.get("name")).trim();
    const bought = String(values.get("bought"));
    const vin = String(values.get("vin")).trim().toUpperCase();
    const savedRegistration = normalizePlate(String(values.get("registration") ?? ""));
    if (savedRegistration.length > 16) { setError("В госномере может быть до 16 символов."); return; }
    const mileageText = String(values.get("mileage")).trim();
    const mileage = mileageText ? Number(mileageText) : null;
    const yearText = String(values.get("year")).trim();
    const year = yearText ? Number(yearText) : null;
    if (!name || !range(buyValid, 1, 100_000_000_000)) { setError("Введите название и положительную цену покупки."); return; }
    if (!included.length) { setError("Выберите хотя бы одного участника сделки."); return; }
    if (car?.sold && bought > car.sold) { setError("Дата покупки должна быть до продажи или совпадать с ней."); return; }
    if (car?.works?.some(work => work.date < bought)) { setError("Дата покупки должна быть до первой работы или совпадать с ней."); return; }
    if (car?.expenses.some(e => e.date < bought)) { setError("Дата покупки должна быть до первого расхода или совпадать с ним."); return; }
    const shares = included.map((p, index) => ({
      partner: p.id,
      buy: cashPurchase ? 0 : manual ? parseMoney(values.get("buy-" + p.id) || "0") : preview[index],
      weight: manual ? parseMoney(values.get("weight-" + p.id) || "0") : ratios[index],
      withdrawn: car?.shares.find(s => s.partner === p.id)?.withdrawn ?? false,
      cashWithdrawalDate: car?.shares.find(s => s.partner === p.id)?.cashWithdrawalDate,
    }));
    if (car?.shares.some(s => s.withdrawn && !shares.some(next => next.partner === s.partner))) {
      setError("Сначала отмените выплату участнику, которого хотите исключить из сделки."); return;
    }
    if (shares.some(s => !range(s.buy, 0, buyValid) || !range(s.weight, 0, 10_000))) {
      setError("Введите суммы взносов и проценты от 0 до 100."); return;
    }
    if (shares.reduce((sum, s) => sum + s.buy, 0) !== (cashPurchase ? 0 : buyValid)) { setError("Сумма взносов должна совпадать с ценой покупки."); return; }
    if (shares.reduce((sum, s) => sum + s.weight, 0) !== 10_000) { setError("Доли прибыли должны давать 100%."); return; }
    await onSave({ ...car, id: car?.id ?? crypto.randomUUID(), name, vin, registration: savedRegistration || undefined, year, mileage, bought, buy: buyValid, cashPurchase,
      sold: car?.sold ?? null, price: car?.price ?? null, shares, expenses: car?.expenses ?? [] });
  }

  return <form onSubmit={submit}>
    <PlatePhoto disabled={busy || lookupBusy} onApply={plate => changeRegistration(plate, true)}/>
    <div className="form-grid">
      <label className="field">Госномер<input name="registration" value={registration} onChange={event => changeRegistration(event.target.value.toUpperCase())}
        onBlur={() => changeRegistration(normalizePlate(registration), Boolean(registration.trim()) && !plateMessage)}
        placeholder="А123ВС250" autoCapitalize="characters" autoComplete="off" spellCheck={false} maxLength={20}/></label>
      <label className="field">VIN<input name="vin" placeholder="VIN автомобиля" value={identity.values.vin}
        onChange={event => editIdentity("vin", event.target.value.toUpperCase())} maxLength={32}/></label>
      {(plateMessage || lookupAvailable && formatRussianPlate(registration)) && <div className="wide plate-lookup">
        {plateMessage && <p role="status">{plateMessage}</p>}
        {lookupAvailable && formatRussianPlate(registration) && <>
          <button type="button" className="button secondary" disabled={lookupBusy || busy} onClick={() => void lookupPlate()}>
            <Search size={16}/>{lookupBusy ? "Ищем по номеру…" : "Найти по номеру в AvtoVinCod"}</button>
          <small>Сервис получит госномер и может списать стоимость запроса.</small>
        </>}
      </div>}
      <label className="field wide">Марка и модель<input name="name" placeholder="Например, Škoda Fabia" value={identity.values.name}
        onChange={event => editIdentity("name", event.target.value)} required maxLength={90}/></label>
      <label className="field">Год выпуска<input type="number" min="1880" max="2100" step="1" name="year" placeholder="2013"
        value={identity.values.year} onChange={event => editIdentity("year", event.target.value)}/></label>
      <label className="field">Пробег, км<input type="number" min="0" max="10000000" step="1" name="mileage" placeholder="125 000" defaultValue={car?.mileage ?? undefined}/></label>
      <label className="field">Дата покупки<input type="date" name="bought" defaultValue={car?.bought ?? today()} required/></label>
      <label className="field">Цена покупки, ₽<input name="buy" inputMode="decimal" value={buyInput} onChange={e => setBuyInput(e.target.value)} required placeholder="0" maxLength={18}/></label>
    </div>
    <label className="option-check"><input type="checkbox" checked={cashPurchase} onChange={e => setCashPurchase(e.target.checked)}/> Оплачено из общей кассы</label>
    <details className="form-shares" open={Boolean(car && car.shares.length > 1) || undefined}>
      <summary>Участники и доли · {included.length}</summary>
      <div className="split-controls">{partners.map(p => <label key={p.id} className="partner-choice">
        <input type="checkbox" checked={selectedPartners.includes(p.id)} onChange={e => {
          setSelectedPartners(e.target.checked ? [...selectedPartners, p.id] : selectedPartners.filter(id => id !== p.id));
        }}/>{p.name}</label>)}</div>
      <label className="manual-choice"><input type="checkbox" checked={manual} onChange={e => setManual(e.target.checked)}/> Задать взносы и доли вручную</label>
      {included.map((p, index) => {
        const old = car?.shares.find(s => s.partner === p.id);
        return manual ? <div className="share-inputs" key={p.id}>
          <b>{p.name}</b>
          {cashPurchase ? <span/> : <label className="field">Взнос, ₽<MoneyField name={"buy-" + p.id} value={moneyText((car?.cashPurchase ? undefined : old?.buy) ?? preview[index])} required={false}/></label>}
          <label className="field">Доля, %<MoneyField name={"weight-" + p.id} value={moneyText(old?.weight ?? ratios[index])} required={false}/></label>
        </div> : <div className="share-preview" key={p.id}><span>{p.name}</span><span>{rub(preview[index])} · {format.format(ratios[index] / 100)}%</span></div>;
      })}
    </details>
    <FormFooter error={error} busy={busy} onCancel={onCancel}/>
  </form>;
}

function ExpenseForm({ car, partners, expense, preset, error, setError, busy, onCancel, onSave }: FormProps & {
  car: Car; partners: Partner[]; expense?: Expense; preset?: string; setError: (error: string) => void; onSave: (expense: Expense) => Promise<void>;
}) {
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const amount = parseMoney(values.get("amount"));
    const name = String(values.get("name")).trim();
    if (!name || !range(amount, 1, 100_000_000_000)) { setError("Введите название и положительную сумму расхода."); return; }
    const payer = String(values.get("payer") ?? "");
    const category = expenseCategories.find(value => value === values.get("category"));
    await onSave({ id: expense?.id ?? crypto.randomUUID(), name, amount, date: String(values.get("date")),
      payer: payer || null, category });
  }
  return <form onSubmit={submit}>
    <div className="form-grid">
      <label className="field wide">На что потратили<input name="name" defaultValue={(expense?.name ?? preset)?.slice(0, 90)} placeholder="Например, комплект шин" required maxLength={90}/></label>
      <label className="field">Сумма, ₽<MoneyField name="amount" value={expense ? moneyText(expense.amount) : undefined}/></label>
      <label className="field">Дата расхода<input type="date" name="date" min={car.bought} defaultValue={expense?.date ?? (car.bought > today() ? car.bought : today())} required/></label>
      <label className="field">Статья<select name="category" defaultValue={expense?.category ?? (preset ? "Запчасти" : "")}>
        <option value="">Без статьи</option>{expenseCategories.map(category => <option key={category}>{category}</option>)}
      </select></label>
      <label className="field">Кто оплатил<select name="payer" defaultValue={expense ? expense.payer ?? "" : car.cashPurchase ? "" : car.shares[0]?.partner}>
        <option value="">Общая касса</option>{partners.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select></label>
    </div>
    <FormFooter error={error} busy={busy} onCancel={onCancel}/>
  </form>;
}

function SaleForm({ car, error, setError, busy, onCancel, onSave }: FormProps & {
  car: Car; setError: (error: string) => void; onSave: (sold: string, price: number, cashSale: boolean) => Promise<void>;
}) {
  const [priceInput, setPrice] = useState(car.price === null ? "" : moneyText(car.price));
  const price = parseMoney(priceInput);
  const profit = price - figures(car).invested;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!range(price, 1, 100_000_000_000)) { setError("Введите положительную цену продажи."); return; }
    const values = new FormData(event.currentTarget);
    const sold = String(values.get("sold"));
    if (car.shares.some(share => share.cashWithdrawalDate && share.cashWithdrawalDate < sold)) {
      setError("Дата продажи должна быть не позднее выплаты из кассы."); return;
    }
    await onSave(sold, price, values.has("cashSale"));
  }
  return <form onSubmit={submit}>
    <div className="form-grid">
      <label className="field">Дата продажи<input type="date" name="sold" min={car.bought} defaultValue={car.sold ?? (car.bought > today() ? car.bought : today())} required/></label>
      <label className="field">Цена продажи, ₽<input name="price" inputMode="decimal" value={priceInput} onChange={e => setPrice(e.target.value)} required placeholder="0" maxLength={18}/></label>
    </div>
    <label className="option-check"><input type="checkbox" name="cashSale" defaultChecked={car.cashSale ?? car.cashPurchase}/> Деньги поступили в общую кассу</label>
    {Number.isFinite(profit) && <div className="deal-bank"><CircleDollarSign size={18}/><span>Чистая прибыль</span><strong className={profitColor(profit)}>{rub(profit)}</strong></div>}
    <FormFooter error={error} busy={busy} onCancel={onCancel} submit={car.sold ? "Сохранить" : "Оформить продажу"}/>
  </form>;
}

function PartnerForm({ person, error, busy, onCancel, onSave }: FormProps & {
  person?: Partner; onSave: (name: string) => Promise<void>;
}) {
  return <form onSubmit={e => {
    e.preventDefault();
    const input = e.currentTarget.elements.namedItem("name") as HTMLInputElement;
    if (input.value.trim()) void onSave(input.value.trim());
    else { input.setCustomValidity("Введите имя партнёра."); input.reportValidity(); }
  }}>
    <label className="field">Имя и фамилия<input name="name" defaultValue={person?.name} maxLength={70} placeholder="Имя партнёра" onInput={e => e.currentTarget.setCustomValidity("")} required/></label>
    <FormFooter error={error} busy={busy} onCancel={onCancel}/>
  </form>;
}

function PayoutForm({ car, person, error, busy, onCancel, onSave }: FormProps & {
  car: Car; person?: Partner; onSave: (cashWithdrawalDate?: string) => Promise<void>;
}) {
  const [fromCash, setFromCash] = useState(Boolean(car.cashSale));
  const payment = person ? figures(car).people[person.id]?.profit ?? 0 : 0;
  return <form onSubmit={e => {
    e.preventDefault();
    const values = new FormData(e.currentTarget);
    void onSave(fromCash ? String(values.get("date")) : undefined);
  }}>
    <p className="confirm-copy">{person?.name} · {rub(payment)}</p>
    <label className="option-check"><input type="checkbox" checked={fromCash} onChange={e => setFromCash(e.target.checked)}/> Выплата из общей кассы</label>
    {fromCash && <label className="field">Дата выплаты<input type="date" name="date" min={car.sold ?? undefined}
      defaultValue={car.sold && car.sold > today() ? car.sold : today()} required/></label>}
    <FormFooter error={error} busy={busy} onCancel={onCancel} submit="Отметить выплату"/>
  </form>;
}

function CashForm({ entry, error, setError, busy, onCancel, onSave, onDelete }: FormProps & {
  entry?: CashEntry; setError: (value: string) => void; onSave: (entry: CashEntry) => Promise<void>; onDelete?: () => void;
}) {
  return <form onSubmit={e => {
    e.preventDefault();
    const values = new FormData(e.currentTarget);
    const amount = parseMoney(values.get("amount"));
    const name = String(values.get("name")).trim();
    if (!name || !range(amount, 1, 100_000_000_000)) {
      setError("Введите название и положительную сумму."); return;
    }
    void onSave({ id: entry?.id ?? crypto.randomUUID(), amount, name, date: String(values.get("date")),
      direction: values.get("direction") === "out" ? "out" : "in" });
  }}>
    <div className="form-grid">
      <label className="field">Тип<select name="direction" defaultValue={entry?.direction ?? "in"}><option value="in">Пополнение</option><option value="out">Списание</option></select></label>
      <label className="field">Сумма, ₽<MoneyField name="amount" value={entry ? moneyText(entry.amount) : undefined}/></label>
      <label className="field wide">Описание<input name="name" defaultValue={entry?.name} placeholder="Например, начальный остаток" required maxLength={120}/></label>
      <label className="field">Дата<input type="date" name="date" defaultValue={entry?.date ?? today()} required/></label>
    </div>
    {onDelete && <button className="button secondary remove-entry" type="button" onClick={onDelete} disabled={busy}><Trash2 size={16}/>Удалить движение</button>}
    <FormFooter error={error} busy={busy} onCancel={onCancel}/>
  </form>;
}

function WorkForm({ car, work, error, setError, busy, onCancel, onSave, onDelete }: FormProps & {
  car: Car; work?: WorkEntry; setError: (error: string) => void; onSave: (entry: WorkEntry) => Promise<void>; onDelete?: () => void;
}) {
  const [name, setName] = useState(work?.name ?? "");
  return <form onSubmit={event => {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    if (!name.trim()) { setError("Введите название работы."); return; }
    const expenseId = String(values.get("expense") ?? "");
    void onSave({ id:work?.id ?? crypto.randomUUID(), name:name.trim(), date:String(values.get("date")),
      notes:String(values.get("notes") ?? "").trim(), expenseId:expenseId || undefined });
  }}>
    <div className="form-grid">
      <label className="field wide">Работа<input name="name" value={name} onChange={event => setName(event.target.value)} maxLength={100}
        placeholder="Например, замена дисков и колодок" required/></label>
      <label className="field">Дата работ<input type="date" name="date" min={car.bought}
        defaultValue={work?.date ?? (car.bought > today() ? car.bought : today())} required/></label>
      {car.expenses.length > 0 && <label className="field">Связать с расходом<select name="expense" defaultValue={work?.expenseId ?? ""}
        onChange={event => { if (!name.trim()) setName(car.expenses.find(expense => expense.id === event.target.value)?.name ?? ""); }}>
        <option value="">Без привязки</option>{car.expenses.map(expense => <option key={expense.id} value={expense.id}>{expense.name}</option>)}
      </select></label>}
      <label className="field wide">Описание для отчёта<textarea name="notes" rows={3} maxLength={750}
        defaultValue={work?.notes} placeholder="Что сделали и какие детали поставили"/></label>
    </div>
    {onDelete && <button className="button secondary remove-entry" type="button" onClick={onDelete} disabled={busy}><Trash2 size={16}/>Удалить работу</button>}
    <FormFooter error={error} busy={busy} onCancel={onCancel}/>
  </form>;
}

function PartForm({ part, error, setError, busy, onCancel, onSave }: FormProps & {
  part?: CarPart; setError: (error: string) => void; onSave: (entry: CarPart) => Promise<void>;
}) {
  return <form onSubmit={event => {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const name = String(values.get("name")).trim();
    const link = String(values.get("link") ?? "").trim();
    if (!name) { setError("Укажите название запчасти."); return; }
    if (link && !/^https?:\/\//i.test(link)) { setError("Вставьте ссылку, начинающуюся с https:// или http://."); return; }
    void onSave({ id:part?.id ?? crypto.randomUUID(), name, article:String(values.get("article") ?? "").trim() || undefined,
      link:link || undefined, acquired:part?.acquired ?? false });
  }}>
    <div className="form-grid">
      <label className="field wide">Запчасть<input name="name" maxLength={140} defaultValue={part?.name} placeholder="Например, передняя левая фара" required/></label>
      <label className="field">Артикул<input name="article" maxLength={120} defaultValue={part?.article}/></label>
      <label className="field">Ссылка на объявление<input name="link" type="url" maxLength={400} defaultValue={part?.link} placeholder="https://"/></label>
    </div>
    <FormFooter error={error} busy={busy} onCancel={onCancel}/>
  </form>;
}

type VoiceInput = {
  lang: string;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start(): void;
  abort(): void;
};

function PartListForm({ error, setError, busy, onCancel, onSave }: FormProps & {
  setError: (error: string) => void; onSave: (names: string[]) => Promise<void>;
}) {
  const [value, setValue] = useState("");
  const [canDictate, setCanDictate] = useState(false);
  const [listening, setListening] = useState(false);
  const voice = useRef<VoiceInput | null>(null);
  const names = parsePartList(value);
  useEffect(() => {
    const browser = window as Window & { SpeechRecognition?: new () => VoiceInput; webkitSpeechRecognition?: new () => VoiceInput };
    const Recognizer = browser.SpeechRecognition ?? browser.webkitSpeechRecognition;
    if (!Recognizer) return;
    const engine = new Recognizer();
    voice.current = engine;
    engine.lang = "ru-RU";
    engine.onresult = event => {
      const transcript = Array.from(event.results).map(result => result[0]?.transcript).filter(Boolean).join(" ").trim();
      if (transcript) setValue(current => current ? current + "\n" + transcript : transcript);
    };
    engine.onend = () => setListening(false);
    engine.onerror = () => {
      setListening(false);
      setError("Браузер не распознал речь. Можно ввести список с клавиатуры или вставить текст.");
    };
    setCanDictate(true);
    return () => {
      engine.onend = null; engine.onerror = null; engine.onresult = null; engine.abort();
      voice.current = null;
    };
  }, [setError]);

  function startVoice() {
    try {
      setError("");
      voice.current?.start();
      setListening(true);
    } catch { setError("Диктовка недоступна. Введите список с клавиатуры."); }
  }

  return <form onSubmit={event => {
    event.preventDefault();
    if (!names.length) { setError("Введите хотя бы одну запчасть."); return; }
    if (names.some(name => name.length > 140)) { setError("Разделите длинные позиции запятыми или переносами строк."); return; }
    void onSave(names);
  }}>
    <label className="field">Запчасти<textarea value={value} onChange={event => setValue(event.target.value)} rows={5} maxLength={4000}
      placeholder={"Передний бампер\nЛевая фара\nПередние колодки"} required/></label>
    <p className="prep-help">Перенос строки или запятая разделяет позиции. На телефоне можно использовать диктовку клавиатуры.</p>
    {canDictate && <button type="button" className="button secondary voice-button" onClick={startVoice} disabled={listening || busy}>
      <Mic size={17}/>{listening ? "Слушаю…" : "Надиктовать"}</button>}
    {names.length > 0 && <div className="part-preview"><b>Позиции к добавлению · {names.length}</b>
      <ul>{names.map(name => <li key={name}>{name}</li>)}</ul></div>}
    <FormFooter error={error} busy={busy || listening} onCancel={onCancel} submit="Добавить позиции"/>
  </form>;
}

function PhotoForm({ photo, error, busy, onCancel, onSave, onDelete }: FormProps & {
  photo?: CarPhoto; onSave: (caption: string) => Promise<void>; onDelete: () => void;
}) {
  return <form onSubmit={event => {
    event.preventDefault();
    void onSave(String(new FormData(event.currentTarget).get("caption") ?? "").trim());
  }}>
    <label className="field">Подпись<input name="caption" maxLength={100} defaultValue={photo?.caption}
      placeholder="Например, передний левый угол"/></label>
    <button className="button secondary remove-entry" type="button" onClick={onDelete} disabled={busy}><Trash2 size={16}/>Удалить фото</button>
    <FormFooter error={error} busy={busy} onCancel={onCancel}/>
  </form>;
}

function ReportForm({ car, error, setError, busy, onCancel, onSave }: FormProps & {
  car: Car; setError: (error: string) => void; onSave: (amount: number | null, includeVin: boolean) => Promise<void>;
}) {
  return <form onSubmit={event => {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const raw = String(values.get("price") ?? "").trim();
    const amount = raw ? parseMoney(raw) : null;
    if (amount !== null && !range(amount, 1, 100_000_000_000)) { setError("Введите положительную цену в рублях."); return; }
    void onSave(amount, values.has("vin"));
  }}>
    <p className="confirm-copy">В отчёте будут {car.name}, пробег, история работ и фотографии из карточки. Закупочная цена, расходы и прибыль скрыты.</p>
    <label className="field">Цена для покупателя, ₽<MoneyField name="price" value={car.price ? moneyText(car.price) : car.askingPrice ? moneyText(car.askingPrice) : undefined}
      minLabel="Цена объявления" required={false}/></label>
    {car.vin && <label className="option-check"><input type="checkbox" name="vin"/> Указать VIN в отчёте</label>}
    <FormFooter error={error} busy={busy} onCancel={onCancel} submit="Скачать PDF"/>
  </form>;
}

function ProgressForm({ car, error, setError, busy, onCancel, onSave }: FormProps & {
  car: Car; setError: (message: string) => void; onSave: (edited: Car) => Promise<void>;
}) {
  return <form onSubmit={event => {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const stage = vehicleStages.find(candidate => candidate === values.get("stage"));
    const title = String(values.get("title") ?? "").trim();
    const due = String(values.get("due") ?? "");
    const amount = String(values.get("askingPrice") ?? "").trim();
    const askingPrice = amount ? parseMoney(amount) : undefined;
    if (!stage || (due && !title)) { setError("Укажите этап и название действия, если задаёте срок."); return; }
    if (askingPrice !== undefined && !range(askingPrice, 1, 100_000_000_000)) {
      setError("Введите положительную цену объявления."); return;
    }
    void onSave({ ...car, stage, askingPrice, nextAction: title ? { title, due: due || undefined } : undefined });
  }}>
    <div className="form-grid">
      <label className="field">Этап<select name="stage" defaultValue={vehicleStage(car)}>
        {vehicleStages.map(stage => <option key={stage} value={stage}>{stageNames[stage]}</option>)}
      </select></label>
      <label className="field">Цена объявления, ₽<MoneyField name="askingPrice" required={false} value={car.askingPrice ? moneyText(car.askingPrice) : undefined}/></label>
      <label className="field wide">Следующий шаг<input name="title" maxLength={120} defaultValue={car.nextAction?.title} placeholder="Например, записать на химчистку"/></label>
      <label className="field">Срок<input name="due" type="date" defaultValue={car.nextAction?.due}/></label>
    </div>
    <FormFooter error={error} busy={busy} onCancel={onCancel}/>
  </form>;
}
