import type { VehicleDocuments } from "./ledger";

export type ContractParty = {
  name: string; passport: string; issuer: string; issued: string; address: string;
};

export type SaleContract = {
  city: string; date: string; price: string; payment: string; handover: string; conditions: string;
  seller: ContractParty; buyer: ContractParty;
  vehicle: {
    name: string; registration: string; vin: string; year: string; mileage: string;
    documents: VehicleDocuments;
  };
};

const dates = new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "long", year: "numeric", timeZone: "UTC" });
const money = new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 2 });
const formatDate = (value: string) => dates.format(new Date(value + "T00:00:00Z"));

export function contractMoney(value: string) {
  const normalized = value.replace(/\s/g, "").replace(",", ".");
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  const amount = Number(normalized);
  return Number.isFinite(amount) && amount > 0 && amount <= 1_000_000_000 ? amount : null;
}

function partyDetails(party: ContractParty) {
  return [
    "Паспорт: " + party.passport,
    "выдан " + party.issuer + " " + formatDate(party.issued),
    "адрес: " + party.address,
  ].join(", ");
}

export function contractSections(draft: SaleContract) {
  const { vehicle } = draft;
  const documents = vehicle.documents;
  const car = [
    ["Марка, модель", vehicle.name], ["Год выпуска", vehicle.year], ["VIN", vehicle.vin],
    ["Госномер", vehicle.registration], ["Пробег", vehicle.mileage ? vehicle.mileage + " км" : ""],
    ["Тип ТС", documents.type], ["Цвет", documents.color], ["Кузов", documents.body], ["Шасси", documents.chassis],
    ["Двигатель", documents.engine], ["ПТС / ЭПТС", documents.pts], ["Кем выдан ПТС", documents.ptsIssuer],
    ["Дата выдачи ПТС", documents.ptsDate ? formatDate(documents.ptsDate) : ""], ["СТС", documents.sts],
  ].filter(([, value]) => value).map(([label, value]) => label + ": " + value).join(" · ");

  return {
    heading: "Договор купли-продажи автомобиля",
    where: draft.city + " · " + formatDate(draft.date),
    parties: [
      { label: "Продавец", name: draft.seller.name, details: partyDetails(draft.seller) },
      { label: "Покупатель", name: draft.buyer.name, details: partyDetails(draft.buyer) },
    ],
    paragraphs: [
      { name: "1. Автомобиль", text: "Продавец обязуется передать автомобиль в собственность Покупателя, а Покупатель обязуется принять автомобиль и уплатить согласованную цену. " + car + "." },
      { name: "2. Цена и оплата", text: "Цена автомобиля: " + money.format(contractMoney(draft.price) ?? 0) + ". Порядок оплаты: " + draft.payment + "." },
      { name: "3. Передача", text: "Срок и порядок передачи автомобиля, ключей и документов: " + draft.handover + ". Право собственности переходит при передаче автомобиля." },
      { name: "4. Условия сделки", text: "Продавец обязуется передать автомобиль свободным от прав третьих лиц, за исключением прав, с которыми Покупатель согласился. " +
        (draft.conditions ? "Согласованные сведения о состоянии автомобиля, правах третьих лиц и иные условия: " + draft.conditions + ". " : "") +
        "Договор составлен в трёх экземплярах одинаковой юридической силы." },
    ],
  };
}

export async function exportContract(draft: SaleContract, printWindow?: Window) {
  const [{ default: pdfMake }, { default: fonts }] = await Promise.all([
    import("pdfmake/build/pdfmake.js"), import("pdfmake/build/vfs_fonts.js"),
  ]);
  pdfMake.addVirtualFileSystem(fonts);
  const content = contractSections(draft);
  const definition = {
    pageSize: "A4", pageMargins: [44, 40, 44, 40],
    defaultStyle: { font: "Roboto", color: "#172030", fontSize: 10.5, lineHeight: 1.15 },
    info: { title: content.heading },
    content: [
      { text: content.heading, fontSize: 20, bold: true, margin: [0, 0, 0, 9] },
      { text: content.where, margin: [0, 0, 0, 15] },
      ...content.parties.map(party => ({ stack: [
        { text: party.label + " · " + party.name, bold: true },
        { text: party.details, margin: [0, 3, 0, 0] },
      ], margin: [0, 0, 0, 11], unbreakable: true })),
      ...content.paragraphs.map(paragraph => ({ stack: [
        { text: paragraph.name, bold: true },
        { text: paragraph.text, margin: [0, 3, 0, 0] },
      ], margin: [0, 0, 0, 11], unbreakable: true })),
      { columns: content.parties.map(party => ({
        stack: [{ text: party.label + " · " + party.name, bold: true }, { text: "Подпись __________________", margin: [0, 14, 0, 0] }],
      })), columnGap: 15, margin: [0, 11, 0, 0], unbreakable: true },
    ],
  };
  const pdf = pdfMake.createPdf(definition);
  if (printWindow) pdf.print({}, printWindow);
  else await new Promise<void>(resolve => pdf.download("Договор купли-продажи автомобиля.pdf", resolve));
}
