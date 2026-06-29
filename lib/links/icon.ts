// lib/links/icon.ts
// Pure classification helpers for link icons.
//
// Priority (TЗ §3.4 / §8.4):
//   1. emoji       (icon is not a URL and not "favicon")
//   2. image URL   (icon is an absolute http(s) URL)
//   3. none        (icon is missing or the literal "favicon" sentinel)
//
// faviconFor() builds the Google favicon URL for a given href. It returns
// null for hrefs that aren't valid http(s) URLs (empty, "#", relative paths),
// so the caller can skip favicon and fall straight to the letter.

const URL_RE = /^https?:\/\//i

export type IconKind = "emoji" | "img" | "none"

export function classifyIcon(icon: string | null | undefined): {
  kind: IconKind
  value?: string
} {
  if (!icon || icon === "favicon") return { kind: "none" }
  return URL_RE.test(icon) ? { kind: "img", value: icon } : { kind: "emoji", value: icon }
}

export function faviconFor(href: string): string | null {
  try {
    const u = new URL(href)
    if (!/^https?:$/i.test(u.protocol)) return null
    const host = u.hostname.replace(/^www\./, "")
    if (!host) return null
    return `https://www.google.com/s2/favicons?domain=${host}&sz=64`
  } catch {
    return null
  }
}

export function letterFor(name: string): string {
  const trimmed = (name || "").trim()
  return (trimmed[0] ?? "·").toUpperCase()
}