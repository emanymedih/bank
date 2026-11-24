import { stageHistoryEntry, vehicleStage, vehicleStages } from "./ledger";
import type { ActiveVehicleStage, Car } from "./ledger";
import { carFunding } from "./purchase-funding";

export const staleStageDays = 30;
const dayMilliseconds = 86_400_000;

export function initializeStageHistory(car: Car): Car {
  if (car.stage || car.stageHistory?.length || car.sold) return car;
  return { ...car, stage: "purchased", stageHistory: [{ stage: "purchased", date: car.bought, source: "purchase" }] };
}

export function alignPurchaseStage(car: Car): Car {
  const [first, ...later] = car.stageHistory ?? [];
  if (first?.source !== "purchase" || first.date === car.bought) return car;
  return { ...car, stageHistory: [{ ...first, date: car.bought }, ...later] };
}

export function recordStageChange(car: Car, stage: ActiveVehicleStage, date: string): Car | null {
  if (car.sold) return null;
  if (stage === vehicleStage(car)) return car;
  const history = car.stageHistory ?? [];
  const last = history.at(-1);
  const entry = stageHistoryEntry.safeParse({ stage, date });
  if (!entry.success || date < car.bought || (last && date < last.date)) return null;
  return { ...car, stage, stageHistory: [...history, entry.data] };
}

type ActivePosition = { stage: ActiveVehicleStage; since: string | null; days: number | null };
type SoldPosition = { stage: "sold"; since: string; days: number };

function calendarDays(from: string, through: string) {
  return (Date.parse(through) - Date.parse(from)) / dayMilliseconds;
}

export function stagePosition(car: Car, through: string): ActivePosition | SoldPosition | null {
  if (car.bought > through) return null;
  if (car.sold && car.sold <= through) return { stage: "sold", since: car.sold, days: calendarDays(car.sold, through) };
  const history = car.stageHistory ?? [];
  const current = history.findLast(entry => entry.date <= through);
  if (current) return { stage: current.stage, since: current.date, days: calendarDays(current.date, through) };

  const explicit = history.length ? undefined : car.stage;
  const startedWork = car.expenses.some(expense => expense.date <= through) || car.works?.some(work => work.date <= through);
  return { stage: explicit ?? (startedWork ? "preparation" : "purchased"), since: null, days: null };
}

export function stageSnapshot(cars: Car[], through: string) {
  const active = cars.flatMap(car => {
    const position = stagePosition(car, through);
    if (!position || position.stage === "sold") return [];
    const { invested } = carFunding(car, through);
    const capital = [...invested.values()].reduce((sum, amount) => sum + amount, 0);
    const stale = position.days !== null && position.days >= staleStageDays;
    return [{ car, ...position, capital, stale }];
  }).sort((a, b) => (b.days ?? -1) - (a.days ?? -1) || a.car.name.localeCompare(b.car.name, "ru"));

  const byStage = vehicleStages.map(stage => {
    const rows = active.filter(row => row.stage === stage);
    const times = rows.flatMap(row => row.days === null ? [] : [row.days]);
    return {
      stage, count: rows.length, recorded: times.length,
      averageDays: times.length ? times.reduce((sum, days) => sum + days, 0) / times.length : null,
    };
  });
  const staleCars = active.filter(row => row.stale);
  const staleCapital = staleCars.reduce((sum, row) => sum + row.capital, 0);
  return { active, byStage, staleCount: staleCars.length, staleCapital };
}
