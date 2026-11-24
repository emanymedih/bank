import { integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const ledgers = sqliteTable("ledgers", {
  bookId: text("book_id").primaryKey(),
  data: text("data").notNull(),
  revision: integer("revision").notNull(),
});

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  phone: text("phone").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: text("name").notNull(),
  createdAt: text("created_at").notNull(),
});

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  device: text("device").notNull(),
  createdAt: text("created_at").notNull(),
  expiresAt: text("expires_at").notNull(),
});

export const books = sqliteTable("books", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  ownerId: text("owner_id").notNull(),
  createdAt: text("created_at").notNull(),
});

export const memberships = sqliteTable("memberships", {
  bookId: text("book_id").notNull(),
  userId: text("user_id").notNull(),
  role: text("role").notNull(),
  partnerId: text("partner_id"),
}, table => [primaryKey({ columns: [table.bookId, table.userId] })]);

export const invites = sqliteTable("invites", {
  id: text("id").primaryKey(),
  bookId: text("book_id").notNull(),
  phone: text("phone").notNull(),
  role: text("role").notNull(),
  token: text("token").notNull().unique(),
  expiresAt: text("expires_at").notNull(),
  acceptedAt: text("accepted_at"),
});

export const otpChallenges = sqliteTable("otp_challenges", {
  phone: text("phone").primaryKey(),
  codeHash: text("code_hash").notNull(),
  expiresAt: text("expires_at").notNull(),
  attempts: integer("attempts").notNull(),
  lastSentAt: text("last_sent_at").notNull(),
});
