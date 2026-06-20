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
