import type { Car, CarPhoto } from "./ledger";

export type PhotoSource = (photo: CarPhoto) => string;

function imageData(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Не удалось прочитать фотографию."));
    reader.readAsDataURL(blob);
  });
}

export async function downloadBuyerReport({ car, askingPrice, includeVin, photoSource, rub, dateLabel }: {
  car: Car; askingPrice: number | null; includeVin: boolean; photoSource: PhotoSource;
  rub: (value: number) => string; dateLabel: (value: string) => string;
}) {
  const [{ default: pdfMake }, { default: fonts }] = await Promise.all([
    import("pdfmake/build/pdfmake.js"), import("pdfmake/build/vfs_fonts.js"),
  ]);
  pdfMake.addVirtualFileSystem(fonts);
  const photos = car.photos ?? [];
  const photosById = new Map<string, string>();
  // Fetch in small batches to limit peak memory on phones.
  for (let i = 0; i < photos.length; i += 4) {
    await Promise.all(photos.slice(i, i + 4).map(async photo => {
      const response = await fetch(photoSource(photo));
      if (!response.ok) throw new Error("Не удалось загрузить все фотографии. Попробуйте ещё раз.");
      photosById.set(photo.id, await imageData(await response.blob()));
    }));
  }

  function gallery(items: CarPhoto[]) {
    const rows = [];
    for (let i = 0; i < items.length; i += 2) {
      const pair = items.slice(i, i + 2).map(photo => ({
        width: "*" as const,
        stack: [
          { image: photosById.get(photo.id)!, fit: [231, 154], alignment: "center" },
          ...(photo.caption ? [{ text: photo.caption, style: "caption", alignment: "center", margin: [0, 4, 0, 0] }] : []),
        ],
      }));
      if (pair.length === 1) pair.push({ width: "*", stack: [] });
      rows.push({ columns: pair, columnGap: 9, margin: [0, 0, 0, 10], unbreakable: true });
    }
    return rows;
  }

  const reportSection = (title: string) => ({ text: title, style: "section", margin: [0, 14, 0, 7] });
  const work = [...(car.works ?? [])].sort((a, b) => a.date.localeCompare(b.date));
  const before = photos.filter(photo => photo.phase === "before");
  const after = photos.filter(photo => photo.phase === "after");
  const number = new Intl.NumberFormat("ru-RU");
  const details = [
    car.year ? "Год выпуска · " + car.year : null,
    car.mileage !== null ? "Пробег · " + number.format(car.mileage) + " км" : null,
    includeVin && car.vin ? "VIN · " + car.vin : null,
  ].filter(Boolean).join("   |   ");

  const definition = {
    pageSize: "A4",
    pageMargins: [48, 43, 48, 43],
    defaultStyle: { font: "Roboto", color: "#192923", fontSize: 10.5 },
    info: { title: car.name + " — история автомобиля" },
    footer: (page: number, count: number) => ({
      columns: [{ text: car.name }, { text: page + " / " + count, alignment: "right" }],
      margin: [48, 10, 48, 0], color: "#4e6257", fontSize: 9,
    }),
    styles: {
      kicker: { color: "#24664f", fontSize: 10, bold: true },
      title: { fontSize: 29, bold: true },
      price: { fontSize: 18, color: "#24664f", bold: true },
      section: { fontSize: 17, color: "#203e31", bold: true },
      work: { fontSize: 12, bold: true },
      caption: { fontSize: 9, color: "#4e6257" },
    },
    content: [
      { text: "ИСТОРИЯ АВТОМОБИЛЯ", style: "kicker", margin: [0, 0, 0, 6] },
      { text: car.name, style: "title", margin: [0, 0, 0, 7] },
      ...(details ? [{ text: details, margin: [0, 0, 0, 8] }] : []),
      ...(askingPrice === null ? [] : [{ text: rub(askingPrice), style: "price", margin: [0, 0, 0, 5] }]),
      ...(before.length ? [reportSection("Состояние при покупке"), ...gallery(before)] : []),
      ...(work.length ? [reportSection("Выполненные работы"), ...work.flatMap(entry => [
        { stack: [
          { text: entry.name, style: "work" },
          { text: dateLabel(entry.date), style: "caption", margin: [0, 2, 0, 3] },
          ...(entry.notes ? [{ text: entry.notes }] : []),
        ], margin: [0, 0, 0, 8], unbreakable: true },
        ...gallery(photos.filter(photo => photo.phase === "work" && photo.workId === entry.id)),
      ])] : []),
      ...(after.length ? [reportSection("Автомобиль после подготовки"), ...gallery(after)] : []),
    ],
  };
  const filename = (car.name.replace(/[\\/:*?"<>|]/g, "").trim() || "Автомобиль") + " — история.pdf";
  await new Promise<void>((resolve, reject) => {
    try { pdfMake.createPdf(definition).download(filename, resolve); }
    catch (failure) { reject(failure); }
  });
}
