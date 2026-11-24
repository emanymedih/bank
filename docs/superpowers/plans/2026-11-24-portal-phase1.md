# Автобанк-портал, фаза 1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (native execution in this session). Steps use checkbox (`- [ ]`) syntax.
> **Ограничение владельца:** НЕ коммитить и НЕ пушить, пока результат не показан на локальной версии. Шаги «Commit» отложены до просмотра; работаем в рабочем дереве ветки `feature/portal-foundation`.

**Goal:** публичный вход по телефону РФ, личный кабинет, общие книги с ролями и онбординг «книга → начальный банк → первая машина», на локальном сервере.
**Architecture:** эволюция текущего приложения (vinext + workerd, D1/R2). Сессии в cookie (`avto_session`), выбранная книга в cookie (`avto_book`) — клиентские fetch книги/фото не меняют сигнатуры. Книга ключуется по bookId; доступ через memberships (owner/editor/viewer). SMS — абстракция, dev-режим `SMS_DEV_MODE=1` (код 123456).
**Tech Stack:** TypeScript, drizzle-orm/sqlite, zod, node:crypto (scrypt), node:test.
**Spec:** `docs/superpowers/specs/2026-11-24-portal-design.md`.

## Global Constraints

- Деньги — целые копейки; доли — базисные пункты; инварианты parseLedger и 409/422 не менять.
- UI и сообщения — по-русски, в стиле существующих текстов.
- 152-ФЗ: телефон — ПДн; аудит (фаза 2) не хранит ПДн; согласия — на владельце.
- Пароль: минимум 8 символов; scrypt (node:crypto), соль в строке `salt:hash`.
- OTP: 6 цифр, TTL 5 минут, максимум 5 попыток, повтор не чаще 60 с; dev-код 123456 только при `SMS_DEV_MODE=1`.
- CSRF: мутации отклоняют `sec-fetch-site: cross-site`; cookie HttpOnly, SameSite=Lax, Secure в проде.
- Роли: viewer — чтение; editor — книга/фото; owner — участники/приглашения/название.
- Приглашение принимается только аккаунтом с тем же номером телефона.
- Тесты: все существующие 76 остаются зелёными; рантайм адаптируется (cookie-сессии вместо oai-заголовков).

## Review Focus

1. Чужая книга: пользователь без membership не читает и не пишет книгу (ожидаемо 403/404, не данные).
2. Подбор OTP/пароля: попытки и повтор ограничены; неверный код не создаёт пользователя.
3. Гонка сохранений: revision CAS книги сохраняется после переезда на bookId (409 при устаревшем revision).
4. Сессии: отозванная/истёкшая сессия не даёт доступ; выход удаляет cookie.
5. Приглашение: чужой номер не принимает invite; viewer не сохраняет книгу.

---

### Task 1: Схема и миграция

**Files:** Modify `db/schema.ts`; Create `drizzle/0001_portal_foundation.sql`; Modify `tests/support/api-runtime.mjs` (применять все `drizzle/*.sql` по порядку).
**Interfaces:** Produces таблицы `users(id,phone unique,password_hash,name,created_at)`, `sessions(id,user_id,device,created_at,expires_at)`, `books(id,title,owner_id,created_at)`, `memberships(book_id,user_id,role,partner_id nullable; pk(book_id,user_id))`, `invites(id,book_id,phone,role,token unique,expires_at,accepted_at)`, `otp_challenges(phone pk,code_hash,expires_at,attempts,last_sent_at)`; `ledgers(book_id pk,data,revision)` (пересоздание таблицы, чистый лист).
- [ ] Тест: рантайм открывается на новой миграции, `seed/saved` работают по книге (падает до миграции).
- [ ] Миграция + schema; тест зелёный.

### Task 2: Телефон, пароль, сессии (серверное ядро)

**Files:** Create `lib/phone.ts`, `app/auth.ts`.
**Interfaces:** `normalizeRussianPhone(input): string|null` (+79XXXXXXXXX); `hashPassword/verifyPassword`; `getSessionUser(): Promise<{userId,phone,name}|null>`; `requireUser(returnTo)`; `createSession(userId,device): Promise<string>`; `clearSession()`; `getCurrentBook(): Promise<{bookId,role}|null>`; `requireBook(minRole): Promise<{user,bookId,role}|null>`; `setBookCookie(bookId)`. Cookie: `avto_session`, `avto_book`.
- [ ] Тесты `tests/auth-core.test.mjs`: нормализация (8/+7/7, мусор→null), scrypt roundtrip и отказ неверного пароля, сессия создаётся/читается/отзывается (падает до реализации).
- [ ] Реализация; тесты зелёные.

### Task 3: Маршруты авторизации

**Files:** Create `app/api/auth/{register,verify,login,logout,sessions,reset,reset-confirm}/route.ts`; Modify `tests/support/api-runtime.mjs` (loadRoutes добавляет auth/books; `as(id)` лениво создаёт пользователя+книгу+сессию и ставит cookie; helper `jsonRequest(path, body, cookie?)`).
- [ ] Тесты `tests/auth.test.mjs`: register→verify создаёт пользователя и сессию; неверный код 401 и пользователь не создан; 6-я попытка 429; повтор раньше 60 с 429; login верный/неверный; logout очищает; sessions список/отзыв; reset-confirm меняет пароль (падает до реализации).
- [ ] Реализация маршрутов; тесты зелёные; существующие 76 зелёные.

### Task 4: Книги, роли, приглашения

**Files:** Create `app/api/books/route.ts` (GET список/POST создать), `app/api/books/select/route.ts`, `app/api/books/members/route.ts` (GET/POST invite/DELETE), `app/api/invites/accept/route.ts`.
- [ ] Тесты `tests/books.test.mjs`: создание книги + owner membership + пустой ledger; select чужой книги 403; invite owner-only; accept с чужим номером 403; accept своим номером даёт роль; viewer не может PUT ledger (готовится в Task 5) — здесь проверка роли в members GET (падает до реализации).
- [ ] Реализация; тесты зелёные.

### Task 5: Книга и фото по книге, поиск по номеру

**Files:** Modify `app/api/ledger/route.ts`, `app/api/photos/[carId]/route.ts`, `app/api/plate-lookup/route.ts`, `lib/ledger-media.ts` (ключ по bookId).
- [ ] Тесты: существующие api-тесты зелёные после переезда; новый тест «чужая книга 403/404» и «viewer PUT 403» в `tests/books.test.mjs` (падает до реализации).
- [ ] Реализация: `requireBook("viewer"/"editor")`, ledgers по bookId, photoKey(bookId,…); тесты зелёные.

### Task 6: Страницы входа, кабинета, онбординга, приглашения

**Files:** Create `app/login/page.tsx`, `app/account/page.tsx`, `app/start/page.tsx`, `app/invite/page.tsx`; Modify `app/page.tsx` (сессия; нет пользователя → /login; нет книг → /start), `app/dashboard.tsx` (кнопка входа → «Кабинет», имя книги в шапке).
- [ ] Проверка: `npm run check` (tsc) зелёный; ручной сценарий на локальном сервере: регистрация dev-кодом → книга → начальный банк → машина; кабинет: сессии, выход; приглашение вторым аккаунтом.
- [ ] Реализация страниц; tsc зелёный.

### Task 7: Локальный сервер и инструкция РФ-деплоя

**Files:** Create `.dev.vars` (SMS_DEV_MODE=1), `docs/deploy-ru.md` (workerd/wrangler local, nginx+TLS, бэкапы D1/R2, боевой SMS-шлюз позже).
- [ ] `npm run dev` поднимается; сквозной сценарий в браузере агента; скриншоты пользователю.
- [ ] Показать пользователю; коммиты только после одобрения.

## Self-review

Покрытие спеки: вход по телефону (T2–3), логин/пароль (T2–3), ЛК (T6), книги/роли/приглашения (T4), онбординг (T6), книга/фото по книге (T5), локальный деплой+инструкция (T7), dev-SMS (T3,7). Аудит, таски, ссылка объявления, UX-пакет — фазы 2–3, вне этого плана. Типы и имена сквозные (requireBook/getSessionUser/setBookCookie). Review Focus покрыт тестами T3–T5.
