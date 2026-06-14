# STACK_VERSIONS.md — актуальные версии (июнь 2026)

> Цель: зафиксировать свежие и БЕЗОПАСНЫЕ версии. Бриф писался под Next.js 15 — обновляем до 16.
> Важно по безопасности: в React Server Components (Next 13–16) были критичные CVE (вплоть до RCE CVSS 10.0). Ставить ТОЛЬКО последние патчи.

---

## Runtime

| Что | Версия | Комментарий |
|---|---|---|
| Node.js | **24 LTS (Krypton)** | LTS до апреля 2028. Берём её. НЕ брать v25 (уже EOL) и v26 (Current, не LTS — для прода рано). |

`package.json`:
```json
{
  "engines": { "node": ">=24" }
}
```

---

## Основные зависимости

| Пакет | Было в брифе | Ставим сейчас | Примечание |
|---|---|---|---|
| `next` | 15 | **16.2.x (latest)** | Next 16 — текущий мажор. Cache Components, Turbopack FS cache. Обязательно latest-патч (CVE). |
| `react` / `react-dom` | 18/19 | **19.2.x (latest)** | React 19 стабилен. Берём ПАТЧЕНЫЙ 19.2.x (ранние 19.x имели уязвимости). |
| `typescript` | strict | **5.9.x (latest)** | strict mode остаётся. |
| `tailwindcss` | — | **4.3.x** | ⚠️ v4 — другая конфигурация (см. ниже). НЕ v3. |
| `@tanstack/react-query` | v5 | **5.x (latest)** | v5 — текущий мажор для React, v6 пока нет. Уже актуально. |
| `@supabase/supabase-js` | — | **2.x (latest)** | + `@supabase/ssr` (современная замена auth-helpers). |
| `@supabase/ssr` | — | **latest** | используем в lib/supabase/*. |
| Radix / shadcn | — | **latest** | текущие версии совместимы с Tailwind v4 + React 19. |
| `vaul` | — | **latest** | bottom-sheet; проверить совместимость с React 19. |
| `wagmi` + `viem` | — | **2.x (latest)** | Web3 EVM. |
| `siwe` | — | **latest** | SIWE-верификация. |
| `@walletconnect/*` | — | **latest** | WalletConnect. |

---

## ⚠️ Tailwind v4 — главное отличие от v3

Tailwind v4 — это CSS-first конфигурация, без `tailwind.config.js` в привычном виде, без отдельных `postcss`/`autoprefixer`.

```css
/* globals.css — v4 стиль */
@import "tailwindcss";

@theme {
  --color-bg: #0e1116;
  --color-surface: #161a22;
  --color-accent: #6e8bff;
  --color-up: #3ec98a;
  --color-down: #f0666b;
  --radius: 14px;
}
```

Т.е. наши дизайн-токены из DESIGN.md ложатся в `@theme` (или обычные CSS-переменные + `@theme inline`). Тёмная/светлая тема — через `data-theme` и переопределение переменных.

Подключение в Next.js 16: плагин `@tailwindcss/postcss` в `postcss.config.mjs` ЛИБО `@tailwindcss/vite` (если vite). Ручной `autoprefixer` больше не нужен.

---

## Что попросить ИИ сделать

1. Обновить `next`, `react`, `react-dom` до последних патчей (безопасность — критично):
```bash
npx @next/codemod@canary upgrade latest
# или вручную:
npm install next@latest react@latest react-dom@latest
```
2. Убедиться, что Tailwind = v4 и конфиг CSS-first (а не старый v3-стиль).
3. Проверить совместимость `vaul` и всех Radix-пакетов с React 19 (если peer-warning — взять свежие версии).
4. Прогнать `npm audit` и `npm outdated`, закрыть high/critical.
5. Проверить, что Codemod не сломал App Router / асинхронные API (в 16 часть API стала асинхронной — `cookies()`, `headers()` уже await, у нас в коде это учтено).

---

## Итог

- Node 24 LTS — верный выбор. ✅
- TanStack Query v5, Supabase 2.x, Radix/shadcn — уже актуальны. ✅
- Единственный реальный апгрейд: **Next.js 15 → 16** + последние патчи React (безопасность). ⚠️
- Tailwind — убедиться, что именно v4 с CSS-first конфигом.
