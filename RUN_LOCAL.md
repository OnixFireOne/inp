# RUN_LOCAL.md — как запустить приложение локально (Windows, без Docker)

> Главное: **Docker для разработки не нужен.** Docker = для деплоя на VPS в проде (Phase «хостинг»).
> Чтобы просто запустить и посмотреть — нужен только **Node.js** и `npm run dev`.

---

## Шаг 0 — понять уровни запуска

| Что хочешь увидеть | Что нужно установить |
|---|---|
| **Phase 1** — таблица из каталога (203 актива) | только Node.js |
| **Phase 2** — живые цены + график | + ключ CoinGecko (+ Upstash Redis желательно, но можно без) |
| **Phase 3** — аккаунты + watchlist в БД | + Supabase (облачный фри-проект, без Docker) |
| **Прод на VPS** | вот тут Docker + self-host Supabase |

Важное: для разработки self-host Supabase через Docker СЕЙЧАС не нужен. Берём бесплатный облачный Supabase для дева, а на self-host переедешь на этапе деплоя.

---

## Шаг 1 — установить Node.js

1. Скачай LTS с https://nodejs.org (версия 20 или 22).
2. Установи, перезапусти терминал. Проверь:

```powershell
node -v   # v20.x или v22.x
npm -v
```

Это всё, что нужно для Phase 1.

---

## Шаг 2 — установить зависимости и запустить

В папке проекта (где лежит `package.json`):

```powershell
npm install
npm run dev
```

Открой http://localhost:3000 — должна открыться таблица (Phase 1 работает из seed-данных без БД).

Если ругается, что нет `.env.local` — создай пустой (см. Шаг 3), для Phase 1 переменные можно оставить пустыми.

---

## Шаг 3 — .env.local (переменные окружения)

Создай файл `.env.local` в корне проекта. Заполняй по мере фаз:

```bash
# — Phase 2 (цены) —
COINGECKO_API_KEY=          # demo-ключ с coingecko.com (бесплатно)
COINGECKO_BASE=https://api.coingecko.com/api/v3
PRICE_TTL_SECONDS=20
SPARK_TTL_SECONDS=300
# Redis-кэш (опционально в деве, см. ниже):
KV_REST_API_URL=
KV_REST_API_TOKEN=

# — Phase 3 (аккаунты) —
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=
SIWE_SESSION_SECRET=
```

---

## Ключи без Docker (бесплатные облачные сервисы для дева)

### CoinGecko (Phase 2)
- coingecko.com → рега → Developer Dashboard → Demo API Key. Бесплатно.

### Redis / KV (Phase 2 — опционально в деве)
- Без Docker: возьми бесплатный **Upstash Redis** (REST) → даёт `KV_REST_API_URL` + `KV_REST_API_TOKEN`. Работает из дева без локального Redis.
- Или временно без кэша: попроси ИИ сделать в `lib/kv.ts` no-op fallback, когда `KV_REST_*` пусты (цены будут работать, просто без кэша). Для дева ок.

### Supabase (Phase 3)
- Без Docker: supabase.com → New Project (бесплатный tier). Даст:
  - `NEXT_PUBLIC_SUPABASE_URL` и `anon key` — Project Settings → API.
  - `service_role key` — там же (СЕКРЕТ, только в .env.local).
- Примени миграцию Phase 3: Supabase Studio → SQL Editor → вставь содержимое `supabase/migrations/20260614_phase3_rls.sql` и выполни.
- Настрой redirect URL для auth: Authentication → URL Configuration → добавь `http://localhost:3000/auth/callback`.

### WalletConnect (Phase 3, Web3)
- cloud.walletconnect.com → создай Project → `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`.

---

## Частые проблемы

- **`npm run dev` падает на импорте seed:** убедись, что `catalog.seed.json` лежит там, куда смотрит `scripts/import.ts`.
- **Порт 3000 занят:** `npm run dev -- -p 3001`.
- **Ошибки Supabase «401/Invalid API key»:** проверь, что URL и anon key из ОДНОГО проекта.
- **Magic-link не возвращает на сайт:** добавь `http://localhost:3000/auth/callback` в redirect URLs в Supabase.
- **PowerShell и скрипты:** если `npm` ругается на execution policy — запускай из «Command Prompt» (cmd) или разреши скрипты.

---

## Итоговый порядок для тебя прямо сейчас

1. Установи Node.js LTS.
2. В папке проекта: `npm install` → `npm run dev`.
3. Открой localhost:3000 — увидишь таблицу (Phase 1).
4. Хочешь цены — добавь CoinGecko ключ (+ Upstash) в .env.local, перезапусти.
5. Хочешь аккаунты — заведи облачный Supabase, примени миграцию, впиши ключи.
6. Docker / self-host — ПОЗЖЕ, когда будешь выкладывать на VPS (отдельный этап).
