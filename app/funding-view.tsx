"use client";

import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { carFunding, fundingSnapshot, fundingSources } from "./purchase-funding";
import type { FundingMode, FundingSource } from "./purchase-funding";
import type { Car, Ledger, Partner } from "./ledger";

const colors = [
  "#266b54", "#326c8c", "#9c5528", "#8b5374", "#797323", "#3a7781", "#7f503c", "#6a527f",
  "#4b7650", "#5072ab", "#b46a45", "#a34055", "#687233", "#3c7773", "#836135", "#635785",
];
const bankColor = "#6e7568";
const percent = new Intl.NumberFormat("ru-RU", { style: "percent", maximumFractionDigits: 2 });

function fundingPercent(amount: number, total: number) {
  const fraction = amount / total;
  return fraction > 0 && fraction < .00005 ? "< " + percent.format(.0001) : percent.format(fraction);
}

function fundingColor(tone: number) {
  return tone < 0 ? bankColor : colors[tone];
}

function FundingChart({ sources, amounts, rub }: {
  sources: FundingSource[]; amounts: ReadonlyMap<string | null, number>; rub: (amount: number) => string;
}) {
  const slices = sources.flatMap(source => {
    const amount = amounts.get(source.id) ?? 0;
    return amount > 0 ? [{ ...source, amount }] : [];
  });
  const total = slices.reduce((sum, slice) => sum + slice.amount, 0);

  return <div className="funding-chart">
    <div className="funding-bar" aria-hidden="true">
      {slices.map(slice => <span key={slice.tone} style={{ width: 100 * slice.amount / total + "%",
        backgroundColor: fundingColor(slice.tone) }}/>)}
    </div>
    <ul className="funding-legend">
      {slices.map(slice => <li key={slice.tone}>
        <i className="funding-swatch" aria-hidden="true" style={{ backgroundColor: fundingColor(slice.tone) }}/>
        <span>{slice.name}</span><strong>{rub(slice.amount)}</strong>
        <small>{fundingPercent(slice.amount, total)}</small>
      </li>)}
    </ul>
  </div>;
}

function FundingModes({ mode, onMode }: { mode: FundingMode; onMode: (mode: FundingMode) => void }) {
  return <div className="funding-switch" role="group" aria-label="Какие взносы показать">
    <button type="button" aria-pressed={mode === "invested"} onClick={() => onMode("invested")}>С расходами</button>
    <button type="button" aria-pressed={mode === "purchase"} onClick={() => onMode("purchase")}>Только покупка</button>
  </div>;
}

export function VehicleFunding({ car, partners, through, mode, onMode, onPortfolio, rub }: {
  car: Car; partners: Partner[]; through: string; mode: FundingMode; onMode: (mode: FundingMode) => void;
  onPortfolio?: () => void; rub: (value: number) => string;
}) {
  return <section className="vehicle-funding" aria-label="Кто вложился в авто">
    <div className="funding-heading"><h3>Кто вложился в авто</h3>
      {onPortfolio && <button className="text-button" type="button" onClick={onPortfolio}>Капитал в кассе</button>}
    </div>
    {car.bought > through ? <p className="muted">Покупка запланирована.</p> : <>
      <div className="funding-heading">
        <FundingModes mode={mode} onMode={onMode}/>
        <small className="muted">{mode === "invested" ? "По расходам на сегодня" : "По цене покупки"}</small>
      </div>
      <FundingChart sources={fundingSources(partners)} amounts={carFunding(car, through)[mode]} rub={rub}/>
    </>}
  </section>;
}

export function CapitalPortfolio({ ledger, today, mode, onMode, rub, formatDate, onCar }: {
  ledger: Ledger; today: string; mode: FundingMode; onMode: (mode: FundingMode) => void;
  rub: (value: number) => string; formatDate: (value: string) => string; onCar: (id: string) => void;
}) {
  const [includeSold, setIncludeSold] = useState(false);
  const sources = fundingSources(ledger.partners);
  const book = fundingSnapshot(ledger, today);
  const visible = includeSold ? book.cars : book.active;
  const people = sources.filter(source => source.id !== null || book.deployed.has(null));

  return <>
    <section className="panel insights-panel capital-overview" aria-labelledby="capital-title">
      <div className="section-header">
        <div><h2 id="capital-title">Капитал по партнёрам</h2><p>В машинах сейчас {rub(book.total)}. Прибыль по закрытым сделкам учитывает записанные расходы и состоявшиеся выплаты.</p></div>
      </div>
      <div className="capital-table-wrap">
        <table className="capital-table">
          <thead><tr><th scope="col">Источник</th><th scope="col">В машинах</th><th scope="col">Прибыль в банке</th></tr></thead>
          <tbody>{people.map(source => {
            const deployed = book.deployed.get(source.id) ?? 0;
            const balance = source.id === null ? null : book.balances[source.id];
            return <tr key={source.tone}>
              <th scope="row"><span className="capital-source"><i className="funding-swatch" aria-hidden="true"
                style={{ backgroundColor: fundingColor(source.tone) }}/>{source.name}</span></th>
              <td>{rub(deployed)}{book.total > 0 && <small>{fundingPercent(deployed, book.total)}</small>}</td>
              <td className={balance !== null && balance < 0 ? "negative" : undefined}>{balance === null ? "—" : rub(balance)}</td>
            </tr>;
          })}</tbody>
        </table>
        <p>Проценты в столбце «В машинах» показывают долю от вложений во все активные авто. Свободный остаток общей кассы учитывается одной суммой.</p>
      </div>
    </section>
    <section className="panel insights-panel capital-cars" aria-labelledby="funding-cars-title">
      <div className="section-header">
        <div><h2 id="funding-cars-title">Вложения по машинам</h2><p>Проценты показывают долю каждого источника в сумме по машине.</p></div>
      </div>
      <div className="capital-controls">
        <div className="funding-switch" role="group" aria-label="Какие машины показать">
          <button type="button" aria-pressed={!includeSold} onClick={() => setIncludeSold(false)}>В работе</button>
          <button type="button" aria-pressed={includeSold} onClick={() => setIncludeSold(true)}>Все машины</button>
        </div>
        <FundingModes mode={mode} onMode={onMode}/>
      </div>
      {visible.length > 0 ? <ul className="capital-car-list">{visible.map(car => {
        const amounts = carFunding(car, today)[mode];
        const total = [...amounts.values()].reduce((sum, amount) => sum + amount, 0);
        return <li key={car.id}>
          <button className="funding-open" type="button" onClick={() => onCar(car.id)}>
            <span><b>{car.name}</b><small>{formatDate(car.bought)}{car.sold && car.sold <= today ? " · Продано" : ""}</small></span>
            <strong>{rub(total)}</strong><ChevronRight size={17} aria-hidden="true"/>
          </button>
          <FundingChart sources={sources} amounts={amounts} rub={rub}/>
        </li>;
      })}</ul> : <p className="inline-empty capital-empty">{includeSold ? "В книге пока нет состоявшихся покупок." : "Сейчас нет машин в работе."}</p>}
    </section>
  </>;
}
