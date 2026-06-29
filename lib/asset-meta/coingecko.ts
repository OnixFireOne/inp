// lib/asset-meta/coingecko.ts
// Thin HTTP wrapper around CoinGecko /coins/{id} + the canonical trim from
// the (rich, unstable) raw response into our frozen CgMeta type.
// See plan/link-templates-spec.md, sections "Аспект 2.1" and "Аспект 4.3".

import type { CgMeta } from "../links/providers/coingecko/types"

export const COINGECKO_BASE =
  process.env.COINGECKO_BASE || "https://api.coingecko.com/api/v3"

function cgHeaders(): Record<string, string> {
  const key = process.env.COINGECKO_API_KEY || ""
  if (!key) return {}
  const isPro = COINGECKO_BASE.includes("pro-api")
  return { [isPro ? "x-cg-pro-api-key" : "x-cg-demo-api-key"]: key }
}

export type FetchCoinMetaResult =
  | { ok: true; data: CgMeta }
  | { ok: false; status: 404 | "error" }

/**
 * Fetch the trimmed coin snapshot from CG. Only fields declared in CgMeta
 * survive `trimCgMeta`; everything else is dropped at the boundary so we
 * never persist CG's full payload.
 *
 * The response flag mirrors CG HTTP semantics:
 *   404 → id does not exist (caller should negative-cache)
 *   anything else non-2xx → transient error (do NOT negative-cache)
 */
export async function fetchCoinMeta(id: string): Promise<FetchCoinMetaResult> {
  const url =
    `${COINGECKO_BASE}/coins/${encodeURIComponent(id)}` +
    `?localization=false&tickers=false&market_data=false` +
    `&community_data=false&developer_data=false&sparkline=false`

  let res: Response
  try {
    res = await fetch(url, { headers: cgHeaders(), cache: "no-store" })
  } catch {
    return { ok: false, status: "error" }
  }

  if (res.status === 404) return { ok: false, status: 404 }
  if (!res.ok) return { ok: false, status: "error" }

  let raw: unknown
  try {
    raw = await res.json()
  } catch {
    return { ok: false, status: "error" }
  }

  if (!raw || typeof raw !== "object") {
    return { ok: false, status: "error" }
  }

  return { ok: true, data: trimCgMeta(raw as Record<string, unknown>) }
}

/**
 * Trim an arbitrary CG response to the fields CgMeta actually declares.
 * `links` is always rewritten as a fresh object so we don't accidentally
 * keep CG-side extras (e.g. announcements_url, snapshot_url).
 */
export function trimCgMeta(raw: Record<string, unknown>): CgMeta {
  const r = raw as Record<string, any>
  const links = (r.links ?? {}) as Record<string, any>

  const cg: CgMeta = {
    links: {
      homepage: arrayOfStrings(links.homepage),
      whitepaper: stringOrUndefined(links.whitepaper),
      blockchain_site: arrayOfStrings(links.blockchain_site),
      official_forum_url: arrayOfStrings(links.official_forum_url),
      chat_url: arrayOfStrings(links.chat_url),
      twitter_screen_name: stringOrUndefined(links.twitter_screen_name),
      telegram_channel_identifier: stringOrUndefined(
        links.telegram_channel_identifier,
      ),
      subreddit_url: stringOrUndefined(links.subreddit_url),
      repos_url:
        links.repos_url && typeof links.repos_url === "object"
          ? {
              github: arrayOfStrings(
                (links.repos_url as Record<string, unknown>).github,
              ),
            }
          : undefined,
    },
  }

  if (r.detail_platforms && typeof r.detail_platforms === "object") {
    const dp: CgMeta["detail_platforms"] = {}
    for (const [chain, info] of Object.entries(
      r.detail_platforms as Record<string, unknown>,
    )) {
      if (!info || typeof info !== "object") continue
      const i = info as Record<string, unknown>
      const addr = i.contract_address
      const dec = i.decimal_place
      if (typeof addr !== "string" || !addr) continue
      dp[chain] = {
        contract_address: addr,
        decimal_place:
          typeof dec === "number"
            ? dec
            : dec == null
              ? null
              : Number(dec) || null,
      }
    }
    cg.detail_platforms = dp
  }

  if (r.image && typeof r.image === "object") {
    const img = r.image as Record<string, unknown>
    const thumb = stringOrUndefined(img.thumb)
    const small = stringOrUndefined(img.small)
    const large = stringOrUndefined(img.large)
    if (thumb || small || large) {
      cg.image = { thumb, small, large }
    }
  }

  return cg
}

function arrayOfStrings(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined
  const out: string[] = []
  for (const x of v) if (typeof x === "string" && x) out.push(x)
  return out.length ? out : undefined
}

function stringOrUndefined(v: unknown): string | undefined {
  return typeof v === "string" && v ? v : undefined
}