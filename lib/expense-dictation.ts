import type { Expense, Partner } from "../app/ledger";

type ExpenseDraft = {
  source: string;
  name: string;
  amount: string;
  category: Expense["category"];
  payer: Expense["payer"] | undefined;
};

export type ExpenseBatchRow = ExpenseDraft & { id: string; date: string; included: boolean };

const space = "[ \u00a0\u202f]";
const groupedInteger = String.raw`(?:\d{1,3}(?:${space}\d{3})+|\d+)`;
const maximumAmount = 100_000_000_000;
const quantity = new RegExp(String.raw`^(${groupedInteger})(?:[,.](\d+))?$`, "u");

function numericKopecks(value: string, thousands = false): number | null {
  const parts = quantity.exec(value.trim());
  const precision = thousands ? 5 : 2;
  if (!parts || (parts[2]?.length ?? 0) > precision) return null;
  const whole = Number(parts[1].replace(/\s/gu, ""));
  const fraction = Number((parts[2] ?? "").padEnd(precision, "0"));
  const kopecks = whole * 10 ** precision + fraction;
  return kopecks >= 1 && kopecks <= maximumAmount ? kopecks : null;
}

export function parseExpenseAmount(value: string): number | null {
  return numericKopecks(value);
}

const wordValues = {
  один: 1, одна: 1, два: 2, две: 2, три: 3, четыре: 4, пять: 5, шесть: 6, семь: 7, восемь: 8, девять: 9,
  десять: 10, одиннадцать: 11, двенадцать: 12, тринадцать: 13, четырнадцать: 14, пятнадцать: 15, шестнадцать: 16,
  семнадцать: 17, восемнадцать: 18, девятнадцать: 19, двадцать: 20, тридцать: 30, сорок: 40, пятьдесят: 50,
  шестьдесят: 60, семьдесят: 70, восемьдесят: 80, девяносто: 90, сто: 100, двести: 200, триста: 300,
  четыреста: 400, пятьсот: 500, шестьсот: 600, семьсот: 700, восемьсот: 800, девятьсот: 900,
};
const numberWord = `(?:${Object.keys(wordValues).join("|")})`;
const amountPattern = new RegExp(
  String.raw`(?<![\p{L}\p{N}.])(?<number>[-−]?${groupedInteger}(?:[,.]\d+)?|${numberWord}(?:\s+${numberWord}){0,2})(?:${space}*(?<scale>тысяч[аиу]?|тыс\.?))?(?:${space}*(?<currency>₽|руб(?:лей|ль|ля|\.)?))?(?![\p{L}\p{N}]|\.\d)`,
  "giu",
);
const priceCue = /(?:^|[\s,])(?:за|на сумму|отдал[аи]?|потратил[аи]?|вышло|стоило|заплатил[аи]?|оплатил[аи]?)\s*$/iu;
const payerVerb = "(?:оплатил[аи]?|заплатил[аи]?)";
const payerLabel = String.raw`(?:плательщик\s*[:—-]?\s*|${payerVerb}\s+)`;
const unnamedPayer = new RegExp(String.raw`(?<!\p{L})(?:${payerVerb}|плательщик)(?!\p{L})`, "iu");
const cashPhrase = new RegExp(String.raw`(?<!\p{L})(?:${payerLabel})?(?:из\s+(?:общей\s+)?кассы|(?:общей\s+)?кассой|общая\s+касса)(?!\p{L})`, "giu");
const categoryHints: [NonNullable<Expense["category"]>, RegExp][] = [
  ["Реклама", /(?<!\p{L})(?:авито|дром|реклам|продвижен|объявлен)/iu],
  ["Работы", /(?<!\p{L})(?:покрас|окрас|рихтов|полиров|шиномонтаж|ремонт|диагност|замен|мойк|сварк)/iu],
  ["Транспорт", /(?<!\p{L})(?:эвакуатор|доставк|перегон|топлив|бензин|такси)/iu],
  ["Шины", /(?<!\p{L})(?:шин[аыуе]?|покрыш|резин|кол[её]с)/iu],
  ["Запчасти", /(?<!\p{L})(?:запчаст|бампер|фар|крыл|фильтр|колодк|подшипник|датчик|детал)/iu],
];

type AmountCandidate = { start: number; end: number; amount: number | null; scaled: boolean; explicit: boolean; currency: boolean };

function spokenKopecks(value: string, scaled: boolean): number | null {
  const words = value.toLowerCase().split(/\s+/u) as (keyof typeof wordValues)[];
  let remaining = 1000;
  let sum = 0;
  for (const word of words) {
    const amount = wordValues[word];
    if (amount >= remaining) return null;
    sum += amount;
    remaining = amount >= 100 ? 100 : amount >= 20 ? 10 : 1;
  }
  return sum * (scaled ? 100_000 : 100);
}

function findAmount(value: string) {
  const candidates: AmountCandidate[] = [];
  for (const match of value.matchAll(amountPattern)) {
    const { number, scale, currency } = match.groups!;
    const scaled = Boolean(scale);
    const explicit = scaled || Boolean(currency) || priceCue.test(value.slice(0, match.index));
    const numeric = /^[-−]?\d/u.test(number);
    if (!numeric && !explicit) continue;
    const amount = numeric ? numericKopecks(number, scaled) : spokenKopecks(number, scaled);
    const previous = candidates.at(-1);
    if (previous?.scaled && !previous.currency && currency && !scaled && amount !== null && amount < 100_000
      && /^\s+$/u.test(value.slice(previous.end, match.index))) {
      previous.end = match.index + match[0].length;
      if (previous.amount !== null) previous.amount += amount;
      continue;
    }
    candidates.push({ start: match.index, end: match.index + match[0].length, amount, scaled, explicit, currency: Boolean(currency) });
  }
  const explicit = candidates.filter(candidate => candidate.explicit);
  if (explicit.length === 1) {
    const [total] = explicit;
    const trailing = candidates.at(-1);
    const hasExtraTotal = trailing && trailing.start > total.end && /^[\s,.:!?]*$/u.test(value.slice(trailing.end));
    return hasExtraTotal ? undefined : total;
  }
  if (explicit.length > 1 || candidates.length !== 1) return undefined;
  const [only] = candidates;
  const tail = value.slice(only.end).replace(/^[\s,.:!?]+/u, "");
  return !tail || tail.search(unnamedPayer) === 0 ? only : undefined;
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function payerPatterns(partners: Partner[]) {
  const firstNames = partners.map(partner => partner.name.trim().split(/\s+/u)[0].toLowerCase());
  return partners.flatMap((partner, index) => {
    const fullName = partner.name.trim().toLowerCase().split(/\s+/u).map(escapeRegex).join("\\s+");
    const firstName = firstNames[index];
    const name = fullName !== firstName && firstNames.filter(candidate => candidate === firstName).length === 1
      ? `(?:${fullName}|${escapeRegex(firstName)})` : fullName;
    return { id: partner.id, pattern: new RegExp(String.raw`(?<![\p{L}\p{N}])(?:${payerLabel}${name}|${name}\s+${payerVerb})(?![\p{L}\p{N}])`, "giu") };
  });
}

function extractPayer(source: string, patterns: ReturnType<typeof payerPatterns>, defaultPayer: Expense["payer"]) {
  const matches = [
    ...Array.from(source.matchAll(cashPhrase), match => ({ id: null, match })),
    ...patterns.flatMap(({ id, pattern }) => Array.from(source.matchAll(pattern), match => ({ id, match }))),
  ];
  const recognized = matches.filter(({ match }) => !matches.some(({ match: other }) =>
    other.index === match.index && other[0].length > match[0].length));
  let description = source;
  for (const { match } of recognized.sort((a, b) => b.match.index - a.match.index)) {
    description = description.slice(0, match.index) + " ".repeat(match[0].length) + description.slice(match.index + match[0].length);
  }
  const payers = new Set(recognized.map(({ id }) => id));
  const payer = payers.size > 1 || unnamedPayer.test(description) ? undefined
    : payers.size === 1 ? recognized[0].id : defaultPayer;
  return { description, payer };
}

export function parseExpenseDictation(value: string, partners: Partner[], defaultPayer: Expense["payer"]): ExpenseDraft[] {
  const patterns = payerPatterns(partners);
  return value.split(/\r?\n|;|(?<!\p{L})следующий расход(?!\p{L})/iu)
    .map(line => line.replace(/^[\s,;:]+|[\s,;:]+$/gu, "")).filter(Boolean).map(source => {
      const { description, payer } = extractPayer(source, patterns, defaultPayer);
      const candidate = findAmount(description);
      const before = candidate ? description.slice(0, candidate.start) : "";
      const after = candidate ? description.slice(candidate.end) : "";
      const uncertain = /(?:\d\s*[+−–—×*/-]|(?<!\p{L})по)\s*$/iu.test(before) || /^\s*[+−–—×*/-]\s*\d/u.test(after)
        || /(?<!\p{L})(?:копе(?:ек|йк)|за\s+(?:штуку|единицу))(?!\p{L})/iu.test(after);
      const amount = candidate?.amount && candidate.amount <= maximumAmount && !uncertain
        ? String(candidate.amount / 100).replace(".", ",") : "";
      const name = (amount ? before.replace(priceCue, "") + " " + after : description)
        .replace(/^[\s,.:!?–—]+|[\s,.:!?–—-]+$/gu, "").replace(/\s{2,}/gu, " ").replace(/\s+,/gu, ",");
      const category = categoryHints.find(([, pattern]) => pattern.test(name))?.[0];
      return { source, name, amount, category, payer };
    });
}

export function buildExpenseBatch(rows: ExpenseBatchRow[], bought: string):
  { expenses: Expense[] } | { rowId: string; field: "name" | "amount" | "date" | "payer" } {
  const expenses: Expense[] = [];
  for (const row of rows) {
    if (!row.included) continue;
    const { id, date, payer, category } = row;
    const name = row.name.trim();
    const amount = parseExpenseAmount(row.amount);
    const day = new Date(date);
    if (!name || name.length > 90) return { rowId: id, field: "name" };
    if (amount === null) return { rowId: id, field: "amount" };
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(date) || date < bought || !Number.isFinite(day.valueOf()) || day.toISOString().slice(0, 10) !== date) {
      return { rowId: id, field: "date" };
    }
    if (payer === undefined) return { rowId: id, field: "payer" };
    expenses.push({ id, name, date, amount, payer, category });
  }
  return { expenses };
}
