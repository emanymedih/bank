import type { Metadata } from "next";
import "@fontsource-variable/manrope";
import "./globals.css";
import "./workspace.css";

export const metadata: Metadata = {
  title: "Автобанк — учёт автомобилей",
  description: "Покупки, расходы, продажи и расчёты с партнёрами.",
  icons: { icon: "/favicon.svg" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="ru"><body>{children}</body></html>;
}
