"use client";

import { useState } from "react";
import { BarChart3, ChevronDown, ChevronRight, Plus, Wallet } from "lucide-react";
import { cashEntryBreakdown, cashSummary, yearAnalytics, yearsWithActivity } from "./ledger";
import type { Ledger } from "./ledger";
import { CapitalPortfolio } from "./funding-view";
import { purchaseContributionWeights } from "./purchase-funding";
import type { FundingMode } from "./purchase-funding";

const months = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];
const monthLabels = ["Янв", "Фев", "Мар", "Апр", "Май", "Июн", "Июл", "Авг", "Сен", "Окт", "Ноя", "Дек"];
const number = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 });

const color = (value: number) => value > 0 ? "positive" : value < 0 ? "negative" : "muted";

export function Analytics({ ledger, today, rub }: { ledger: Ledger; today: string; rub: (value: number) => string }) {
  const years = yearsWithActivity(ledger, today.slice(0, 4));
  const [selectedYear, setYear] = useState(years[0]);
  const year = years.includes(selectedYear) ? selectedYear : years[0];
  const results = yearAnalytics(ledger, year, today);
  const [monthIndex, setMonth] = useState<number | null>(null);
  const lastActive = results.months.findLastIndex(month => month.sales > 0 || month.expenses > 0);
  const selected = monthIndex ?? (lastActive >= 0 ? lastActive : Number(today.slice(5, 7)) - 1);
  const current = results.months[selected];
  const high = Math.max(1, ...results.months.flatMap(m => [m.profit, m.expenses]));
  const low = Math.max(0, ...results.months.map(m => -m.profit));
  const below = low ? 100 * low / (low + high) : 0;
  const plot = (value: number) => ({ height: Math.abs(value) / (high + low) * 100 + "%", bottom: value < 0 ? (below + value / (high + low) * 100) + "%" : below + "%" });
  const hasActivity = results.expenses > 0 || results.sales > 0;

  return <>
    <div className="metrics analytics-metrics">
      <div className="metric hero"><span className="metric-title"><BarChart3 size={18}/> Чистая прибыль за год</span><strong>{rub(results.profit)}</strong><small>По завершённым сделкам</small></div>
      <div className="metric"><span className="metric-title">Расходы на автомобили</span><strong>{rub(results.expenses)}</strong><small>Работы, запчасти и другие расходы</small></div>
      <div className="metric"><span className="metric-title">Продано за год</span><strong>{results.sales} <span className="unit">авто</span></strong><small>{results.sales ? rub(Math.round(results.profit / results.sales)) + " в среднем на авто" : "Продаж пока нет"}</small></div>
    </div>
    <section className="panel insights-panel">
      <div className="section-header insights-heading">
        <div><h2>По месяцам</h2><p>Расходы по дате оплаты, прибыль по дате продажи.</p></div>
        <label className="sort year-filter"><select aria-label="Год отчёта" value={year} onChange={e => { setYear(e.target.value); setMonth(null); }}>
          {years.map(value => <option key={value}>{value}</option>)}
        </select><ChevronDown size={15}/></label>
      </div>
      {hasActivity ? <div className="chart-content">
        <div className="chart-key"><span><i className="key-expense"/>Расходы</span><span><i className="key-profit"/>Чистая прибыль</span>{low > 0 && <span><i className="key-loss"/>Убыток</span>}</div>
        <div className="chart-scroll" tabIndex={0} role="region" aria-label="График по месяцам">
          <div className="chart" role="group" aria-label={"Показатели по месяцам за " + year + " год"}>
            {results.months.map((month, index) => <button key={months[index]} type="button" className={index === selected ? "chart-month selected" : "chart-month"}
              aria-pressed={index === selected} aria-label={months[index] + ", расходы " + rub(month.expenses) + ", чистая прибыль " + rub(month.profit)}
              onClick={() => setMonth(index)}>
              <span className="chart-bars">
                <i className="chart-baseline" style={{ bottom: below + "%" }}/>
                {month.expenses > 0 && <i className="chart-bar bar-expense" style={plot(month.expenses)}/>}
                {month.profit !== 0 && <i className={"chart-bar " + (month.profit < 0 ? "bar-loss" : "bar-profit")} style={plot(month.profit)}/>}
              </span>
              <span>{monthLabels[index]}</span>
            </button>)}
          </div>
        </div>
        <div className="month-summary" aria-live="polite">
          <b>{months[selected]}</b><div><small>Расходы</small><strong>{rub(current.expenses)}</strong></div>
          <div><small>Чистая прибыль</small><strong className={color(current.profit)}>{rub(current.profit)}</strong></div>
          <div><small>Продано</small><strong>{current.sales}</strong></div>
        </div>
      </div> : <div className="empty"><p>За этот год пока нет расходов и продаж.</p></div>}
    </section>
    <section className="panel insights-panel">
      <div className="section-header"><div><h2>Прибыль по бюджету покупки</h2><p>Средняя прибыль и рентабельность по проданным автомобилям.</p></div></div>
      <div className="band-grid">{results.bands.map(band => <div className="band-card" key={band.title}>
        <b>{band.title}</b><span>Продано · {band.count}</span>
        <strong className={color(band.profit)}>{band.count ? rub(Math.round(band.profit / band.count)) : "—"}</strong>
        <small>Средняя прибыль на авто</small>
        <div>Рентабельность <b>{band.invested ? number.format(band.profit / band.invested * 100) + "%" : "—"}</b></div>
      </div>)}</div>
    </section>
  </>;
}

export type CashTab = "journal" | "income" | "spending" | "capital";

const cashPercent = new Intl.NumberFormat("ru-RU", { style: "percent", maximumFractionDigits: 2 });

export function CashJournal({ ledger, today, rub, formatDate, onAdd, onEdit, onCar, tab, onTab, mode, onMode }: {
  ledger: Ledger; today: string; rub: (value: number) => string; formatDate: (value: string) => string;
  onAdd: () => void; onEdit: (id: string) => void; onCar: (id: string) => void;
  tab: CashTab; onTab: (tab: CashTab) => void; mode: FundingMode; onMode: (mode: FundingMode) => void;
}) {
  const cash = cashSummary(ledger, today);
  const partnerName = (id: string | null) => id === null ? "Без распределения" : ledger.partners.find(p => p.id === id)?.name ?? "";
  const rows = cash.entries.filter(entry => tab === "income" ? entry.direction === "in"
    : tab === "spending" ? entry.direction === "out" : true);
  const sources = ledger.partners.flatMap(person => {
    const amount = cash.incomeBySource.get(person.id);
    return amount ? [{ name: person.name, amount }] : [];
  });
  const unassigned = cash.incomeBySource.get(null) ?? 0;
  if (unassigned) sources.push({ name: "Без распределения", amount: unassigned });
  if (cash.salesIncome) sources.push({ name: "Продажи авто", amount: cash.salesIncome });
  const shares = purchaseContributionWeights(sources.map(source => source.amount));

  return <>
    <div className="metrics analytics-metrics">
      <div className="metric hero"><span className="metric-title"><Wallet size={18}/> Доступно на покупку</span><strong>{cash.entries.length ? rub(cash.balance) : "—"}</strong><small>Остаток в кассе на сегодня</small></div>
      <button className="metric cash-drilldown" type="button" aria-pressed={tab === "income"} onClick={() => onTab(tab === "income" ? "journal" : "income")}>
        <span className="metric-title">Поступления <ChevronRight size={17} aria-hidden="true"/></span><strong>{rub(cash.income)}</strong><small>Разбивка по источникам</small>
      </button>
      <button className="metric cash-drilldown" type="button" aria-pressed={tab === "spending"} onClick={() => onTab(tab === "spending" ? "journal" : "spending")}>
        <span className="metric-title">Списания <ChevronRight size={17} aria-hidden="true"/></span><strong>{rub(cash.spending)}</strong><small>Операции с начала учёта</small>
      </button>
    </div>
    <div className="funding-switch cash-tabs" role="group" aria-label="Раздел кассы">
      <button type="button" aria-pressed={tab !== "capital"} onClick={() => onTab("journal")}>Движение денег</button>
      <button type="button" aria-pressed={tab === "capital"} onClick={() => onTab("capital")}>Капитал в авто</button>
    </div>
    {tab === "capital" ? <CapitalPortfolio ledger={ledger} today={today} mode={mode} onMode={onMode}
      rub={rub} formatDate={formatDate} onCar={onCar}/> : <>
      {tab === "income" && <section className="panel insights-panel" aria-labelledby="cash-income-title">
        <div className="section-header">
          <div><h2 id="cash-income-title">Из чего сложились поступления</h2><p>Суммы и доли от всех поступлений на сегодня.</p></div>
        </div>
        {sources.length ? <dl className="cash-source-list">{sources.map((source, index) => <div key={index}>
          <dt>{source.name}</dt><dd>{rub(source.amount)} <small>{cashPercent.format(shares[index] / 10_000)}</small></dd>
        </div>)}</dl> : <p className="cash-source-list">Проведённых поступлений пока нет.</p>}
        {unassigned > 0 && <p className="cash-source-list cash-source-hint">Откройте нужное пополнение ниже, чтобы указать, кто внёс деньги.</p>}
      </section>}
      <section className="panel insights-panel">
        <div className="section-header"><div><h2>{tab === "income" ? "Журнал поступлений" : tab === "spending" ? "Журнал списаний" : "Движение денег"}</h2>
          {tab === "journal" && <p>Здесь видны ручные движения и операции по автомобилям, проведённые через общую кассу.</p>}</div></div>
        {rows.length ? <ul className="cash-list">{rows.map(entry => <li key={entry.source + entry.id}>
          <button onClick={() => entry.source === "car" ? onCar(entry.carId) : onEdit(entry.id)}>
            <span><b>{entry.name}</b><small>{formatDate(entry.date)}{entry.date > today ? " · Запланировано" : ""}</small>
              {(entry.allocations?.length || entry.source === "manual" && entry.direction === "in") ?
                <small className="cash-entry-source">{cashEntryBreakdown(entry).map(item => partnerName(item.partner) + " · " + rub(item.amount)).join(" / ")}</small>
                : null}
            </span>
            <strong className={entry.direction === "in" ? "positive" : "negative"}>{entry.direction === "in" ? "+" : "−"}{rub(entry.amount)}</strong>
          </button>
        </li>)}</ul> : <div className="empty"><div className="empty-icon"><Wallet size={25}/></div><h3>{tab === "journal" ? "Касса пока пустая" : "Операций пока нет"}</h3>
          <button className="button primary" onClick={onAdd}><Plus size={17}/>Добавить движение</button>
        </div>}
      </section>
    </>}
  </>;
}
