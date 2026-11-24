const cyrillic = "АВЕКМНОРСТУХ";
const latin = "ABEKMHOPCTYX";
const russian = /^[ABEKMHOPCTYX][0-9]{3}[ABEKMHOPCTYX]{2}[0-9]{2,3}$/;
const kazakh = /^[0-9]{3}[A-Z]{2,3}[0-9]{2}$/;

export function plateKey(value: string) {
  return Array.from(value.normalize("NFKC").toUpperCase(), char => {
    const index = cyrillic.indexOf(char);
    return index < 0 ? char : latin[index];
  }).join("").replace(/[^A-Z0-9А-ЯЁ]/gu, "");
}

export function normalizePlate(value: string) {
  const clean = plateKey(value);
  if (!russian.test(clean)) return clean;
  return Array.from(clean, char => {
    const index = latin.indexOf(char);
    return index < 0 ? char : cyrillic[index];
  }).join("");
}

export function formatRussianPlate(value: string) {
  return russian.test(plateKey(value)) ? normalizePlate(value) : null;
}

export function plateFromParts(main: string, region: string) {
  const prefix = plateKey(main);
  const suffix = plateKey(region);
  if (!/^[ABEKMHOPCTYX][0-9]{3}[ABEKMHOPCTYX]{2}$/.test(prefix) || !/^\d{2,3}$/.test(suffix)) return null;
  return formatRussianPlate(prefix + suffix);
}

export function plateCandidates(text: string) {
  const clean = (value: string) => plateKey(value).replace(/RUS/g, "");
  const lines = text.split(/\r?\n/).filter(line => line.trim());
  const plates = new Set<string>();
  for (const [index, line] of lines.entries()) {
    const variants = [clean(line)];
    if (index + 1 < lines.length) variants.push(clean(line + lines[index + 1]));
    if (index + 2 < lines.length) variants.push(clean(line + lines[index + 1] + lines[index + 2]));
    for (const value of variants) {
      if (russian.test(value) || kazakh.test(value)) plates.add(normalizePlate(value));
    }
  }
  return [...plates];
}

export type PlateDetails = { name?: string; vin?: string; year?: number };
