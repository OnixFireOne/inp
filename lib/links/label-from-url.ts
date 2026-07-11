// lib/links/label-from-url.ts
// Derive a human label from a URL's hostname as a default for links whose
// `label`/`name` is empty.
//
//   labelFromUrl("https://blockchair.com/btc")         // "Blockchair"
//   labelFromUrl("https://explorer.solana.com/...")     // "Solana"
//   labelFromUrl("https://www.coingecko.com/...")       // "Coingecko"
//
// Used as the universal default — applies to BOTH virtual (generated) and
// curated (materialized) links, plus as a prefill in the LinksEditor. See
// plan/contract-links.md, decision #8.

const OVERRIDES: Record<string, string> = {
  "x.com": "X (Twitter)",
  "twitter.com": "X (Twitter)",
  "t.me": "Telegram",
  "github.com": "GitHub",
}

export function labelFromUrl(url: string): string | undefined {
  if (!url || typeof url !== "string") return undefined
  let host: string
  try {
    host = new URL(url).hostname
  } catch {
    return undefined
  }
  if (!host) return undefined
  host = host.replace(/^www\./, "")
  if (OVERRIDES[host]) return OVERRIDES[host]
  const parts = host.split(".").filter(Boolean)
  if (parts.length === 0) return undefined
  // Take the second-level domain (the "brand" in a typical host):
  //   blockchair.com              -> "blockchair"
  //   explorer.solana.com         -> "solana"
  //   dexscreener.com             -> "dexscreener"
  //   coingecko.com               -> "coingecko"
  const name = parts.length >= 2 ? parts[parts.length - 2] : parts[0]
  if (!name) return undefined
  return name.charAt(0).toUpperCase() + name.slice(1)
}