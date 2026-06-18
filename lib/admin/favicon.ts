// lib/admin/favicon.ts
// Resolve a favicon URL for a given external href.
// Uses Google's s2 favicon service — small, public, no API key.
// We strip "www." for consistency; the service tolerates bare hostnames.
export function faviconUrl(href: string, size: 16 | 32 | 64 | 128 = 64): string | null {
  try {
    const u = new URL(href)
    if (!/^https?:$/.test(u.protocol)) return null
    const host = u.hostname.replace(/^www\./, "")
    if (!host) return null
    return `https://www.google.com/s2/favicons?domain=${host}&sz=${size}`
  } catch {
    return null
  }
}
