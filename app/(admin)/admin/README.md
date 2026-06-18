# Admin panel — stage 1 "catalog"

Админка живёт под маршрутом `/admin` и физически изолирована в route group
`app/(admin)/admin/...`. На этом этапе мы **не подключаем Refine**:
таблицы и CRUD написаны на чистом `supabase-js` + `fetch`. Refine (core +
supabase + react-hook-form + nextjs-router) добавим, когда он реально
понадобится — этап 1.5 (дерево ссылок, `useTable` с вложенными фильтрами)
или этап 2 (`link_candidates` / `link_events`). UI-киты Refine (Ant/MUI/
Mantine) подключать **не планируется** — headless + наш shadcn/Tailwind.

## Что внутри этапа 1

- `app/(admin)/admin/layout.tsx` — server-side гард: `auth.getUser()` +
  `profiles.role='admin'`. Если не admin → редирект.
- `proxy.ts` (Next 16: раньше назывался `middleware.ts`) — **лёгкий**
  гард, только `auth.getUser()` → редирект на
  `/auth/signin?next=…`. Никаких БД-запросов, чтобы не тормозить
  публичную витрину.
- `app/auth/callback/route.ts` — читает `?next=` через общий
  `safeNextPath` (валидирует `//evil.com` и `/\evil.com`).
- `app/auth/signin/page.tsx` — кнопка Google OAuth (Supabase).
- `app/(admin)/admin/catalog/page.tsx` — экран «Каталог монет»:
  маркет CoinGecko + оверлей статуса (`assets`) + фильтры + поиск.
- `app/(admin)/admin/catalog/[id]/page.tsx` — модалка монеты:
  редактор `assets` + CRUD `links` (плоский).
- `lib/admin/market-provider.ts` — тонкий Refine-совместимый data provider
  поверх `/api/markets` (только `getList`, без `total`, sentinel
  по `hasMore`).
- `lib/admin/asset-index.ts` — клиентский хелпер: множество
  `coingecko_id` из `assets` + счётчик ссылок.
- `lib/admin/favicon.ts` — фолбэк-фавикон по домену через
  `google.com/s2/favicons`.
- `lib/auth/safe-next.ts` — общий валидатор `next`-параметра.
- `supabase/migrations/20260618_admin_catalog_rls.sql` — миграция:
  `parent_id` + `sort` в `links` (задел), RLS на `assets`/`links`
  (public read, admin write).

## Запуск локально

1. Поставь зависимости (без Refine на этом этапе):
   ```bash
   npm install
   ```
2. Скопируй `env.example` → `.env.local` и заполни:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
   - (для серверных скриптов) `SUPABASE_SECRET_KEY` — **в админке не используется**, запись идёт под user-RLS.
   - `COINGECKO_API_KEY` / `COINGECKO_BASE` — для `/api/markets`.
3. Примени миграцию:
   ```bash
   npx supabase db push
   # либо накати файл руками через SQL editor:
   # supabase/migrations/20260618_admin_catalog_rls.sql
   ```
4. Выдай себе роль `admin` (Supabase SQL editor):
   ```sql
   update public.profiles set role = 'admin' where user_id = auth.uid();
   ```
5. Включи Google-провайдер в Supabase Dashboard → Authentication →
   Providers. Redirect URL добавь: `http://localhost:3000/auth/callback`.
6. Запусти дев-сервер:
   ```bash
   npm run dev
   ```
7. Открой `http://localhost:3000/admin` — middleware отредиректит на
   `/auth/signin?next=/admin`, после Google-входа попадёшь на
   `/admin/catalog`.

## Переменные окружения

| var | где используется | обязательно |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | клиент + сервер | да |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | клиент + сервер | да |
| `SUPABASE_SECRET_KEY` | серверные скрипты, **не используется в админке** (RLS-авторизация под юзером) | опц. |
| `COINGECKO_API_KEY` | `/api/markets` прокси | рекомендуется (демо-ключ) |
| `COINGECKO_BASE` | `/api/markets` прокси | по умолчанию `https://api.coingecko.com/api/v3` |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` | кэш цен | опц. |

## Изоляция бандла (без Refine)

`npm run build` показывает, что `/` (витрина) и `/admin/catalog*` —
разные routes, без пересечения. Импорты `app/(admin)/admin/*`,
`components/admin/*` и `lib/admin/*` встречаются **только** внутри
админ-роутов (проверено grep'ом). Витрина (`app/page.tsx`,
`components/AssetTable.tsx`, `components/AssetRow.tsx`, …) эти
модули не импортирует — Next разнесёт их по разным чанкам.

Когда добавим Refine (`@refinedev/core` + `@refinedev/supabase` +
`@refinedev/nextjs-router` + `@refinedev/react-hook-form` +
`react-hook-form` + dev `@next/bundle-analyzer`), изоляция
сохранится: все импорты Refine придут только из
`app/(admin)/admin/providers.tsx`. Для верификации:

```bash
npm i -D @next/bundle-analyzer
# добавить withBundleAnalyzer в next.config.js
ANALYZE=true npm run build
# открыть .next/analyze/client.html, проверить, что @refinedev/*
# встречается ТОЛЬКО в чанках /admin/*
```

## Что НЕ реализовано (по ТЗ)

- Дерево/вложенность ссылок (`parent_id` заведён, но всегда `null`,
  UI плоский) — этап 1.5.
- `link_candidates` / ИИ-поиск, `link_events` / клики, авто-ранжирование.
- Загрузка кастомных иконок в Storage (только фавиконы по домену).
- Поле `status` (`draft`/`published`) — не введено, бейдж «черновик»
  не используется. Если потребуется — отдельная миграция
  `ALTER TABLE assets ADD COLUMN status text NOT NULL DEFAULT 'published'`.
- Refine (как зависимость) — отложен до этапа 1.5+.
