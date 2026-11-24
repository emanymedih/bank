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
const profitPayout = z.object({ id, amount: money.positive(), date: day, fromCash: z.boolean() });
// With a cash purchase, buy attributes shared capital and creates no personal reimbursement.
const share = z.object({
  partner: id, buy: money, weight: z.number().int().min(0).max(10_000), withdrawn: z.boolean(),
  cashWithdrawalDate: day.optional(), payouts: z.array(profitPayout).max(100).optional(),
});
export const photoPhases = ["before", "work", "after"] as const;
export const maxCarPhotos = 64;
export const maxPhotoBytes = 1_200_000;
export const maxPhotosPerUpload = 8;
export const maxLedgerBytes = 750_000;
export const ledgerClientVersion = 4;

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
  acquired: z.boolean(), plannedPrice: money.positive().optional(), expenseId: id.optional(),
});
export const vehicleStages = ["purchased", "preparation", "listed"] as const;
export const stageHistoryEntry = z.object({
  stage: z.enum(vehicleStages), date: day, source: z.literal("purchase").optional(),
});
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
  stageHistory: z.array(stageHistoryEntry).optional(),
  nextAction: z.object({ title: z.string().trim().min(1).max(120), due: day.optional() }).optional(),
  askingPrice: money.positive().optional(),
  documents: vehicleDocuments.optional(),
  works: z.array(workEntry).max(100).optional(),
  photos: z.array(carPhoto).max(maxCarPhotos).optional(),
  parts: z.array(carPart).max(100).optional(),
  shares: z.array(share).min(1).max(16), expenses: z.array(expense).max(500), demo: z.boolean().optional(),
});
const cashAllocation = z.object({ partner: id, amount: money.positive() });
const cashEntry = z.object({
  id, date: day, name: z.string().trim().min(1).max(120), amount: money.positive(),
  direction: z.enum(["in", "out"]), allocations: z.array(cashAllocation).max(16).optional(),
});
const ledgerSchema = z.object({
  partners: z.array(partner).min(1).max(16), cars: z.array(vehicle).max(500),
  cashEntries: z.array(cashEntry).max(1200).optional(),
});

export type Ledger = z.infer<typeof ledgerSchema>;
export type Car = z.infer<typeof vehicle>;
export type Partner = z.infer<typeof partner>;
export type Expense = z.infer<typeof expense>;
export type ProfitPayout = z.infer<typeof profitPayout>;
export type CashEntry = z.infer<typeof cashEntry>;
export type WorkEntry = z.infer<typeof workEntry>;
export type CarPhoto = z.infer<typeof carPhoto>;
export type CarPart = z.infer<typeof carPart>;
export type PhotoPhase = CarPhoto["phase"];
export type VehicleDocuments = z.infer<typeof vehicleDocuments>;
export type ActiveVehicleStage = (typeof vehicleStages)[number];
export type VehicleStage = ActiveVehicleStage | "sold";

export const stageNames: Record<VehicleStage, string> = {
  purchased: "Куплено", preparation: "Подготовка", listed: "На продаже", sold: "Продано",
};

export function vehicleStage(car: Car, through?: string): VehicleStage {
  if (car.sold && (!through || car.sold <= through)) return "sold";
  const history = car.stageHistory;
  const stage = through && history?.length ? history.findLast(entry => entry.date <= through)?.stage : car.stage;
  const completedWork = (item: { date: string }) => !through || item.date <= through;
  return stage ?? (car.expenses.some(completedWork) || car.works?.some(completedWork) ? "preparation" : "purchased");
}

function validStageHistory(car: Car) {
  const history = car.stageHistory ?? [];
  if (!history.length) return true;
  return history.at(-1)?.stage === car.stage && history.every((entry, index) => {
    const previous = history[index - 1];
    return entry.date >= car.bought && (!car.sold || entry.date <= car.sold)
      && (!previous || (previous.date <= entry.date && previous.stage !== entry.stage))
      && (!entry.source || (index === 0 && entry.stage === "purchased" && entry.date === car.bought));
  });
}

function unique(values: string[]) {
  return new Set(values).size === values.length;
}

export function parseLedger(value: unknown): Ledger | null {
  const parsed = ledgerSchema.safeParse(value);
  if (!parsed.success) return null;
  const { cars, partners, cashEntries } = parsed.data;
  const partnerIds = new Set(partners.map(p => p.id));
  const valid = partnerIds.size === partners.length
    && unique((cashEntries ?? []).map(entry => entry.id))
    && (cashEntries ?? []).every(entry => {
      const assigned = entry.allocations ?? [];
      return unique(assigned.map(item => item.partner)) && assigned.every(item => partnerIds.has(item.partner))
        && assigned.reduce((sum, item) => sum + item.amount, 0) <= entry.amount;
    })
    && unique(cars.map(c => c.id)) && cars.every(c => {
    const payout = figures(c);
    const attributedPurchase = c.shares.reduce((sum, share) => sum + share.buy, 0);
    const workIds = new Set(c.works?.map(work => work.id));
    const photos = c.photos ?? [];
    const expenses = new Set(c.expenses.map(expense => expense.id));
    const partExpenses = (c.parts ?? []).flatMap(part => part.expenseId ? [part.expenseId] : []);
    return Boolean(c.sold) === Boolean(c.price)
      && (!c.sold || c.sold >= c.bought)
      && validStageHistory(c)
      && (!c.cashSale || c.sold !== null)
      && (attributedPurchase === c.buy || (c.cashPurchase && attributedPurchase === 0))
      && c.shares.reduce((sum, s) => sum + s.weight, 0) === 10_000
      && unique(c.shares.map(s => s.partner))
      && unique(c.expenses.map(e => e.id))
      && workIds.size === (c.works ?? []).length
      && unique((c.parts ?? []).map(part => part.id))
      && unique(partExpenses) && partExpenses.every(expenseId => expenses.has(expenseId))
      && unique(photos.map(photo => photo.id))
      && photos.every(photo => photo.phase === "work" ? Boolean(photo.workId && workIds.has(photo.workId)) : !photo.workId)
      && (c.works ?? []).every(work => work.date >= c.bought && (!work.expenseId || c.expenses.some(expense => expense.id === work.expenseId)))
      && c.shares.every(s =>
        partnerIds.has(s.partner)
        && (!s.withdrawn || (payout.people[s.partner]?.profit ?? 0) > 0)
        && (!s.cashWithdrawalDate || (s.withdrawn && c.sold && s.cashWithdrawalDate >= c.sold))
        && (!s.payouts?.length || (!s.withdrawn && c.sold
          && unique(s.payouts.map(item => item.id))
          && s.payouts.every(item => item.date >= c.sold!)
          && payout.people[s.partner].paid <= payout.people[s.partner].profit)))
      && c.expenses.every(e => (e.payer === null || partnerIds.has(e.payer)) && e.date >= c.bought);
  });
  return valid ? parsed.data : null;
}

export function validLedger(value: unknown): value is Ledger {
  return parseLedger(value) !== null;
}

export function readStoredLedger(data: string): Ledger | null {
  let value: unknown;
  try { value = JSON.parse(data); }
  catch { return null; }
  return parseLedger(value);
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

export function figures(car: Car, through?: string) {
  const paidExpenses = through ? car.expenses.filter(item => item.date <= through) : car.expenses;
  const expenses = paidExpenses.reduce((sum, item) => sum + item.amount, 0);
  const invested = car.buy + expenses;
  const net = car.price === null || (through && car.sold && car.sold > through) ? null : car.price - invested;
  const people = Object.create(null) as Record<string, { buy: number; expenses: number; profit: number; paid: number }>;
  const weights = car.shares.map(share => share.weight);
  const portions = splitAmount(net ?? 0, weights);
  // A legacy withdrawal records the whole booked profit; dated views must show the same debit as the cash journal.
  const legacy = through && net !== null && paidExpenses.length !== car.expenses.length && car.shares.some(share => share.withdrawn)
    ? splitAmount(car.price! - car.buy - car.expenses.reduce((sum, item) => sum + item.amount, 0), weights) : portions;
  for (const [index, share] of car.shares.entries()) {
    const profit = portions[index];
    const withdrawalDate = share.cashWithdrawalDate ?? car.sold;
    const paid = share.withdrawn ? (!through || withdrawalDate && withdrawalDate <= through ? legacy[index] : 0)
      : (share.payouts ?? []).reduce((sum, payment) => !through || payment.date <= through ? sum + payment.amount : sum, 0);
    people[share.partner] = { buy: car.cashPurchase ? 0 : share.buy, expenses: 0, profit, paid };
  }
  for (const item of paidExpenses) {
    if (item.payer === null) continue;
    people[item.payer] ??= { buy: 0, expenses: 0, profit: 0, paid: 0 };
    people[item.payer].expenses += item.amount;
  }
  return { expenses, invested, net, people };
}

function recordedProfitPayments(car: Car, deal: ReturnType<typeof figures>) {
  const sold = car.sold;
  if (!sold) return [];
  return car.shares.flatMap(share => {
    const legacyAmount = share.withdrawn ? deal.people[share.partner].profit : 0;
    if (legacyAmount > 0) {
      return [{ partner: share.partner, id: "legacy/" + share.partner, amount: legacyAmount,
        date: share.cashWithdrawalDate ?? sold, fromCash: Boolean(share.cashWithdrawalDate) }];
    }
    return (share.payouts ?? []).map(payment => ({ ...payment, partner: share.partner,
      id: "payment/" + JSON.stringify([share.partner, payment.id]) }));
  });
}

export function totals(ledger: Ledger, through = "9999-12-31") {
  const balances = Object.fromEntries(ledger.partners.map(p => [p.id, 0]));
  const paid = { ...balances };
  const timeline = new Map<string, { people: Record<string, number>; bank: number }>();
  let invested = 0;
  let net = 0;
  let sold = 0;
  let active = 0;
  let bank = 0;
  const add = (id: string, amount: number) => { balances[id] += amount; bank += amount; };
  const deduct = ({ partner, amount }: { partner: string; amount: number }) => {
    add(partner, -amount);
    paid[partner] += amount;
  };
  const deals = ledger.cars.filter(car => car.bought <= through).sort((a, b) =>
    (a.sold ?? "9999").localeCompare(b.sold ?? "9999") || a.bought.localeCompare(b.bought) || a.id.localeCompare(b.id))
    .map(car => {
      const deal = figures(car, through);
      const payments = recordedProfitPayments(car, figures(car)).filter(payment => payment.date <= through);
      return { car, deal, payments };
    });
  const delayed = deals.flatMap(({ car, payments }) => payments.filter(payment => car.sold && payment.date > car.sold))
    .sort((a, b) => a.date.localeCompare(b.date));
  let nextPayment = 0;

  for (const { car, deal, payments } of deals) {
    if (!car.sold || car.sold > through || deal.net === null) {
      invested += deal.invested;
      active++;
      continue;
    }
    sold++;
    net += deal.net;
    while (nextPayment < delayed.length && delayed[nextPayment].date <= car.sold) {
      deduct(delayed[nextPayment++]);
    }
    for (const [id, person] of Object.entries(deal.people)) add(id, person.profit);
    for (const payment of payments) {
      if (payment.date === car.sold) deduct(payment);
    }
    timeline.set(car.id, { people: { ...balances }, bank });
  }
  for (const payment of delayed.slice(nextPayment)) deduct(payment);

  return { balances, paid, bank, invested, net, sold, active, timeline };
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
    { ...example("demo-6", "Škoda Octavia", 2017, 112400, "2026-11-18", 1230000, null, null, [["Диагностика", 8500, "max"], ["Комплект шин", 28000, "alex"]]), stage: "listed", askingPrice: 149_000_000,
      nextAction: { title: "Показ автомобиля", due: "2026-11-23" } },
    { ...example("demo-5", "Kia Rio", 2018, 98400, "2026-11-14", 780000, null, null, [["Химчистка", 12000, "max"], ["Замена масла", 6500, "alex"]]),
      nextAction: { title: "Сделать фото для объявления", due: "2026-11-22" } },
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
        name: "Покупка · " + car.name, amount: car.buy, direction: "out",
        allocations: car.shares.filter(share => share.buy > 0).map(share => ({ partner: share.partner, amount: share.buy })) });
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
    for (const payment of recordedProfitPayments(car, deal)) {
      if (!payment.fromCash) continue;
      const name = ledger.partners.find(p => p.id === payment.partner)?.name ?? "";
      linked.push({ id: car.id + "/payout/" + payment.id, carId: car.id, source: "car", date: payment.date,
        name: "Выплата · " + name + " · " + car.name, amount: payment.amount, direction: "out",
        allocations: [{ partner: payment.partner, amount: payment.amount }] });
    }
  }

  const entries = [...manual, ...linked].sort((a, b) => b.date.localeCompare(a.date));
  let income = 0;
  let spending = 0;
  let salesIncome = 0;
  const incomeBySource = new Map<string | null, number>();
  const balanceBySource = new Map<string | null, number>();
  const accumulate = (map: Map<string | null, number>, partner: string | null, amount: number) => {
    if (amount) map.set(partner, (map.get(partner) ?? 0) + amount);
  };
  for (const entry of entries) {
    if (entry.date > through) continue;
    const incoming = entry.direction === "in";
    if (incoming) {
      income += entry.amount;
      if (entry.source === "car") salesIncome += entry.amount;
    } else spending += entry.amount;
    for (const { partner, amount } of cashEntryBreakdown(entry)) {
      accumulate(balanceBySource, partner, incoming ? amount : -amount);
      if (incoming && entry.source === "manual") accumulate(incomeBySource, partner, amount);
    }
  }
  return { entries, income, spending, balance: income - spending, salesIncome, incomeBySource, balanceBySource };
}

export function cashEntryBreakdown(entry: CashEntry) {
  const assigned = entry.allocations ?? [];
  const remaining = entry.amount - assigned.reduce((sum, item) => sum + item.amount, 0);
  const items: { partner: string | null; amount: number }[] = [...assigned];
  if (remaining > 0) items.push({ partner: null, amount: remaining });
  return items;
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

export function yearAnalytics(ledger: Ledger, year: string, through = "9999-12-31") {
  const months = Array.from({ length: 12 }, () => ({ expenses: 0, profit: 0, sales: 0 }));
  const bands = priceBands.map(band => ({ ...band, count: 0, profit: 0, invested: 0 }));
  const monthOf = (value: string) => months[Number(value.slice(5, 7)) - 1];
  for (const car of ledger.cars) {
    for (const expense of car.expenses) {
      if (expense.date <= through && expense.date.startsWith(year + "-")) monthOf(expense.date).expenses += expense.amount;
    }
    if (!car.sold?.startsWith(year + "-") || car.sold > through) continue;
    const deal = figures(car, through);
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
