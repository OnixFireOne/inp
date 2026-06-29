import type { Link } from "@/types/asset"
import { LinkIconBtn } from "./LinkIconBtn"

interface CategoryMeta {
  key: string
  label: string
  icon: string | null
  sort: number
}

// Stable fallback sort for categories that exist on links but aren't in the
// link_categories table (data drift). Pushes them to the end with a stable
// alpha tiebreaker — no "alphabet soup" mixed into the main ordering.
const UNKNOWN_SORT = 9999

interface LinkListProps {
  links: Link[]
  categories?: CategoryMeta[]
  /**
   * When true, render a debug badge on category headers whose key isn't
   * in the link_categories table. Public showcase should keep this OFF —
   * it's an internal data-drift marker for editors.
   */
  showUnknownBadge?: boolean
}

// Group by category. "Core" tier = Top links card (now ordered/grouped by
// the same effective category sort as Trusted).
// Trusted links = chip grid.
// Visible: icon only. Name + description shown on hover (custom tooltip span).
export function LinkList({ links, categories, showUnknownBadge = false }: LinkListProps) {
  const core = links.filter((l) => l.tier === "Core")
  const trusted = links.filter((l) => l.tier === "Trusted")

  // Sort: explicit category order (from link_categories.sort) first,
  // unknown categories pushed to the end with a stable alpha tiebreaker.
  const sortMap = new Map<string, number>()
  if (categories) {
    for (const c of categories) sortMap.set(c.key, c.sort)
  }
  const labelMap = new Map<string, string>()
  if (categories) {
    for (const c of categories) labelMap.set(c.key, c.label)
  }
  const iconMap = new Map<string, string | null>()
  if (categories) {
    for (const c of categories) iconMap.set(c.key, c.icon)
  }

  // Effective sort for any category key — known → its sort, unknown → UNKNOWN_SORT.
  function effectiveSort(key: string): number {
    return sortMap.get(key) ?? UNKNOWN_SORT
  }

  // Group Trusted links by category.
  const trustedByCategory = new Map<string, Link[]>()
  for (const l of trusted) {
    const k = l.category || "Other"
    if (!trustedByCategory.has(k)) trustedByCategory.set(k, [])
    trustedByCategory.get(k)!.push(l)
  }

  // Group Core links by category so the Top-links block can be ordered by the
  // same effective category order (per the decision in plan/admin-categ.md §8).
  const coreByCategory = new Map<string, Link[]>()
  for (const l of core) {
    const k = l.category || "Other"
    if (!coreByCategory.has(k)) coreByCategory.set(k, [])
    coreByCategory.get(k)!.push(l)
  }

  // Union of category keys that actually have links (Trusted or Core).
  const allKeys = new Set<string>([...trustedByCategory.keys(), ...coreByCategory.keys()])

  const orderedKeys = Array.from(allKeys).sort((a, b) => {
    const sa = effectiveSort(a)
    const sb = effectiveSort(b)
    if (sa !== sb) return sa - sb
    // Stable alpha tiebreaker for both known and unknown groups.
    return a.localeCompare(b)
  })

  // Suppress the per-chip "generated" marker when every chip on this page is
  // virtual — the header badge already conveys the state (TЗ §8.3).
  const allGenerated = links.length > 0 && links.every((l) => l.generated === true)

  // Within a category, Core and Trusted each keep their incoming order
  // (DB already orders by is_top / manual_rank / ai_score). If you ever need
  // extra sort here, do it inside the per-key section below.
  if (links.length === 0) return null

  return (
    <div className="space-y-6">
      {orderedKeys.map((category) => {
        const coreItems = coreByCategory.get(category) ?? []
        const trustedItems = trustedByCategory.get(category) ?? []
        if (coreItems.length === 0 && trustedItems.length === 0) return null
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
              {[...coreItems, ...trustedItems].map((link) => (
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
            </div>
          </section>
        )
      })}
    </div>
  )
}