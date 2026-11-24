import type { CarPart } from "./ledger";

export type PartDraft = Pick<CarPart, "name" | "article" | "plannedPrice">;

type ImportResult = { parts: PartDraft[]; errors: number[] };

function clipboardRows(value: string) {
  const rows: string[][] = [];
  let cells: string[] = [];
  let cell = "";
  let quoted = false;
  const saveCell = () => { cells.push(cell.trim().replace(/[\t\n]+/g, " ")); cell = ""; };
  for (let index = 0; index < value.length; index++) {
    const char = value[index];
    if (char === '"' && !cell.length && !quoted) { quoted = true; continue; }
    if (char === '"' && quoted) {
      if (value[index + 1] !== '"') { quoted = false; continue; }
      index++;
    }
    if (!quoted && (char === "\t" || char === "\n")) {
      saveCell();
      if (char === "\n") { rows.push(cells); cells = []; }
    } else cell += char;
  }
  saveCell();
  rows.push(cells);
  return { rows, incomplete: quoted };
}

function parsePrice(value: string) {
  const number = value.replace(/\s*(?:₽|руб(?:\.|лей|ля)?|р\.|rub)$/iu, "").replace(/\s/gu, "").replace(",", ".");
  if (!/^\d+(?:\.\d{1,2})?$/.test(number)) return NaN;
  return Math.round(Number(number) * 100);
}

function abbreviatedLabel(value: string) {
  return value.toLocaleLowerCase("ru").replace(/[.:]$/u, "");
}

function tableParts(value: string): ImportResult {
  const { rows, incomplete } = clipboardRows(value);
  const headerIndex = rows.findIndex(row => row.some(Boolean));
  const headings = rows[headerIndex]?.map(abbreviatedLabel) ?? [];
  const nameColumn = headings.findIndex(label => /^(?:название|наименование|запчасть|позиция)$/u.test(label));
  const articleColumn = headings.findIndex(label => /^(?:артикул|код|номер детали)$/u.test(label));
  const priceColumn = headings.findIndex(label => /^(?:цена|сумма|стоимость)(?:$|\s|,)/u.test(label));
  const hasHeader = nameColumn >= 0 && (articleColumn >= 0 || priceColumn >= 0);
  const total = /^(?:итог(?:о)?|всего)(?:$|[\s:])/iu;
  const parts: PartDraft[] = [];
  const errors: number[] = [];
  for (const [index, row] of rows.entries()) {
    if (hasHeader && index === headerIndex || !row.some(Boolean)) continue;
    const article = row[hasHeader ? articleColumn : 0];
    const name = row[hasHeader ? nameColumn : 1];
    const price = row[hasHeader ? priceColumn : 2];
    if (total.test(article ?? "") || total.test(name ?? "")) continue;
    const amount = price ? parsePrice(price) : undefined;
    if (!name || name.length > 140 || (article?.length ?? 0) > 120 || (amount !== undefined && !(amount > 0 && amount <= 100_000_000_000))) {
      errors.push(index + 1);
      continue;
    }
    parts.push({ name, ...(article ? { article } : {}), ...(amount !== undefined ? { plannedPrice: amount } : {}) });
  }
  if (incomplete && !errors.includes(rows.length)) errors.push(rows.length);
  return { parts, errors };
}

export function parsePartList(value: string): ImportResult {
  const text = value.replace(/\r\n?/g, "\n").replace(/^\uFEFF/u, "");
  if (text.includes("\t")) return tableParts(text);
  const separators = text.trim().includes("\n") ? /[\n;]+|\s+(?:запятая|новая строка)\s+/iu : /[;,]+|\s+(?:запятая|новая строка)\s+/iu;
  const names = text.split(separators).map(line => line.trim().replace(/^(?:[-•–]\s+|\d+\.\s+)/u, "")
    .replace(/^(?:(?:мне\s+)?(?:на\s+(?:неё|нее|него|машину)\s+)?нуж(?:ен|на|но|ны)\s+|(?:добавь|найди|купи)\s+)/iu, "").trim())
    .filter(Boolean);
  const unique = new Map(names.map(name => [name.toLocaleLowerCase("ru"), name]));
  return { parts: [...unique.values()].map(name => ({ name })), errors: [] };
}
