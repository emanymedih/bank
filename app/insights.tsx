"use client";

import { useState } from "react";
import { BarChart3, ChevronDown, Plus, Wallet } from "lucide-react";
import { cashSummary, yearAnalytics, yearsWithActivity } from "./ledger";
import type { Ledger } from "./ledger";

const months = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];
const monthLabels = ["Янв", "Фев", "Мар", "Апр", "Май", "Июн", "Июл", "Авг", "Сен", "Окт", "Ноя", "Дек"];
const number = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 });

const color = (value: number) => value > 0 ? "positive" : value < 0 ? "negative" : "muted";

export function Analytics({ ledger, today, rub }: { ledger: Ledger; today: string; rub: (value: number) => string }) {
  const years = yearsWithActivity(ledger, today.slice(0, 4));
  const [selectedYear, setYear] = useState(years[0]);
  const year = years.includes(selectedYear) ? selectedYear : years[0];
  const results = yearAnalytics(ledger, year);
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
        <div className="chart-scroll">
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

export function CashJournal({ ledger, today, rub, formatDate, onAdd, onEdit, onCar }: {
  ledger: Ledger; today: string; rub: (value: number) => string; formatDate: (value: string) => string;
  onAdd: () => void; onEdit: (id: string) => void; onCar: (id: string) => void;
}) {
  const cash = cashSummary(ledger, today);
  return <>
    <div className="metrics analytics-metrics">
      <div className="metric hero"><span className="metric-title"><Wallet size={18}/> Доступно на покупку</span><strong>{cash.entries.length ? rub(cash.balance) : "—"}</strong><small>Остаток в кассе на сегодня</small></div>
      <div className="metric"><span className="metric-title">Поступления</span><strong>{rub(cash.income)}</strong><small>С начала учёта</small></div>
      <div className="metric"><span className="metric-title">Списания</span><strong>{rub(cash.spending)}</strong><small>С начала учёта</small></div>
    </div>
    <section className="panel insights-panel">
      <div className="section-header"><div><h2>Движение денег</h2><p>Покупки, расходы и продажи из карточек появляются здесь, когда выбрана общая касса.</p></div></div>
      {cash.entries.length ? <ul className="cash-list">{cash.entries.map(entry => <li key={entry.source + entry.id}>
        <button onClick={() => entry.source === "car" ? onCar(entry.carId) : onEdit(entry.id)}>
          <span><b>{entry.name}</b><small>{formatDate(entry.date)}{entry.date > today ? " · Запланировано" : ""}</small></span>
          <strong className={entry.direction === "in" ? "positive" : "negative"}>{entry.direction === "in" ? "+" : "−"}{rub(entry.amount)}</strong>
        </button>
      </li>)}</ul> : <div className="empty"><div className="empty-icon"><Wallet size={25}/></div><h3>Касса пока пустая</h3>
        <p>Запишите начальный остаток как пополнение. Возврат личных вложений можно записать как списание.</p>
        <button className="button primary" onClick={onAdd}><Plus size={17}/>Добавить движение</button>
      </div>}
    </section>
  </>;
}
