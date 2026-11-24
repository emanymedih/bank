const dateFormat = new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });

/** Единая короткая дата для реестра, лент и сроков: «24 нояб 2026». */
export const dateLabel = (value: string) => dateFormat.format(new Date(value)).replace(/\sг\.$/, "").replace(/\.(?=\s)/g, "");
