import type { Car } from "./ledger";
import { stageSnapshot, staleStageDays } from "./stage-history";
import { StageLabel } from "./workbench";

type StageAnalyticsProps = {
  cars: Car[];
  today: string;
  rub: (value: number) => string;
  formatDate: (value: string) => string;
  onCar?: (id: string) => void;
};

const number = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 });
const plural = new Intl.PluralRules("ru-RU", { maximumFractionDigits: 1 });

function timeOnStage(days: number) {
  const form = plural.select(days);
  return number.format(days) + (form === "one" ? " день" : form === "many" ? " дней" : " дня");
}

export function StageAnalytics({ cars, today, rub, formatDate, onCar }: StageAnalyticsProps) {
  const snapshot = stageSnapshot(cars, today);
  const tracked = snapshot.byStage.reduce((sum, stage) => sum + stage.recorded, 0);
  const unknown = snapshot.active.length - tracked;

  return <section className="panel insights-panel stage-analysis" aria-labelledby="stage-analysis-title">
    <div className="section-header">
      <div><h2 id="stage-analysis-title">Время на этапах</h2><p>Автомобили в работе на {formatDate(today)}.</p></div>
    </div>
    {snapshot.active.length > 0 ? <>
      <div className="stage-analysis-summary">
        <div><h3>Капитал в машинах без смены этапа</h3>
          <p>Покупка и расходы по авто на одном этапе {staleStageDays} дней и дольше.</p></div>
        <div><strong>{tracked ? rub(snapshot.staleCapital) : "—"}</strong>
          {tracked > 0 && <small>{snapshot.staleCount} авто</small>}</div>
      </div>
      <ul className="stage-analysis-stats" aria-label="Время по этапам">
        {snapshot.byStage.map(({ stage, count, recorded, averageDays }) => <li className="band-card" key={stage}>
          <StageLabel stage={stage}/><strong>{count} авто</strong>
          <small>{averageDays !== null ? `В среднем ${timeOnStage(averageDays)}${count !== recorded ? ` · по ${recorded} авто` : ""}`
            : count ? "Даты этапа неизвестны" : "—"}</small>
        </li>)}
      </ul>
      {unknown > 0 && <p className="stage-analysis-empty">Дата текущего этапа неизвестна у {unknown} авто. Отсчёт начнётся при смене этапа.</p>}
      <ul className="stage-analysis-cars" aria-label="Автомобили по времени на этапе">
        {snapshot.active.map(row => {
          const content = <>
            <span><b>{row.car.name}</b><StageLabel stage={row.stage}/></span>
            <span><b className={row.stale ? "negative" : undefined}>{row.days === null ? "—" : timeOnStage(row.days)}</b>
              <small>{row.since ? "С " + formatDate(row.since) : "Дата этапа неизвестна"}</small></span>
            <strong>{rub(row.capital)}</strong>
          </>;
          return <li key={row.car.id}>
            {onCar ? <button className="stage-analysis-row" type="button" onClick={() => onCar(row.car.id)}>{content}</button>
              : <div className="stage-analysis-row">{content}</div>}
          </li>;
        })}
      </ul>
    </> : <div className="empty"><p>Сейчас нет машин в работе.</p></div>}
  </section>;
}
