// lib/links/source-registry.ts
// Provider-agnostic source registry for kind='provider' link templates.
// Each provider is a flat map of sourceKey -> SourceDef, where SourceDef
// knows how to turn a meta snapshot into a URL string, plus the defaults
// (label / icon / category / tier) used by the editor when seeding a row.
// See plan/link-templates-spec.md, section "Аспект 2" -> "2.3" and "2.4".

import type { CgMeta } from "./providers/coingecko/types"

export type SourceTier = "Core" | "Trusted"

export type SourceDef = {
  /** Pull the URL out of the snapshot. Return undefined to skip the row. */
  resolve: (m: CgMeta) => string | undefined
  defaultLabel: string
  defaultIcon: string
  defaultCategory: string
  defaultTier: SourceTier
  /** Display sample for the editor preview. */
  sample: string
}

const first = (arr?: string[]): string | undefined =>
  arr?.map((s) => s?.trim()).find(Boolean)

const handle = (base: string, raw?: string): string | undefined => {
  if (!raw) return undefined
  const h = raw.trim().replace(/^@/, "")
  if (!h) return undefined
  return /^https?:\/\//i.test(h) ? h : base + h
}

export const SOURCE_REGISTRY: Record<string, Record<string, SourceDef>> = {
  coingecko: {
    homepage: {
      resolve: (m) => first(m.links?.homepage),
      defaultLabel: "Сайт",
      defaultIcon: "🌐",
      defaultCategory: "site",
      defaultTier: "Core",
      sample: "https://bitcoin.org",
    },
    whitepaper: {
      resolve: (m) => m.links?.whitepaper || undefined,
      defaultLabel: "Whitepaper",
      defaultIcon: "📄",
      defaultCategory: "docs",
      defaultTier: "Trusted",
      sample: "https://bitcoin.org/bitcoin.pdf",
    },
    twitter: {
      resolve: (m) => handle("https://x.com/", m.links?.twitter_screen_name),
      defaultLabel: "X (Twitter)",
      defaultIcon: "🐦",
      defaultCategory: "social",
      defaultTier: "Trusted",
      sample: "https://x.com/bitcoin",
    },
    telegram: {
      resolve: (m) => handle("https://t.me/", m.links?.telegram_channel_identifier),
      defaultLabel: "Telegram",
      defaultIcon: "✈️",
      defaultCategory: "social",
      defaultTier: "Trusted",
      sample: "https://t.me/bitcoin",
    },
    reddit: {
      resolve: (m) => m.links?.subreddit_url || undefined,
      defaultLabel: "Reddit",
      defaultIcon: "👽",
      defaultCategory: "social",
      defaultTier: "Trusted",
      sample: "https://reddit.com/r/bitcoin",
    },
    github: {
      resolve: (m) => first(m.links?.repos_url?.github),
      defaultLabel: "GitHub",
      defaultIcon: "💻",
      defaultCategory: "team",
      defaultTier: "Trusted",
      sample: "https://github.com/bitcoin/bitcoin",
    },
    forum: {
      resolve: (m) => first(m.links?.official_forum_url),
      defaultLabel: "Форум",
      defaultIcon: "💬",
      defaultCategory: "social",
      defaultTier: "Trusted",
      sample: "https://bitcointalk.org",
    },
    explorer: {
      resolve: (m) => first(m.links?.blockchain_site),
      defaultLabel: "Эксплорер",
      defaultIcon: "🔎",
      defaultCategory: "explorer",
      defaultTier: "Trusted",
      sample: "https://blockchair.com/bitcoin",
    },
  },
}

/**
 * Resolve a single provider source against a snapshot.
 * Returns null when the source key is unknown or the snapshot has no value
 * for it — the resolver (Aspect 3) will then skip the row entirely.
 */
export function resolveSource(
  provider: string,
  key: string,
  m: CgMeta,
): string | null {
  const url = SOURCE_REGISTRY[provider]?.[key]?.resolve(m)
  return url ? normalizeUrl(url) : null
}

/**
 * Normalize a URL for storage and dedup:
 *  - trim surrounding whitespace
 *  - ensure https:// scheme
 *  - strip a single trailing slash so ".../foo" and ".../foo/" dedup correctly
 */
export function normalizeUrl(u: string): string {
  let s = u.trim()
  if (!/^https?:\/\//i.test(s)) s = "https://" + s
  return s.replace(/\/+$/, "")
}