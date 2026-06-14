# inp.one v2 — бриф для ИИ-разработчика

> Это единый документ для старта. Прочитай его целиком, затем начинай с **Фазы 0 → Фазы 1**.
> Рядом лежит файл данных **`catalog.seed.json`** — это весь каталог ссылок (импортируй из него, НЕ парси старый HTML/Angular).

---

## 1. Что строим

Каталог криптовалют: таблица активов (цена, кап, 24ч, мини-график 24ч) → по клику открывается карточка актива (модал на десктопе / drawer на мобайле) со списком курируемых ссылок по категориям. Плюс: watchlist с аккаунтом и синком, график TradingView, админка, фоновый ИИ для поддержки каталога.

**Важно:** дизайн делаем **новый, современный, лёгкий** — старый Angular-вид НЕ переносим. UX-структура (таблица → модал/drawer, категории, тиры) сохраняется, визуал — новый. Подробности дизайна — в разделе 4.

---

## 2. Технологический стек (зафиксирован)

| Слой | Выбор |
|---|---|
| Фреймворк | **Next.js 15 (App Router)** + TypeScript (strict) |
| Стили | **Tailwind CSS** (дизайн-токены через CSS-переменные) |
| UI | **Radix UI / shadcn/ui**, drawer на **vaul** |
| Данные котировок | **TanStack Query** |
| Бэкенд | Next Route Handlers (Edge где можно) |
| БД + Auth | **Supabase, полный self-host** (Postgres + Auth + PostgREST + Realtime + Storage + Studio) |
| Кеш | **Redis** (котировки/спарклайны) |
| График | **TradingView Advanced Widget** + свои спарклайны (inline SVG) |
| Хостинг | **свой VPS, Docker Compose** (web + supabase-стек + redis за Caddy/Nginx). Vercel — опционально. |
| Разработка | Windows: только **Docker Desktop + WSL2**, остальное в контейнерах |

Цель по перформансу: LCP < 1.5s, CLS < 0.05, INP < 200ms, открытие модала < 100ms. Первый экран — без запросов к БД (каталог отдаётся статически через ISR), цены догружаются отдельно со скелетонами.

---

## 3. Источник данных каталога — `catalog.seed.json`

Это экспорт из старой MySQL-таблицы `coins_contents`, уже распарсенный и нормализованный. **Импортируй каталог из него.**

### Что внутри

```jsonc
{
  "templates": [ /* 2 служебные строки: "default" и "all" — НЕ активы.
                    Это шаблоны секций с плейсхолдером "!" вместо тикера.
                    Используй их как образец дефолтного набора ссылок
                    для новых активов, но в таблицу НЕ добавляй. */ ],
  "assets": [
    {
      "legacyId": 3,
      "name": "bitcoin",
      "symbol": "btc",
      "sections": [
        {
          "title": "Aggregators",
          "default": null,
          "alert": null,
          "links": [
            {
              "title": "CoinMarketCap",
              "url": "https://coinmarketcap.com/currencies/bitcoin/",
              "desc": null,
              "thumbnailUrl": "https://inp.one/app-table/assets/thumbnails/coinmarketNav.gif",
              "symbol": null,
              "chart": null,
              "subUrls": null   // иногда массив [{url,title}] — несколько ссылок под одним пунктом
            }
          ]
        }
      ]
    }
  ]
}
```

### Факты о данных

- **203 реальных актива**, **6507 ссылок** всего. (Раньше было ~100 — данных больше, тем лучше.)
- 14 типов секций. Частые: `Charts`, `Aggregators`, `News`, `Change`, `Review`, `Social networks`, `Usefully`, `Team`, `Token sale`, `Token unlocks`. Редкие/опечатки: `Calendar`, `Analytics`, `Utility`, `Token sale (ICO,IEO,IDO..)` — нормализуй к основным.
- `symbol` — тикер в нижнем регистре (`btc`, `eth`...). `name` — slug имени (`bitcoin`, `usd-coin`...). У пары строк в имени затесался `\r\n` — тримируй.
- Плейсхолдер **`!`** в URL шаблонов = подстановка тикера. В реальных активах он почти везде уже заменён; если встретишь `!` или `https://#` — это «пустой»/шаблонный URL, помечай ссылку как требующую проверки.
- `thumbnailUrl` ведёт на старые гифки `inp.one/...Nav.gif` — это иконки источников (CoinMarketCap, Coingecko и т.д.). Можно переиспользовать или заменить на свои/фавиконы.

### Маппинг в новую схему

1. **`assets`**: `name` (Title-case для отображения), `ticker` = `symbol.toUpperCase()`, `coingecko_id` ← подбери по `name` (часто совпадает: `bitcoin`, `ethereum`; для несовпадений — по словарю/через CoinGecko `/coins/list`), `tv_symbol` ← напр. `BINANCE:{TICKER}USDT` (уточняется на Фазе 2).
2. **`links`**: на каждую ссылку из `sections[].links[]` создай строку `links`. `category` ← слаг исходного `sections[].title` (см. таблицу ниже). `name`, `href` ← `url`, `description` ← `desc`. `subUrls` разворачивай в отдельные ссылки или храни как под-пункты — на твоё усмотрение, но не теряй их.
3. **Health-check** (Фаза 0): пройди все `href`, проставь `health` = alive/broken/moved, пометь `https://#` и оставшиеся `!` как broken.

Рекомендуемый маппинг секций → `category`:

| Старая секция | category |
|---|---|
| Charts | `chart` |
| Change | `trade` (биржи/обмен) |
| Aggregators | `aggregator` |
| Token sale / Token unlocks | `tokenomics` |
| News / Calendar | `news` |
| Analytics / Usefully / Utility | `tools` |
| Review | `review` |
| Team | `team` |
| Social networks | `social` |

> Не зашивай ровно 5 категорий из черновика схемы — реальные данные богаче. Сделай `category` гибким (slug-строка) + словарь отображаемых названий.

---

## 4. Дизайн (новый, лёгкий, спокойный)

Принципы: **лёгкость** (воздух вместо линий, убрать рекламный баннер сверху), **спокойствие** (приглушённая палитра, цвет только на изменении цены), **ясность** (очевидно, что кликабельно).

### Таблица

- Колонки: № · Название (иконка + имя + тикер) · Цена · Капитализация · 24ч % · **спарклайн 24ч**.
- Высота строки ~56px (комфортная плотность по умолчанию) + переключатель «Компактно». Borderless: только тонкий разделитель строк.
- Числа — **табличные цифры** (`tabular-nums`), фиксированная ширина колонок → нет дёрганья при обновлении цен (CLS≈0).

### Кликабельность (критично)

- **Имя валюты** = ссылка `<a href="/asset/[id]">` → открывает карточку (вкладка «Обзор»). При hover: цвет акцента + подчёркивание + курсор-указатель + иконка `↗`. Поддержи deep-link (intercepting routes), чтобы работали «назад» и «открыть в новой вкладке».
- **Спарклайн** = `<button>` → открывает карточку сразу на вкладке «График». При hover: подложка + лёгкий scale + иконка `⤢` + тултип «Открыть график». `stopPropagation`, чтобы не срабатывал клик по строке.
- Вся строка тоже кликабельна (вкладка «Обзор»); hover-фон + шеврон `›` справа.
- Правило: кликабельное даёт 3 сигнала — курсор, смена вида при hover, иконка-намёк.

### Тема и токены

- **Тёмная тема по умолчанию** + светлая переключателем. Акцент — **индиго/сине-фиолетовый** (один токен `--accent`, легко сменить).

```css
:root[data-theme="dark"]{
  --bg:#0e1116; --surface:#161a22; --surface-2:#1d222c; --border:#232936;
  --text:#e6e9ef; --text-mut:#8b93a3; --accent:#6e8bff;
  --up:#3ec98a; --down:#f0666b; --radius:14px;
}
:root[data-theme="light"]{
  --bg:#fafbfc; --surface:#fff; --surface-2:#f3f5f8; --border:#e7eaf0;
  --text:#10141b; --text-mut:#5b6472; --accent:#4f6bff;
  --up:#16a36b; --down:#e0454b; --radius:14px;
}
```

### Карточка

- Desktop: центрированный Radix Dialog с мягким размытием. Mobile: vaul bottom-sheet.
- Внутри: шапка (иконка + имя + цена + 24ч) → вкладки **Обзор / График** → список ссылок по категориям с тирами (Core/Trusted).
- График = виджет TradingView, грузится лениво, но `tv.js` прогрет в фоне → открывается мгновенно (`setSymbol` на тёплом инстансе).

### Доступность

WCAG AA контраст, полная навигация с клавиатуры (`focus-visible`), `aria-label` на кнопке графика, знак `+/−` у процентов (не только цвет), уважение `prefers-reduced-motion`.

---

## 5. Модель данных (Postgres / Supabase)

```sql
-- snake_case в БД; в TS — camelCase
create table assets (
  id text primary key,              -- slug, напр. 'bitcoin'
  name text not null,
  ticker text not null,
  icon text,
  coingecko_id text,
  tv_symbol text,
  tags text[] default '{}',
  default_category text,
  sort_order int,
  created_at timestamptz default now()
);
create table links (
  id uuid primary key default gen_random_uuid(),
  asset_id text references assets(id) on delete cascade,
  name text not null,
  description text,
  href text not null,
  tier text check (tier in ('Core','Trusted')) default 'Trusted',
  category text not null,           -- chart/trade/aggregator/tokenomics/news/tools/review/team/social
  is_top boolean default false,
  manual_rank int,                  -- ручной порядок админа (перебивает ai_score)
  ai_score real,                    -- скоринг по кликам
  health text check (health in ('alive','broken','moved')),
  last_checked_at timestamptz,
  created_at timestamptz default now()
);
create table profiles (
  user_id uuid primary key references auth.users(id),
  role text check (role in ('user','admin')) default 'user',
  wallet_address text,
  created_at timestamptz default now()
);
create table watchlist (
  user_id uuid references auth.users(id),
  asset_id text references assets(id),
  primary key (user_id, asset_id)
);
create table link_events (
  id bigint generated always as identity primary key,
  ts timestamptz default now(),
  type text check (type in ('modal_open','link_click')),
  asset_id text, link_id uuid, session_id text
);
create table link_candidates (
  id uuid primary key default gen_random_uuid(),
  asset_id text, category text, name text, href text,
  reason text, source text, trust_score real,
  status text check (status in ('pending','approved','rejected')) default 'pending',
  found_at timestamptz default now()
);
```

**RLS:** profiles/watchlist — только свои строки; assets/links — публичное чтение, запись только `admin`; `link_events` — вставка через service role (сервер).

---

## 6. API-контракты

```ts
// Цены (edge-прокси к CoinGecko, кеш в Redis 10–30с)
GET /api/prices?ids=bitcoin,ethereum
  -> { quotes: Record<string, { price:number; change24h:number; ts:number }> }

// Спарклайны 24ч (CoinGecko market_chart?days=1, даунсемпл ~24 точки, кеш ~5 мин)
GET /api/sparklines?ids=bitcoin,ethereum&window=24h
  -> { series: Record<string, number[]> }

// События для ранжирования (без PII)
POST /api/events  body: { type:'modal_open'|'link_click'; assetId:string; linkId?:string; sessionId:string }
```

Спарклайн рисуем **своим inline SVG** (цвет по знаку 24ч), а не картинкой CoinGecko (та только 7д и растр).

---

## 7. Порядок работы

### Фаза 0 — миграция каталога (делаем первой, отдельно)
- [ ] Скрипт импорта `catalog.seed.json` → таблицы `assets` + `links` (маппинг из раздела 3).
- [ ] Подбор `coingecko_id` для всех активов (словарь + проверка).
- [ ] Health-check всех `href` → проставить `health`, пометить `https://#` и `!` как broken.
- [ ] Отчёт: сколько активов/ссылок импортировано, сколько битых.

### Фаза 1 — каркас + данные
- [ ] `create-next-app` (App Router, TS strict, Tailwind), новая дизайн-система из раздела 4 (токены, тёмная тема).
- [ ] Компоненты: `AssetTable`, `AssetRow`, `Sparkline` (SVG), `ResponsiveSheet` (Dialog+vaul), `LinkList`, `CategorySegments`, `PriceCell`.
- [ ] Каталог из Supabase, отдаётся через ISR. Первый экран без запросов к БД.
- [ ] Кликабельность имени и графика по разделу 4. Deep-link `/asset/[id]`.
- [ ] Docker Compose: web + supabase-стек + redis за Caddy/Nginx.

### Дальше (не сейчас)
Фаза 2 — живые цены + TradingView + спарклайны • Фаза 3 — аккаунты/синк + Web3 (EVM/SIWE на старте) • Фаза 4 — адаптив/deep-links • Фаза 5 — ранжирование + админка • Фаза 6 — ИИ-поддержка каталога (health-check + ежемесячный discovery с ревью человеком).

---

## 8. Правила для ИИ-разработчика

- **Не переноси старый Angular-код и старый дизайн.** Бери из старого только данные (`catalog.seed.json`).
- **Данные — из `catalog.seed.json`**, не парси HTML и не ходи в старую MySQL.
- Разделяй два потока данных: **каталог** (статика/ISR) и **живые котировки** (клиент через прокси). Не смешивай.
- **Human-in-the-loop для ИИ-находок:** новые ссылки от discovery НЕ публикуются автоматически — только через `link_candidates` (pending) и ручной Approve (особенно важно в крипте — риск фишинга).
- `manual_rank` всегда перебивает `ai_score`.
- Скрывай API-ключи на сервере (прокси), ставь rate-limit и кеш.
- TypeScript strict, без `any` без необходимости. Компоненты доступные (a11y из раздела 4).
- Секреты — через env, не в коде.

## 9. Критерии приёмки Фазы 0–1

- [ ] В БД 203 актива и ~6.5k ссылок с корректными категориями; битые ссылки помечены.
- [ ] Таблица открывается мгновенно (каталог в HTML, без спиннера); цены — отдельно (на Фазе 1 можно заглушкой/скелетоном).
- [ ] Имя и спарклайн **визуально и функционально** кликабельны (3 сигнала affordance); открывают разные вкладки карточки.
- [ ] Тёмная тема по умолчанию + переключатель светлой; токены через CSS-переменные.
- [ ] Поднимается через `docker compose up` на Linux/WSL2; есть README по запуску на Windows (Docker Desktop + WSL2).
- [ ] LCP < 1.5s, CLS < 0.05 на странице списка.

## 10. Env (понадобятся по фазам)

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
COINGECKO_API_KEY=
REDIS_URL=
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=
```
