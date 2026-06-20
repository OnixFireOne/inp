// lib/site.ts
// Centralized site URL. Used for server-side fetch base and absolute metadata URLs.
// On VPS set NEXT_PUBLIC_SITE_URL=https://inp.one.
export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"
