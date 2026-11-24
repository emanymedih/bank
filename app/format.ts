const dateFormat = new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });

/** Единая короткая дата для реестра, лент и сроков: «24 нояб 2026». */
export const dateLabel = (value: string) => dateFormat.format(new Date(value)).replace(/\sг\.$/, "").replace(/\.(?=\s)/g, "");

/** Сегодняшний день в зоне пользователя (по умолчанию Москва) в формате YYYY-MM-DD. */
export const todayIn = (timeZone = "Europe/Moscow") =>
  new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
