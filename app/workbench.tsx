"use client";

import { ArrowRight, CarFront, ChevronDown, ClipboardList, Clock3, ReceiptText, Search, Wallet } from "lucide-react";
import { figures, stageNames, vehicleStage, vehicleStages } from "./ledger";
import type { Car, Ledger, VehicleStage, totals } from "./ledger";

export type CarFilter = "all" | "active" | VehicleStage;
export type RegistryMode = "overview" | "accounts";
const stages = [...vehicleStages, "sold"] as const;

export function StageLabel({ stage }: { stage: VehicleStage }) {
  return <span className={"stage-label stage-label-" + stage}><i aria-hidden="true"/>{stageNames[stage]}</span>;
}

export function FinanceStrip({ cash, retained, invested, rub, onCash }: {
  cash: number | null; retained: number; invested: number; rub: (value: number) => string; onCash: () => void;
}) {
  return <dl className="finance-strip" aria-label="Сводка по деньгам">
    <div className="finance-cash">
      <dt><Wallet size={17} aria-hidden="true"/> Доступно на покупку</dt>
      <dd><strong>{cash === null ? "—" : rub(cash)}</strong>
        <button type="button" onClick={onCash}>{cash === null ? "Добавить остаток" : "Открыть кассу"}<ArrowRight size={15} aria-hidden="true"/></button>
      </dd>
    </div>
    <div><dt>Накопленная прибыль</dt><dd><strong>{rub(retained)}</strong></dd></div>
    <div><dt>Вложено в авто</dt><dd><strong>{rub(invested)}</strong></dd></div>
  </dl>;
}

export function StageBoard({ cars, filter, onFilter }: {
  cars: Car[]; filter: CarFilter; onFilter: (stage: CarFilter) => void;
}) {
  const counts: Record<VehicleStage, number> = { purchased: 0, preparation: 0, listed: 0, sold: 0 };
  for (const car of cars) counts[vehicleStage(car)]++;
  return <div className="stage-board" role="group" aria-label="Этапы продажи">
    {stages.map(stage => <button key={stage} type="button" className={"stage-card stage-card-" + stage}
      aria-pressed={filter === stage} onClick={() => onFilter(filter === stage ? "all" : stage)}>
      <span>{stageNames[stage]}</span><strong>{counts[stage]}</strong>
    </button>)}
  </div>;
}

function stepTiming(car: Car, today: string, dateLabel: (value: string) => string) {
  const due = car.nextAction?.due;
  if (!due) return "";
  if (due < today) return "Просрочено · " + dateLabel(due);
  return due === today ? "Сегодня" : dateLabel(due);
}

export function ActionQueue({ cars, today, dateLabel, onOpen, onPlan }: {
  cars: Car[]; today: string; dateLabel: (value: string) => string; onOpen: (id: string) => void; onPlan: (id: string) => void;
}) {
  const active = cars.filter(car => !car.sold);
  const dated = active.filter(car => car.nextAction).sort((a, b) =>
    (a.nextAction?.due ?? "9999").localeCompare(b.nextAction?.due ?? "9999"));
  const unplanned = active.filter(car => !car.nextAction);
  const visible = [...dated, ...unplanned].slice(0, 5);
  const overdue = dated.filter(car => car.nextAction?.due && car.nextAction.due < today).length;

  return <section className="action-queue" aria-labelledby="next-steps-title">
    <header><h2 id="next-steps-title">Следующие шаги</h2><Clock3 size={17} aria-hidden="true"/></header>
    {overdue > 0 && <p className="queue-overdue">{overdue} с истёкшим сроком</p>}
    {visible.length ? <ul>
      {visible.map(car => <li key={car.id}>
        <button onClick={() => car.nextAction ? onOpen(car.id) : onPlan(car.id)}>
          <span className="queue-car">{car.name}</span>
          <strong>{car.nextAction?.title ?? "Запланировать шаг"}</strong>
          {car.nextAction?.due && <small className={car.nextAction.due < today ? "negative" : ""}>{stepTiming(car, today, dateLabel)}</small>}
        </button>
      </li>)}
    </ul> : <p className="queue-empty">Шаги появятся после добавления автомобиля.</p>}
  </section>;
}

type RegistryProps = {
  cars: Car[];
  ledger: Ledger;
  summary: ReturnType<typeof totals>;
  currentDate: string;
  dateLabel: (value: string) => string;
  rub: (amount: number) => string;
  number: (amount: number) => string;
  selected: string | null;
  filter: CarFilter;
  sort: string;
  query: string;
  mode: RegistryMode;
  onFilter: (value: CarFilter) => void;
  onSort: (value: string) => void;
  onQuery: (value: string) => void;
  onMode: (value: RegistryMode) => void;
  onSelect: (id: string) => void;
  onAdd: () => void;
};

function profitText(value: number | null, rub: RegistryProps["rub"]) {
  return value === null ? "—" : (value > 0 ? "+" : "") + rub(value);
}

function tone(value: number | null) {
  return value === null || value === 0 ? "muted" : value > 0 ? "positive" : "negative";
}

function rowDescription(car: Car, props: Pick<RegistryProps, "number" | "dateLabel">) {
  return [car.year, car.registration || (car.mileage === null ? undefined : props.number(car.mileage) + " км"),
    props.dateLabel(car.bought)].filter(Boolean).join(" · ");
}

export function VehicleRegistry(props: RegistryProps) {
  const { cars, ledger, summary, currentDate, dateLabel, rub, selected, filter, sort, query, mode,
    onFilter, onSort, onQuery, onMode, onSelect, onAdd } = props;
  const filters = [
    ["all", "Все", ledger.cars.length],
    ["active", "В работе", summary.active],
  ] as const;
  const detailed = mode === "accounts";

  return <section className="panel registry work-registry" aria-labelledby="registry-title">
    <div className="registry-top">
      <h2 id="registry-title">Реестр сделок</h2>
      <div className="registry-views" role="group" aria-label="Вид реестра">
        <button className={detailed ? "" : "current"} aria-pressed={!detailed} onClick={() => onMode("overview")}>
          <ClipboardList size={16}/> Обзор
        </button>
        <button className={detailed ? "current" : ""} aria-pressed={detailed} onClick={() => onMode("accounts")}>
          <ReceiptText size={16}/> Расчёты
        </button>
      </div>
    </div>
    <div className="stage-filters" role="group" aria-label="Охват реестра">
      {filters.map(([value, label, amount]) => <button key={value} type="button" aria-pressed={filter === value}
        className={"phase-filter" + (filter === value ? " current" : "")} onClick={() => onFilter(value)}>
        <span>{label}</span><b>{amount}</b>
      </button>)}
      {filter !== "all" && filter !== "active" && <span className="registry-stage"><StageLabel stage={filter}/></span>}
    </div>
    <div className="registry-tools">
      <label className="search"><Search size={17}/><input type="search" value={query} onChange={event => onQuery(event.target.value)}
        aria-label="Поиск по авто, VIN или номеру" placeholder="Авто, VIN или госномер"/></label>
      <label className="sort"><select aria-label="Сортировка" value={sort} onChange={event => onSort(event.target.value)}>
        <option value="recent">Сначала новые</option><option value="old">Сначала старые</option><option value="profit">По прибыли</option>
      </select><ChevronDown size={15}/></label>
    </div>

    {cars.length ? <>
      <div className="table-scroll registry-table-scroll" tabIndex={0} role="region" aria-label={detailed ? "Таблица расчётов" : "Таблица автомобилей"}>
        <table className={"deal-table " + (detailed ? "accounts-table" : "browse-table")}>
          <thead><tr>
            <th scope="col">Автомобиль</th><th scope="col">Этап</th>
            {detailed ? <>
              <th scope="col">Дата покупки</th><th scope="col">Дата продажи</th>
              <th scope="col" className="num">Покупка</th><th scope="col" className="num">Расходы</th>
              <th scope="col" className="num">Продажа</th><th scope="col" className="num">Чистая прибыль</th>
              {ledger.partners.map(person => <th scope="col" key={person.id} className="num">{person.name}<small>Выплата · Остаток</small></th>)}
              <th scope="col" className="num">Накоплено</th>
            </> : <>
              <th scope="col" className="step-cell">Следующий шаг</th>
              <th scope="col" className="num invested-cell">Вложено</th>
              <th scope="col" className="num sale-cell">Продажа</th>
              <th scope="col" className="num profit-cell">Прибыль</th>
            </>}
          </tr></thead>
          <tbody>{cars.map(car => {
            const calc = figures(car);
            const snapshot = summary.timeline.get(car.id);
            return <tr key={car.id} className={car.id === selected ? "selected-row" : undefined} onClick={() => onSelect(car.id)}>
              <td><button className="vehicle" aria-current={car.id === selected ? "true" : undefined}
                onClick={event => { event.stopPropagation(); onSelect(car.id); }}>
                <span className="vehicle-icon"><CarFront size={18} aria-hidden="true"/></span>
                <span><b>{car.name}</b><small>{rowDescription(car, props)}</small></span>
              </button></td>
              <td><StageLabel stage={vehicleStage(car)}/></td>
              {detailed ? <>
                <td className="date">{dateLabel(car.bought)}</td><td className="date">{car.sold ? dateLabel(car.sold) : "—"}</td>
                <td className="num">{rub(car.buy)}</td><td className="num">{rub(calc.expenses)}</td>
                <td className="num">{car.price === null ? "—" : rub(car.price)}</td>
                <td className={"num " + tone(calc.net)}>{profitText(calc.net, rub)}</td>
                {ledger.partners.map(person => <td key={person.id} className="num">{snapshot ? <>
                  {rub(snapshot.people[person.id])}
                  {calc.people[person.id]?.profit > 0 && <small className="cell-caption">{calc.people[person.id].withdrawn ? "Забрал" : "В банке"}</small>}
                </> : "—"}</td>)}
                <td className="num">{snapshot ? rub(snapshot.bank) : "—"}</td>
              </> : <>
                <td className="step-cell">{!car.sold && car.nextAction ? <>
                  <b>{car.nextAction.title}</b>
                  {car.nextAction.due && <small className={car.nextAction.due < currentDate ? "negative" : "cell-caption"}>{stepTiming(car, currentDate, dateLabel)}</small>}
                </> : <span className="muted">—</span>}</td>
                <td className="num invested-cell">{rub(calc.invested)}</td>
                <td className="num sale-cell">{car.price === null ? car.askingPrice ? <>{rub(car.askingPrice)}<small className="cell-caption">Объявление</small></> : "—" : rub(car.price)}</td>
                <td className={"num profit-cell " + tone(calc.net)}>{profitText(calc.net, rub)}</td>
              </>}
            </tr>;
          })}</tbody>
        </table>
      </div>
      <div className="mobile-cars">{cars.map(car => {
        const calc = figures(car);
        const paid = summary.timeline.get(car.id);
        const advertised = car.price === null && car.askingPrice !== undefined;
        const salePrice = car.price ?? car.askingPrice;
        return <button key={car.id} className="mobile-car" onClick={() => onSelect(car.id)}>
          <span className="mobile-car-top"><span className="vehicle"><CarFront size={18}/><span>
            <b>{car.name}</b><small>{rowDescription(car, props)}</small>
          </span></span><StageLabel stage={vehicleStage(car)}/></span>
          {!detailed && !car.sold && car.nextAction && <span className="mobile-step">
            <b>{car.nextAction.title}</b><small>{stepTiming(car, currentDate, dateLabel)}</small>
          </span>}
          <span className="mobile-car-bottom">
            <span><small>{detailed ? "Покупка" : "Вложено"}</small><b>{rub(detailed ? car.buy : calc.invested)}</b></span>
            <span><small>{detailed ? "Расходы" : advertised ? "Объявление" : "Продажа"}</small>
              <b>{detailed ? rub(calc.expenses) : salePrice === undefined ? "—" : rub(salePrice)}</b>
            </span>
            <span><small>Прибыль</small><b className={tone(calc.net)}>{profitText(calc.net, rub)}</b></span>
          </span>
          {detailed && paid && <span className="mobile-account-balances">
            {ledger.partners.map(person => <span key={person.id}>{person.name} · {rub(paid.people[person.id])}
              {calc.people[person.id]?.withdrawn ? " · забрал" : ""}</span>)}
            <strong>Накоплено · {rub(paid.bank)}</strong>
          </span>}
        </button>;
      })}</div>
    </> : <div className="empty registry-empty">
      <CarFront size={25}/><h3>{ledger.cars.length ? "Автомобили не найдены" : "В книге пока нет автомобилей"}</h3>
      {ledger.cars.length ? <button className="button secondary" onClick={() => { onQuery(""); onFilter("all"); }}>Сбросить фильтры</button>
      : <button className="button primary" onClick={onAdd}>Добавить авто</button>}
    </div>}
    <footer className="table-footer"><span>{cars.length} из {ledger.cars.length} автомобилей</span><span>Суммы в рублях</span></footer>
  </section>;
}
