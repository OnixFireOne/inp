// lib/links/resolve.ts
// Pure resolver: turns enabled link_templates rows + asset vars + provider
// snapshots into ready-to-render GeneratedLink[]. No I/O, fully testable.
// See plan/link-templates-spec.md, section "Аспект 3".

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
        ? applyPattern(t.url_pattern ?? "", asset)
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
      label: renderText(t.label, asset),
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
