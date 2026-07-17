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

/**
 * Outcome of probing whether a single template would produce a URL right
 * now — and, if not, WHY. This is the single source of truth shared by
 * `expandTemplates` (real rendering) and `countPendingTemplates` (shimmer
 * reservation): both call this probe, then branch on the result. Any new
 * resolution rule (new provider, new kind, new {token}) only needs to be
 * implemented here once.
 *
 * Why the three states:
 *   - `resolved`    — a link would render with this `metaByProvider` now.
 *                    Both expandTemplates and countPendingTemplates consume.
 *   - `pending-meta`— no link now, but the same template WOULD link once
 *                    the missing provider snapshot arrives (e.g. twitter
 *                    template without meta coingecko row). countPending
 *                    reserves a shimmer slot here; expandTemplates skips.
 *   - `unresolvable`— no link, and no amount of fetching will produce one:
 *                    empty ticker dropping a {symbol} pattern, an
 *                    unknown source_key, or a {contract} template whose
 *                    chain is not in the chain_map even WITH the current
 *                    snapshot. Both functions must agree this is not
 *                    pending — otherwise reserved shimmers would dangle.
 */
export type ResolveOutcome =
  | { status: "resolved"; url: string }
  | { status: "pending-meta" }
  | { status: "unresolvable" }

/**
 * Probe whether `t` would produce a link under `metaByProvider`. This is
 * the same probe expandTemplates uses to decide rendering and is the only
 * place that knows how a template's URL is computed. Centralising the
 * rule means `countPendingTemplates` cannot disagree with the real
 * resolver: if the probe says `pending-meta`, a shimmer is reserved AND
 * a link will appear once meta arrives; if the probe says `unresolvable`,
 * no shimmer and no link; if `resolved`, a link now and no shimmer.
 *
 * Disabled templates are NOT probes' business — callers skip them on the
 * outside so `enabled: false` semantics stay in one place.
 */
export function tryResolveTemplate(
  t: LinkTemplate,
  asset: AssetVars,
  metaByProvider: Record<string, unknown>,
): ResolveOutcome {
  if (t.kind === "pattern") {
    if (isContractPattern(t.url_pattern)) {
      const cgMeta = metaByProvider.coingecko as CgMeta | undefined
      if (!cgMeta) return { status: "pending-meta" }
      // Meta exists. Same shared call as the real resolver — guarantees the
      // chain_map decision is identical.
      const url = expandContractPattern(t.url_pattern ?? "", t.chain_map, cgMeta)
      return url ? { status: "resolved", url } : { status: "unresolvable" }
    }
    // {slug}/{symbol} pattern: depends only on AssetVars, which is always
    // populated. An empty ticker drops {symbol}, but that has nothing to
    // do with provider meta, so it's unresolvable (not pending).
    const url = applyPattern(t.url_pattern ?? "", asset)
    return url ? { status: "resolved", url } : { status: "unresolvable" }
  }

  // Provider kind. We use the SAME `resolveSource` call as the real
  // resolver — if the snapshot for this provider is present, we resolve
  // through the registry; if not, this is meta-pending. resolveSource
  // returns `null` for unknown providers/keys, which we map to
  // "unresolvable" so it doesn't get a reserved slot it can never fill.
  const provider = t.provider ?? ""
  const snapshot = metaByProvider[provider]
  if (!snapshot) return { status: "pending-meta" }
  const url = resolveSource(
    provider,
    t.source_key ?? "",
    snapshot as Parameters<typeof resolveSource>[2],
  )
  return url ? { status: "resolved", url } : { status: "unresolvable" }
}

export function expandTemplates(
  templates: LinkTemplate[],
  asset: AssetVars,
  metaByProvider: Record<string, unknown>,
): GeneratedLink[] {
  const out: GeneratedLink[] = []

  for (const t of templates) {
    if (!t.enabled) continue
    const r = tryResolveTemplate(t, asset, metaByProvider)
    if (r.status !== "resolved") continue

    out.push({
      id: `tpl:${t.id}`,
      url: r.url,
      label: resolveLabel(t.label, asset, r.url),
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

/**
 * For a cold coin (no curated links + meta missing) the storefront needs to
 * reserve UI space for the links that WILL appear once the CoinGecko
 * snapshot arrives. This pure function answers:
 *   "given the templates that WOULD resolve if `metaByProvider` were
 *    present, how many of those would land in each category?"
 *
 * The probe (`tryResolveTemplate`) is the SINGLE source of truth shared
 * with `expandTemplates`. If the probe ever says `pending-meta`, this
 * function reserves the slot; if it says `unresolvable`, no slot — the
 * two callers cannot diverge on a future chain_map / source_key edit.
 *
 * Returned totals are the SOURCE OF TRUTH for the prefetch-time shimmer
 * counts. {slug}/{symbol}-only patterns never go through this branch
 * (the probe resolves them with empty ticker as `unresolvable`, not
 * `pending-meta`).
 */
export type PendingByCategory = {
  /** category key (templates[i].category) → count of meta-dependent templates
   *  in that category that the probe classified as `pending-meta`. */
  byCategory: Record<string, number>
  /** True if ANY provider template was classified as `pending-meta`. */
  hasProviderPending: boolean
  /** True if any {contract} pattern template was classified as `pending-meta`. */
  hasContractPending: boolean
}

export function countPendingTemplates(
  templates: LinkTemplate[],
  asset: AssetVars,
  metaByProvider: Record<string, unknown>,
): PendingByCategory {
  const byCategory: Record<string, number> = {}
  let hasProviderPending = false
  let hasContractPending = false

  for (const t of templates) {
    if (!t.enabled) continue
    const r = tryResolveTemplate(t, asset, metaByProvider)
    if (r.status !== "pending-meta") continue

    byCategory[t.category] = (byCategory[t.category] ?? 0) + 1
    if (t.kind === "provider") {
      hasProviderPending = true
    } else if (isContractPattern(t.url_pattern)) {
      hasContractPending = true
    }
  }

  return { byCategory, hasProviderPending, hasContractPending }
}