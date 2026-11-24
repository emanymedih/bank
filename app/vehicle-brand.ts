// Names and thumbnails come from https://quto.ru/catalog. Add everyday spellings used in vehicle cards.
const brands: Record<string, string[]> = {
  audi: ["ауди"],
  bmw: ["бмв", "бмве"],
  changan: ["чанган"],
  chery: ["чери"],
  exeed: ["эксид", "эксеед"],
  ford: ["форд"],
  gac: ["гак"],
  geely: ["джили", "гили"],
  haval: ["хавал", "хавейл"],
  honda: ["хонда"],
  hyundai: ["хендай", "хенде", "хендэ", "хундай", "хюндай"],
  jetour: ["джетур"],
  kia: ["киа"],
  lada: ["лада", "ваз", "vaz", "автоваз", "жигули"],
  landrover: ["land rover", "range rover", "ленд ровер", "ланд ровер", "рендж ровер"],
  lexus: ["лексус"],
  li_auto: ["li auto", "lixiang", "ли авто", "лисян"],
  mazda: ["мазда"],
  "mercedes-benz": ["mercedes benz", "mercedes", "мерседес бенц", "мерседес"],
  mitsubishi: ["митсубиси", "мицубиси"],
  nissan: ["ниссан"],
  renault: ["рено"],
  skoda: ["шкода"],
  solaris: ["солярис"],
  tank: ["танк"],
  toyota: ["тойота", "тоета"],
  volkswagen: ["vw", "фольксваген"],
  volvo: ["вольво"],
  moskvich: ["москвич"],
};

function markWords(value: string) {
  return value.normalize("NFKD").toLowerCase().replace(/\p{M}/gu, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

const aliases = Object.entries(brands).flatMap(([slug, variants]) => [slug, ...variants]
  .map(alias => ({ alias: markWords(alias), slug }))).sort((a, b) => b.alias.length - a.alias.length);

export function vehicleBrand(name: string) {
  const words = markWords(name);
  return aliases.find(({ alias }) => words.startsWith(alias) && !/^\p{L}/u.test(words.slice(alias.length)))?.slug;
}
