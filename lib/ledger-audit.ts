import type { Car, Ledger } from "../app/ledger";

// Аудит книги: чистый diff «было/стало» по денежным сущностям.
// Значения хранятся как есть (деньги — целые копейки), подписи полей — в fieldLabels.

export type AuditEntity = "car" | "expense" | "cash" | "partner" | "payout" | "task" | "part";
export type AuditAction = "create" | "update" | "delete";
export type AuditRow = {
  entity: AuditEntity;
  entityId: string;
  entityName: string;
  carId: string | null;
  action: AuditAction;
  field: string | null;
  before: unknown;
  after: unknown;
};

export const fieldLabels: Record<string, string> = {
  name: "Название", date: "Дата", amount: "Сумма", direction: "Направление",
  allocations: "Распределение", bought: "Дата покупки", buy: "Цена покупки",
  sold: "Дата продажи", price: "Цена продажи", stage: "Этап",
  askingPrice: "Цена в объявлении", cashPurchase: "Покупка из кассы", cashSale: "Продажа в кассу",
  registration: "Госномер", shares: "Доли участников", payer: "Кто оплатил",
  category: "Категория", fromCash: "Из кассы",
  title: "Название", due: "Срок", done: "Выполнено", listingUrl: "Ссылка на объявление",
  plannedPrice: "Плановая цена", acquired: "Куплена", article: "Артикул",
};

export const entityLabels: Record<AuditEntity, string> = {
  car: "Автомобиль", expense: "Расход", cash: "Касса", partner: "Партнёр", payout: "Выплата",
  task: "Задача", part: "Запчасть",
};

const norm = (value: unknown) => value === undefined ? null : value;
const same = (a: unknown, b: unknown) => JSON.stringify(norm(a)) === JSON.stringify(norm(b));

function updateRows(
  entity: AuditEntity, entityId: string, entityName: string, carId: string | null,
  before: Record<string, unknown>, after: Record<string, unknown>, fields: string[],
): AuditRow[] {
  const rows: AuditRow[] = [];
  for (const field of fields) {
    if (!same(before[field], after[field])) {
      rows.push({ entity, entityId, entityName, carId, action: "update", field, before: norm(before[field]), after: norm(after[field]) });
    }
  }
  return rows;
}

const carFields = ["name", "registration", "bought", "buy", "sold", "price", "stage", "askingPrice", "cashPurchase", "cashSale", "listingUrl"];
const cashFields = ["name", "date", "amount", "direction", "allocations"];
const expenseFields = ["name", "date", "amount", "payer", "category"];
const payoutFields = ["amount", "date", "fromCash"];

const carSnapshot = (car: Car) => ({ name: car.name, buy: car.buy, bought: car.bought, sold: norm(car.sold), price: norm(car.price) });
// Этап мог быть не записан явно (легаси) — выводим из истории, чтобы «было» не было пустым.
const derivedStage = (car: Car) => car.sold ? "sold" : car.stageHistory?.length ? car.stageHistory[car.stageHistory.length - 1].stage : car.stage ?? "purchased";
const sharesProjection = (car: Car) => car.shares.map(share => ({ partner: share.partner, buy: share.buy, weight: share.weight, withdrawn: share.withdrawn }));

type PayoutRef = { id: string; amount: number; date: string; fromCash: boolean; partnerName: string };
function payoutsOf(car: Car, partners: Ledger["partners"]): PayoutRef[] {
  const names = new Map(partners.map(partner => [partner.id, partner.name]));
  return car.shares.flatMap(share => (share.payouts ?? []).map(payout => ({
    id: payout.id, amount: payout.amount, date: payout.date, fromCash: payout.fromCash,
    partnerName: names.get(share.partner) ?? share.partner,
  })));
}

const taskFields = ["title", "due", "done"];
const partFields = ["name", "article", "plannedPrice", "acquired"];
const taskSnapshot = (item: { title: string; due?: string; done: boolean; author?: string }) => ({ title: item.title, due: norm(item.due), done: item.done, author: norm(item.author) });
const partSnapshot = (item: { name: string; plannedPrice?: number; acquired: boolean }) => ({ name: item.name, plannedPrice: norm(item.plannedPrice), acquired: item.acquired });

function diffTasks(before: Car, after: Car): AuditRow[] {
  const rows: AuditRow[] = [];
  const beforeById = new Map((before.tasks ?? []).map(item => [item.id, item]));
  const afterById = new Map((after.tasks ?? []).map(item => [item.id, item]));
  for (const item of after.tasks ?? []) {
    const previous = beforeById.get(item.id);
    if (!previous) rows.push({ entity: "task", entityId: item.id, entityName: item.title, carId: after.id, action: "create", field: null, before: null, after: taskSnapshot(item) });
    else rows.push(...updateRows("task", item.id, item.title, after.id, previous, item, taskFields));
  }
  for (const item of before.tasks ?? []) {
    if (!afterById.has(item.id)) rows.push({ entity: "task", entityId: item.id, entityName: item.title, carId: after.id, action: "delete", field: null, before: taskSnapshot(item), after: null });
  }
  return rows;
}

function diffParts(before: Car, after: Car): AuditRow[] {
  const rows: AuditRow[] = [];
  const beforeById = new Map((before.parts ?? []).map(item => [item.id, item]));
  const afterById = new Map((after.parts ?? []).map(item => [item.id, item]));
  for (const item of after.parts ?? []) {
    const previous = beforeById.get(item.id);
    if (!previous) rows.push({ entity: "part", entityId: item.id, entityName: item.name, carId: after.id, action: "create", field: null, before: null, after: partSnapshot(item) });
    else rows.push(...updateRows("part", item.id, item.name, after.id, previous, item, partFields));
  }
  for (const item of before.parts ?? []) {
    if (!afterById.has(item.id)) rows.push({ entity: "part", entityId: item.id, entityName: item.name, carId: after.id, action: "delete", field: null, before: partSnapshot(item), after: null });
  }
  return rows;
}

function diffExpenses(before: Car, after: Car): AuditRow[] {
  const rows: AuditRow[] = [];
  const beforeById = new Map(before.expenses.map(item => [item.id, item]));
  const afterById = new Map(after.expenses.map(item => [item.id, item]));
  for (const item of after.expenses) {
    const previous = beforeById.get(item.id);
    if (!previous) rows.push({ entity: "expense", entityId: item.id, entityName: item.name, carId: after.id, action: "create", field: null, before: null, after: { ...item } });
    else rows.push(...updateRows("expense", item.id, item.name, after.id, previous, item, expenseFields));
  }
  for (const item of before.expenses) {
    if (!afterById.has(item.id)) rows.push({ entity: "expense", entityId: item.id, entityName: item.name, carId: after.id, action: "delete", field: null, before: { ...item }, after: null });
  }
  return rows;
}

function diffPayouts(before: Car, after: Car, partners: Ledger["partners"]): AuditRow[] {
  const rows: AuditRow[] = [];
  const beforeRefs = payoutsOf(before, partners);
  const afterRefs = payoutsOf(after, partners);
  const beforeById = new Map(beforeRefs.map(item => [item.id, item]));
  const afterById = new Map(afterRefs.map(item => [item.id, item]));
  const label = (ref: PayoutRef) => `Выплата · ${ref.partnerName}`;
  for (const ref of afterRefs) {
    const previous = beforeById.get(ref.id);
    if (!previous) rows.push({ entity: "payout", entityId: ref.id, entityName: label(ref), carId: after.id, action: "create", field: null, before: null, after: { amount: ref.amount, date: ref.date, fromCash: ref.fromCash } });
    else rows.push(...updateRows("payout", ref.id, label(ref), after.id, previous, ref, payoutFields));
  }
  for (const ref of beforeRefs) {
    if (!afterById.has(ref.id)) rows.push({ entity: "payout", entityId: ref.id, entityName: label(ref), carId: after.id, action: "delete", field: null, before: { amount: ref.amount, date: ref.date, fromCash: ref.fromCash }, after: null });
  }
  return rows;
}

function diffCars(before: Ledger, after: Ledger): AuditRow[] {
  const rows: AuditRow[] = [];
  const beforeById = new Map(before.cars.map(car => [car.id, car]));
  const afterById = new Map(after.cars.map(car => [car.id, car]));
  for (const car of after.cars) {
    const previous = beforeById.get(car.id);
    if (!previous) {
      rows.push({ entity: "car", entityId: car.id, entityName: car.name, carId: car.id, action: "create", field: null, before: null, after: carSnapshot(car) });
      rows.push(...diffExpenses({ ...car, expenses: [] }, car));
      rows.push(...diffTasks({ ...car, tasks: [] }, car));
      rows.push(...diffParts({ ...car, parts: [] }, car));
      rows.push(...diffPayouts({ ...car, shares: car.shares.map(share => ({ ...share, payouts: [] })) }, car, after.partners));
      continue;
    }
    rows.push(...updateRows("car", car.id, car.name, car.id, { ...previous, stage: derivedStage(previous) }, { ...car, stage: derivedStage(car) }, carFields));
    if (!same(sharesProjection(previous), sharesProjection(car))) {
      rows.push({ entity: "car", entityId: car.id, entityName: car.name, carId: car.id, action: "update", field: "shares", before: sharesProjection(previous), after: sharesProjection(car) });
    }
    rows.push(...diffExpenses(previous, car));
    rows.push(...diffTasks(previous, car));
    rows.push(...diffParts(previous, car));
    rows.push(...diffPayouts(previous, car, after.partners));
  }
  for (const car of before.cars) {
    if (!afterById.has(car.id)) {
      rows.push({ entity: "car", entityId: car.id, entityName: car.name, carId: car.id, action: "delete", field: null, before: carSnapshot(car), after: null });
      rows.push(...diffExpenses(car, { ...car, expenses: [] }));
      rows.push(...diffTasks(car, { ...car, tasks: [] }));
      rows.push(...diffParts(car, { ...car, parts: [] }));
      rows.push(...diffPayouts(car, { ...car, shares: car.shares.map(share => ({ ...share, payouts: [] })) }, before.partners));
    }
  }
  return rows;
}

export function diffLedgers(before: Ledger | undefined, after: Ledger): AuditRow[] {
  const previous: Ledger = before ?? { partners: [], cars: [], cashEntries: [] };
  const rows: AuditRow[] = [];

  // При самой первой записи книги партнёры — служебная разметка («Я»), не событие.
  if (before) {
  const beforePartners = new Map(previous.partners.map(partner => [partner.id, partner]));
  const afterPartners = new Map(after.partners.map(partner => [partner.id, partner]));
  for (const partner of after.partners) {
    const old = beforePartners.get(partner.id);
    if (!old) rows.push({ entity: "partner", entityId: partner.id, entityName: partner.name, carId: null, action: "create", field: null, before: null, after: { name: partner.name } });
    else if (old.name !== partner.name) rows.push({ entity: "partner", entityId: partner.id, entityName: partner.name, carId: null, action: "update", field: "name", before: old.name, after: partner.name });
  }
  for (const partner of previous.partners) {
    if (!afterPartners.has(partner.id)) rows.push({ entity: "partner", entityId: partner.id, entityName: partner.name, carId: null, action: "delete", field: null, before: { name: partner.name }, after: null });
  }
  }

  const beforeCash = new Map((previous.cashEntries ?? []).map(entry => [entry.id, entry]));
  const afterCash = new Map((after.cashEntries ?? []).map(entry => [entry.id, entry]));
  for (const entry of after.cashEntries ?? []) {
    const old = beforeCash.get(entry.id);
    if (!old) rows.push({ entity: "cash", entityId: entry.id, entityName: entry.name, carId: null, action: "create", field: null, before: null, after: { ...entry } });
    else rows.push(...updateRows("cash", entry.id, entry.name, null, old, entry, cashFields));
  }
  for (const entry of previous.cashEntries ?? []) {
    if (!afterCash.has(entry.id)) rows.push({ entity: "cash", entityId: entry.id, entityName: entry.name, carId: null, action: "delete", field: null, before: { ...entry }, after: null });
  }

  rows.push(...diffCars(previous, after));
  return rows;
}