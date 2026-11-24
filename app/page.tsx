import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getDb } from "../db";
import { books, memberships } from "../db/schema";
import { getCurrentBook, getSessionUser } from "./auth";
import Dashboard from "./dashboard";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const rows = await getDb().select({ bookId: memberships.bookId }).from(memberships).where(eq(memberships.userId, user.userId));
  if (!rows.length) redirect("/start");
  const book = await getCurrentBook();
  if (!book) {
    // Cookie книги мог указывать на книгу, из которой пользователя удалили, — открываем первую доступную.
    redirect("/api/books/select?id=" + encodeURIComponent(rows[0].bookId));
  }
  const [current] = await getDb().select({ title: books.title }).from(books).where(eq(books.id, book.bookId));
  return <Dashboard signedIn signInUrl="/login" sellerScope={user.userId} bookTitle={current?.title} userName={user.name}/>;
}