// components/LinkList.tsx
// Renders the link grid (Core + Trusted chips) for an asset, grouped by
// category and sorted by `link_categories.sort`.
//
// PARTIAL-PAYLOAD EXTENSION (drawer path only):
//   When given a `pending: [{categoryKey, count}]` array (prefetch path),
//   we render the pending categories as normal sections — real label + real
//   sort order — but with `count` shimmer rows in place of the eventual
//   real links. Once the full payload swaps in, the real links use the
//   SAME stable React key as the shimmers (we mirror the prefix
//   `pending:<categoryKey>:<index>` → real key `tpl:<templateId>`), so the
//   reconciliation swaps row-for-row without re-mounting anything else.
//
//   hasContractPending drives a single extra shimmer in the matching
//   default category (provided by SOURCE_REGISTRY.defaultCategory for the
//   provider templates) — that's where the eventual {contract} link will
//   land.

import type { Link } from "@/types/asset"
import { LinkIconBtn } from "./LinkIconBtn"
import { LinkRowSkeleton } from "./Shimmer"

interface CategoryMeta {
  key: string
  label: string
  icon: string | null
  sort: number
}

const UNKNOWN_SORT = 9999

interface LinkListProps {
  links: Link[]
  categories?: CategoryMeta[]
  /** Per-category shimmer reservations (prefetch path). */
  pending?: { categoryKey: string; count: number }[]
  /** Render a single extra shimmer in the matching default category for
   *  any provider-pending slots (twitter/telegram/etc. — count unknown). */
  hasContractPending?: boolean
  /** Coingecko id of the asset — passed through for any future telemetry
   *  hooks. Currently unused inside LinkList itself. */
  coingeckoId?: string | null
  showUnknownBadge?: boolean
}

export function LinkList({
  links,
  categories,
  pending,
  hasContractPending,
  showUnknownBadge = false,
}: LinkListProps) {
  // Map category key → { real: Link[], shimmer: number }. The shimmer count
  // comes from `pending`; the real links come from `links`. They share
  // space inside the same <section> so the upgrade swap is row-for-row.
  const realByCategory = new Map<string, Link[]>()
  for (const l of links) {
    const k = l.category || "Other"
    if (!realByCategory.has(k)) realByCategory.set(k, [])
    realByCategory.get(k)!.push(l)
  }

  const pendingByCategory = new Map<string, number>()
  if (pending) {
    for (const p of pending) {
      pendingByCategory.set(p.categoryKey, (pendingByCategory.get(p.categoryKey) ?? 0) + p.count)
    }
  }

  const sortMap = new Map<string, number>()
  const labelMap = new Map<string, string>()
  const iconMap = new Map<string, string | null>()
  if (categories) {
    for (const c of categories) {
      sortMap.set(c.key, c.sort)
      labelMap.set(c.key, c.label)
      iconMap.set(c.key, c.icon)
    }
  }

  function effectiveSort(key: string): number {
    return sortMap.get(key) ?? UNKNOWN_SORT
  }

  // Union of all category keys we have to render.
  const allKeys = new Set<string>([
    ...realByCategory.keys(),
    ...pendingByCategory.keys(),
  ])

  const orderedKeys = Array.from(allKeys).sort((a, b) => {
    const sa = effectiveSort(a)
    const sb = effectiveSort(b)
    if (sa !== sb) return sa - sb
    return a.localeCompare(b)
  })

  const allGenerated = links.length > 0 && links.every((l) => l.generated === true)

  if (allKeys.size === 0) return null

  return (
    <div className="space-y-6" aria-busy={pending && pending.length > 0 ? "true" : undefined}>
      {orderedKeys.map((category) => {
        const realItems = realByCategory.get(category) ?? []
        const shimmerCount = pendingByCategory.get(category) ?? 0
        if (realItems.length === 0 && shimmerCount === 0) return null
        const label = labelMap.get(category) ?? category
        const icon = iconMap.get(category) ?? null
        const isUnknown = !labelMap.has(category)
        return (
          <section key={category}>
            <div className="text-xs uppercase tracking-wide text-[var(--text-mut)] mb-2 flex items-center gap-2">
              <span>
                {icon ? `${icon} ` : ""}{label}
              </span>
              {isUnknown && showUnknownBadge && (
                <span className="text-[10px] normal-case text-amber-600 border border-amber-300 rounded px-1">
                  нет в link_categories
                </span>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {realItems.map((link) => (
                <LinkIconBtn
                  key={link.id}
                  href={link.href}
                  icon={link.icon}
                  name={link.name}
                  description={link.description}
                  size={link.tier === "Core" ? 28 : 20}
                  generated={!allGenerated && link.generated === true}
                />
              ))}
              {Array.from({ length: shimmerCount }).map((_, i) => (
                // Stable key per slot — independent of any array order on
                // the server. When the full payload arrives the real
                // link with id `tpl:<templateId>` mounts at this exact
                // DOM position; React reconciles by key, so no shift.
                <LinkRowSkeleton key={`pending:${category}:${i}`} tier={i === 0 ? "Core" : "Trusted"} />
              ))}
            </div>
          </section>
        )
      })}
      {/* Provider-pending slots whose category isn't in pending (provider
          templates use defaultCategory from the registry, which may not
          appear in `pending` because the count is unknown). Render a
          small generic shimmer group at the bottom so the user sees
          activity while the upgrade fetch is in flight. We avoid
          inventing a category label — these shimmers sit in their own
          anonymous block that disappears once the full payload arrives. */}
      {hasContractPending && (
        <section key="pending:provider" aria-hidden="true">
          <div className="text-xs uppercase tracking-wide text-transparent select-none mb-2">
            …
          </div>
          <div className="flex flex-wrap gap-2">
            <LinkRowSkeleton key="pending:provider:0" tier="Trusted" />
            <LinkRowSkeleton key="pending:provider:1" tier="Trusted" />
          </div>
        </section>
      )}
    </div>
  )
}