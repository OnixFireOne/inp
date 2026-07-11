// lib/links/contract-pattern.ts
// Generic resolver for contract-link patterns.
//
// A pattern template is treated as a contract template if its `url_pattern`
// contains `{contract}`. The resolver picks exactly one chain + address from
// the CoinGecko snapshot (`detail_platforms`), preferring the token's
// native chain (`asset_platform_id`) and falling back to the first chain
// supported by the template's `chain_map`.
//
// Returns `undefined` when nothing can be resolved — the resolver in
// resolve.ts then drops the row entirely (no broken links).
//
// See plan/contract-links.md, section "Код" -> "2. Генеричный резолвер".

import type { CgMeta } from "./providers/coingecko/types"

/**
 * Substitute `{chain}` and `{contract}` in a URL pattern.
 *
 *   chainMap  — JSONB from link_templates.chain_map: CoinGecko chain key
 *               → this site's own slug (e.g. ethereum → "ethereum" on
 *               DexScreener, ethereum → "eth" on GMGN).
 *   m         — the CoinGecko snapshot stored in asset_meta.
 *
 * Returns undefined when:
 *   - the snapshot has no detail_platforms
 *   - neither the native chain nor any chain from detail_platforms is
 *     supported by chain_map (or chain_map is empty)
 *   - the resolved chain has no usable contract_address
 */
export function expandContractPattern(
  urlPattern: string,
  chainMap: Record<string, string> | null | undefined,
  m: CgMeta | undefined,
): string | undefined {
  const dp = m?.detail_platforms
  if (!dp) return undefined

  const pick = (cgChain: string): { slug: string; addr: string } | undefined => {
    const slug = chainMap?.[cgChain]
    const addr = dp[cgChain]?.contract_address?.trim()
    return slug && addr ? { slug, addr } : undefined
  }

  // 1) native chain, 2) fallback — first chain from detail_platforms
  //    that chain_map knows about. Iteration order of Object.keys is
  //    insertion order, which is fine: the chain_map is an admin hint,
  //    not a deterministic preference.
  let hit = m?.asset_platform_id ? pick(m.asset_platform_id) : undefined
  if (!hit) {
    for (const cgChain of Object.keys(dp)) {
      hit = pick(cgChain)
      if (hit) break
    }
  }
  if (!hit) return undefined

  return urlPattern
    .replaceAll("{chain}", hit.slug)
    .replaceAll("{contract}", hit.addr)
}

/**
 * True if a pattern's url_pattern contains the {contract} placeholder and
 * therefore must be routed through `expandContractPattern` instead of
 * the standard {slug}/{symbol} substitution.
 */
export function isContractPattern(urlPattern: string | null | undefined): boolean {
  return !!urlPattern && urlPattern.includes("{contract}")
}