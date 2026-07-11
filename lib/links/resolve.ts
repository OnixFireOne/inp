// lib/links/resolve.ts
// Pure resolver: turns enabled link_templates rows + asset vars + provider
// snapshots into ready-to-render GeneratedLink[]. No I/O, fully testable.
// See plan/link-templates-spec.md, section "Аспект 3".

import { expandContractPattern, isContractPattern } from "./contract-pattern"
import { labelFromUrl } from "./label-from-url"
import type { CgMeta } from "./providers/coingecko/types"
import { applyPattern, type AssetVars } from "./template-vars"
import { normalizeUrl, resolveSource } from "./source-registry"

export type LinkTemplate = {
  id: string
  kind: "pattern" | "provider"
  /** NOT NULL in the schema — the row's category is the source of truth. */
  category: string
  /** May contain {slug}/{symbol}/{symbol_lower}. */
  label: string
  icon?: string | null
  url_pattern?: string | null
  provider?: string | null
  source_key?: string | null
  /**
   * Contract-link chain map: CoinGecko chain key → this site's slug.
   * Only meaningful when url_pattern contains {contract}; ignored otherwise.
   * jsonb in DB; parsed at the row level (templates-cache deserialises it).
   */
  chain_map?: Record<string, string> | null
  tier: "Core" | "Trusted"
  sort: number
  enabled: boolean
}

/**
 * Matches the storefront `Link` shape (LinkList/LinkIconBtn) plus a few
 * virtual-only fields: `generated` flag (so the UI can render "auto" tags
 * and the materializer can de-prioritize them) and `_sort` (resolver-internal
 * ordering inside a category; not exposed to the UI).
 */
export type GeneratedLink = {
  id: string
  url: string
  label: string
  icon?: string
  category: string
  tier: "Core" | "Trusted"
  generated: true
  is_top: false
  manual_rank: null
  ai_score: null
  /** Ordering WITHIN category. Resolver-internal; not exposed to the UI. */
  _sort: number
}

/**
 * Resolve a label template with the same variable set as applyPattern,
 * but here we DO NOT encode (labels are display text) and we DO NOT bail
 * when a token fails — it just renders empty. That matches the spec:
 * "подстановка {var} в текст label — без encode и без отбраковки".
 */
function renderText(tpl: string, a: AssetVars): string {
  return tpl.replace(/\{(\w+)\}/g, (_match, k: string) => {
    if (k === "symbol") return a.ticker?.toUpperCase() ?? ""
    if (k === "symbol_lower") return a.ticker?.toLowerCase() ?? ""
    if (k === "slug") return a.coingecko_id
    return ""
  })
}

/**
 * Final label for a generated link:
 *   1) template label with {slug}/{symbol} substituted
 *   2) if that resolved to empty — derive from the URL hostname
 *   3) if hostname parsing also fails — fall back to "Ссылка"
 *
 * Applied uniformly so every generated link has a displayable name.
 */
function resolveLabel(templateLabel: string, asset: AssetVars, url: string): string {
  const rendered = renderText(templateLabel, asset).trim()
  if (rendered) return rendered
  return labelFromUrl(url) ?? "Ссылка"
}

/**
 * Drop duplicate URLs, keeping the first in stable (category, _sort) order.
 * Note: `category` ordering is alphabetical here — the final category order
 * for the storefront is applied later in /api/links (Aspect 5) using
 * link_categories.sort + assets.category_orders.
 */
function dedupeByUrl(links: GeneratedLink[]): GeneratedLink[] {
  const seen = new Set<string>()
  return links
    .slice()
    .sort(
      (a, b) => a.category.localeCompare(b.category) || a._sort - b._sort,
    )
    .filter((l) => {
      const k = normalizeUrl(l.url)
      if (seen.has(k)) return false
      seen.add(k)
      return true
    })
}

export function expandTemplates(
  templates: LinkTemplate[],
  asset: AssetVars,
  metaByProvider: Record<string, unknown>,
): GeneratedLink[] {
  const out: GeneratedLink[] = []

  for (const t of templates) {
    if (!t.enabled) continue

    const provider = t.provider ?? ""
    const url =
      t.kind === "pattern"
        ? isContractPattern(t.url_pattern)
          ? expandContractPattern(
              t.url_pattern ?? "",
              t.chain_map,
              metaByProvider.coingecko as CgMeta | undefined,
            ) ?? null
          : applyPattern(t.url_pattern ?? "", asset)
        : metaByProvider[provider]
          ? resolveSource(
              provider,
              t.source_key ?? "",
              metaByProvider[provider] as Parameters<typeof resolveSource>[2],
            )
          : null

    if (!url) continue

    out.push({
      id: `tpl:${t.id}`,
      url,
      label: resolveLabel(t.label, asset, url),
      icon: t.icon ?? undefined,
      category: t.category,
      tier: t.tier,
      generated: true,
      is_top: false,
      manual_rank: null,
      ai_score: null,
      _sort: t.sort,
    })
  }

  return dedupeByUrl(out)
}
