import { z } from "zod";

const money = z.number().int().min(0).max(100_000_000_000);
const id = z.string().min(1).max(80);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const date = new Date(value);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
});
const partner = z.object({ id, name: z.string().trim().min(1).max(70) });
export const expenseCategories = ["Работы", "Запчасти", "Шины", "Реклама", "Транспорт", "Прочее"] as const;

const expense = z.object({
  id, name: z.string().trim().min(1).max(90), date: day, amount: money.positive(),
  payer: id.nullable(), category: z.enum(expenseCategories).optional(),
});
const share = z.object({
  partner: id, buy: money, weight: z.number().int().min(0).max(10_000), withdrawn: z.boolean(),
  cashWithdrawalDate: day.optional(),
});
export const photoPhases = ["before", "work", "after"] as const;
export const maxCarPhotos = 64;
export const maxPhotoBytes = 1_200_000;
export const maxPhotosPerUpload = 8;

const workEntry = z.object({
  id, name: z.string().trim().min(1).max(100), date: day, notes: z.string().trim().max(750),
  expenseId: id.optional(),
});
const carPhoto = z.object({
  id: z.string().uuid(), phase: z.enum(photoPhases), workId: id.optional(),
  caption: z.string().trim().max(100).optional(),
});
const partLink = z.string().max(400).refine(value => {
  try { return ["https:", "http:"].includes(new URL(value).protocol); }
  catch { return false; }
});
const carPart = z.object({
  id, name: z.string().trim().min(1).max(140),
  article: z.string().trim().max(120).optional(), link: partLink.optional(),
  acquired: z.boolean(),
});
export const vehicleStages = ["purchased", "preparation", "listed"] as const;
const detail = z.string().trim().max(120).optional();
const vehicleDocuments = z.object({
  color: detail, type: detail, body: detail, chassis: detail, engine: detail,
  pts: detail, ptsIssuer: detail, ptsDate: day.optional(), sts: detail,
});
const vehicle = z.object({
  id, name: z.string().trim().min(1).max(90), vin: z.string().max(32),
  registration: z.string().max(16).regex(/^[A-ZА-ЯЁ0-9]*$/u).optional(),
  year: z.number().int().min(1880).max(2100).nullable().optional(),
  mileage: z.number().int().min(0).max(10_000_000).nullable(),
  bought: day, buy: money.positive(), sold: day.nullable(), price: money.positive().nullable(),
  cashPurchase: z.boolean().optional(), cashSale: z.boolean().optional(),
  stage: z.enum(vehicleStages).optional(),
  nextAction: z.object({ title: z.string().trim().min(1).max(120), due: day.optional() }).optional(),
  askingPrice: money.positive().optional(),
  documents: vehicleDocuments.optional(),
  works: z.array(workEntry).max(100).optional(),
  photos: z.array(carPhoto).max(maxCarPhotos).optional(),
  parts: z.array(carPart).max(100).optional(),
  shares: z.array(share).min(1).max(16), expenses: z.array(expense).max(500), demo: z.boolean().optional(),
});
const cashEntry = z.object({
  id, date: day, name: z.string().trim().min(1).max(120), amount: money.positive(),
  direction: z.enum(["in", "out"]),
});
const ledgerSchema = z.object({
  partners: z.array(partner).min(1).max(16), cars: z.array(vehicle).max(500),
  cashEntries: z.array(cashEntry).max(1200).optional(),
});

export type Ledger = z.infer<typeof ledgerSchema>;
export type Car = z.infer<typeof vehicle>;
export type Partner = z.infer<typeof partner>;
export type Expense = z.infer<typeof expense>;
export type CashEntry = z.infer<typeof cashEntry>;
export type WorkEntry = z.infer<typeof workEntry>;
export type CarPhoto = z.infer<typeof carPhoto>;
export type CarPart = z.infer<typeof carPart>;
export type PhotoPhase = CarPhoto["phase"];
export type VehicleDocuments = z.infer<typeof vehicleDocuments>;
export type VehicleStage = (typeof vehicleStages)[number] | "sold";

export const stageNames: Record<VehicleStage, string> = {
  purchased: "Куплено", preparation: "Подготовка", listed: "На продаже", sold: "Продано",
};

export function vehicleStage(car: Car): VehicleStage {
  return car.sold ? "sold" : car.stage ?? (car.expenses.length || car.works?.length ? "preparation" : "purchased");
}

function unique(values: string[]) {
  return new Set(values).size === values.length;
}

export function validLedger(value: unknown): value is Ledger {
  const parsed = ledgerSchema.safeParse(value);
  if (!parsed.success) return false;
  const { cars, partners, cashEntries } = parsed.data;
  const partnerIds = new Set(partners.map(p => p.id));
  return partnerIds.size === partners.length
    && unique((cashEntries ?? []).map(entry => entry.id))
    && unique(cars.map(c => c.id)) && cars.every(c => {
    const payout = figures(c);
    const workIds = new Set(c.works?.map(work => work.id));
    const photos = c.photos ?? [];
    return Boolean(c.sold) === Boolean(c.price)
      && (!c.sold || c.sold >= c.bought)
      && (!c.cashSale || c.sold !== null)
      && c.shares.reduce((sum, s) => sum + s.buy, 0) === (c.cashPurchase ? 0 : c.buy)
      && c.shares.reduce((sum, s) => sum + s.weight, 0) === 10_000
      && unique(c.shares.map(s => s.partner))
      && unique(c.expenses.map(e => e.id))
      && workIds.size === (c.works ?? []).length
      && unique((c.parts ?? []).map(part => part.id))
      && unique(photos.map(photo => photo.id))
      && photos.every(photo => photo.phase === "work" ? Boolean(photo.workId && workIds.has(photo.workId)) : !photo.workId)
      && (c.works ?? []).every(work => work.date >= c.bought && (!work.expenseId || c.expenses.some(expense => expense.id === work.expenseId)))
      && c.shares.every(s =>
        partnerIds.has(s.partner)
        && (!s.withdrawn || (payout.people[s.partner]?.profit ?? 0) > 0)
        && (!s.cashWithdrawalDate || (s.withdrawn && c.sold && s.cashWithdrawalDate >= c.sold)))
      && c.expenses.every(e => (e.payer === null || partnerIds.has(e.payer)) && e.date >= c.bought);
  });
}

export function splitAmount(total: number, weights: number[]) {
  const positive = Math.abs(total);
  const whole = Math.floor(positive / 10_000);
  const remainder = positive % 10_000;
  const results = weights.map(weight => whole * weight + Math.floor(remainder * weight / 10_000));
  const priority = weights.map((weight, index) => ({ index, fraction: (remainder * weight) % 10_000 }))
    .sort((a, b) => b.fraction - a.fraction);
  const extra = positive - results.reduce((sum, result) => sum + result, 0);
  for (const { index } of priority.slice(0, extra)) results[index]++;
  return total < 0 ? results.map(value => -value) : results;
}

export function figures(car: Car) {
  const expenses = car.expenses.reduce((sum, item) => sum + item.amount, 0);
  const invested = car.buy + expenses;
  const net = car.price === null ? null : car.price - invested;
  const people = Object.create(null) as Record<string, { buy: number; expenses: number; profit: number; withdrawn: boolean }>;
  const portions = splitAmount(net ?? 0, car.shares.map(s => s.weight));
  for (const [index, share] of car.shares.entries()) {
    people[share.partner] = { buy: share.buy, expenses: 0, profit: portions[index], withdrawn: share.withdrawn };
  }
  for (const item of car.expenses) {
    if (item.payer === null) continue;
    people[item.payer] ??= { buy: 0, expenses: 0, profit: 0, withdrawn: false };
    people[item.payer].expenses += item.amount;
  }
  return { expenses, invested, net, people };
}

export function totals(ledger: Ledger) {
  const balances = Object.fromEntries(ledger.partners.map(p => [p.id, 0]));
  const timeline = new Map<string, { people: Record<string, number>; bank: number }>();
  let invested = 0;
  let net = 0;
  let sold = 0;
  let bank = 0;

  for (const car of [...ledger.cars].sort((a, b) =>
    (a.sold ?? "9999").localeCompare(b.sold ?? "9999") || a.bought.localeCompare(b.bought) || a.id.localeCompare(b.id))) {
    const deal = figures(car);
    if (deal.net === null) {
      invested += deal.invested;
      continue;
    }
    sold++;
    net += deal.net;
    for (const [id, person] of Object.entries(deal.people)) {
      if (!person.withdrawn) {
        balances[id] += person.profit;
        bank += person.profit;
      }
    }
    timeline.set(car.id, { people: { ...balances }, bank });
  }

  return { balances, bank, invested, net, sold, active: ledger.cars.length - sold, timeline };
}

export function defaultWeights(count: number) {
  const base = Math.floor(10_000 / count);
  const extra = 10_000 - base * count;
  return Array.from({ length: count }, (_, index) => base + Number(index < extra));
}

const initialPartners = [
  { id: "max", name: "Партнёр 1" },
  { id: "alex", name: "Партнёр 2" },
];

function example(id: string, name: string, year: number, mileage: number, bought: string, buy: number,
  sold: string | null, price: number | null, costs: [string, number, string][], paid: boolean[] = []): Car {
  return {
    id, name, demo: true, vin: "", year, mileage, bought, buy: buy * 100, sold, price: price === null ? null : price * 100,
    expenses: costs.map(([title, amount, payer], i) => ({ id: id + "-" + i, name: title, amount: amount * 100, payer, date: bought })),
    shares: initialPartners.map((person, i) => ({ partner: person.id, buy: buy * 50, weight: 5000, withdrawn: paid[i] ?? false })),
  };
}

export const initialLedger: Ledger = {
  partners: initialPartners,
  cars: [
    { ...example("demo-6", "Škoda Octavia", 2017, 112400, "2026-11-18", 1230000, null, null, [["Диагностика", 8500, "max"], ["Комплект шин", 28000, "alex"]]), stage: "listed", askingPrice: 149_000_000 },
    example("demo-5", "Kia Rio", 2018, 98400, "2026-11-14", 780000, null, null, [["Химчистка", 12000, "max"], ["Замена масла", 6500, "alex"]]),
    example("demo-4", "Hyundai Solaris", 2016, 105000, "2026-10-28", 840000, "2026-11-12", 1015000, [["Кузовные работы", 22000, "max"], ["ТО", 10500, "alex"]]),
    example("demo-3", "Lada 2108", 1998, 176000, "2026-10-23", 145000, "2026-11-08", 215000, [["Запчасти", 15000, "alex"]], [true, false]),
    example("demo-2", "Škoda Fabia", 2013, 139600, "2026-10-12", 1000000, "2026-11-04", 1500000, [["Шины", 30000, "max"], ["Подготовка", 70000, "alex"]], [true, false]),
    example("demo-1", "Renault Logan", 2012, 126300, "2026-10-01", 515000, "2026-10-20", 625000, [["Ремонт", 21000, "max"], ["Химчистка", 6500, "alex"]], [false, true]),
  ],
};


export const emptyLedger: Ledger = { partners: [{ id: "self", name: "Я" }], cars: [], cashEntries: [] };

export function cashSummary(ledger: Ledger, through: string) {
  const manual = (ledger.cashEntries ?? []).map(entry => ({ ...entry, source: "manual" as const }));
  const linked: Array<CashEntry & { source: "car"; carId: string }> = [];

  for (const car of ledger.cars) {
    if (car.cashPurchase) {
      linked.push({ id: car.id + "/buy", carId: car.id, source: "car", date: car.bought,
        name: "Покупка · " + car.name, amount: car.buy, direction: "out" });
    }
    if (car.cashSale && car.sold && car.price !== null) {
      linked.push({ id: car.id + "/sale", carId: car.id, source: "car", date: car.sold,
        name: "Продажа · " + car.name, amount: car.price, direction: "in" });
    }
    for (const expense of car.expenses) {
      if (expense.payer === null) {
        linked.push({ id: car.id + "/expense/" + expense.id, carId: car.id, source: "car",
          date: expense.date, name: expense.name + " · " + car.name, amount: expense.amount, direction: "out" });
      }
    }
    const deal = figures(car);
    for (const share of car.shares) {
      if (share.withdrawn && share.cashWithdrawalDate && deal.people[share.partner]?.profit > 0) {
        const name = ledger.partners.find(p => p.id === share.partner)?.name ?? "";
        linked.push({ id: car.id + "/payout/" + share.partner, carId: car.id, source: "car", date: share.cashWithdrawalDate,
          name: "Выплата · " + name + " · " + car.name, amount: deal.people[share.partner].profit, direction: "out" });
      }
    }
  }

  const entries = [...manual, ...linked].sort((a, b) => b.date.localeCompare(a.date));
  let income = 0;
  let spending = 0;
  for (const entry of entries) {
    if (entry.date > through) continue;
    if (entry.direction === "in") income += entry.amount;
    else spending += entry.amount;
  }
  return { entries, income, spending, balance: income - spending };
}

const priceBands = [
  { title: "До 1 млн ₽", ceiling: 100_000_000 },
  { title: "1–2 млн ₽", ceiling: 200_000_000 },
  { title: "2–3 млн ₽", ceiling: 300_000_000 },
  { title: "Свыше 3 млн ₽", ceiling: Infinity },
];

export function yearsWithActivity(ledger: Ledger, currentYear: string) {
  const years = new Set([currentYear]);
  for (const car of ledger.cars) {
    years.add(car.bought.slice(0, 4));
    if (car.sold) years.add(car.sold.slice(0, 4));
    for (const expense of car.expenses) years.add(expense.date.slice(0, 4));
  }
  return [...years].sort((a, b) => b.localeCompare(a));
}

export function yearAnalytics(ledger: Ledger, year: string) {
  const months = Array.from({ length: 12 }, () => ({ expenses: 0, profit: 0, sales: 0 }));
  const bands = priceBands.map(band => ({ ...band, count: 0, profit: 0, invested: 0 }));
  const monthOf = (value: string) => months[Number(value.slice(5, 7)) - 1];
  for (const car of ledger.cars) {
    for (const expense of car.expenses) {
      if (expense.date.startsWith(year + "-")) monthOf(expense.date).expenses += expense.amount;
    }
    if (!car.sold?.startsWith(year + "-")) continue;
    const deal = figures(car);
    if (deal.net === null) continue;
    const month = monthOf(car.sold);
    month.sales++;
    month.profit += deal.net;
    const band = bands.find(band => car.buy <= band.ceiling);
    if (band) {
      band.count++;
      band.profit += deal.net;
      band.invested += deal.invested;
    }
  }
  return {
    months,
    bands,
    expenses: months.reduce((total, month) => total + month.expenses, 0),
    profit: months.reduce((total, month) => total + month.profit, 0),
    sales: months.reduce((total, month) => total + month.sales, 0),
  };
}
