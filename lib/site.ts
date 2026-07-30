// lib/site.ts
// Centralized site URL. Used for server-side fetch base and absolute metadata URLs.
// On VPS set NEXT_PUBLIC_SITE_URL=https://inp.one.
export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"

// Базовый URL для серверных запросов приложения к самому себе.
// В контейнере Next слушает 127.0.0.1:3000 → ходим напрямую, без публичного
// домена, Caddy, DNS и TLS. SITE_URL остаётся ТОЛЬКО для canonical/OG.
export const INTERNAL_BASE_URL =
  process.env.INTERNAL_BASE_URL ?? "http://127.0.0.1:3000"

// Next.js `fetch` revalidate window for the SSR markets prefetch.
// MUST stay >= the upstream /api/markets cache TTL (TTL in route.ts) so the
// page never re-fetches the route more often than the data actually
// changes. Default 120s mirrors TTL — see plan/mobile-fix.md (Task 5).
export const MARKETS_REVALIDATE_SECONDS = Number(
  process.env.MARKETS_REVALIDATE_SECONDS ?? 120,
)

