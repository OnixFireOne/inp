// lib/links/template-vars.ts
// Variable registry for kind='pattern' link templates.
// A pure function `applyPattern` substitutes {var} tokens, url-encodes each
// resolved value, and bails out (returns null) if ANY token didn't resolve.
// See plan/link-templates-spec.md, section "Аспект 2" -> "2.2" and "2.4".

import { normalizeUrl } from "./source-registry"

export type AssetVars = {
  coingecko_id: string
  ticker: string
}

type VarDef = {
  resolve: (a: AssetVars) => string | undefined
  /** Display sample for the editor (e.g. "bitcoin"). */
  sample: string
  /** Human description for the editor palette tooltip. */
  desc: string
}

export const TEMPLATE_VARS: Record<string, VarDef> = {
  slug: {
    resolve: (a) => a.coingecko_id,
    sample: "bitcoin",
    desc: "CoinGecko ID (уникален)",
  },
  symbol: {
    resolve: (a) => a.ticker?.toUpperCase(),
    sample: "BTC",
    desc: "Тикер, верхний регистр",
  },
  symbol_lower: {
    resolve: (a) => a.ticker?.toLowerCase(),
    sample: "btc",
    desc: "Тикер, нижний регистр",
  },
}

/**
 * Substitute `{token}` placeholders in `pattern`. Each resolved value is
 * percent-encoded so symbols with spaces or unicode don't break the URL.
 * If ANY token fails to resolve, the whole pattern is dropped (returns null)
 * — we never want to render half-broken URLs like ".../coins/undefined".
 */
export function applyPattern(pattern: string, a: AssetVars): string | null {
  let ok = true
  const out = pattern.replace(/\{(\w+)\}/g, (_, k: string) => {
    const v = TEMPLATE_VARS[k]?.resolve(a)
    if (!v) {
      ok = false
      return ""
    }
    return encodeURIComponent(v)
  })
  if (!ok) return null
  return normalizeUrl(out)
}