import type { Link } from "@/types/asset"
import { LinkIconBtn } from "./LinkIconBtn"

interface CategoryMeta {
  key: string
  label: string
  icon: string | null
  sort: number
}

interface LinkListProps {
  links: Link[]
  categories?: CategoryMeta[]
}

// Group by category. "Core" tier = Top links card.
// Trusted links = chip grid.
// Visible: icon only. Name + description shown on hover (custom tooltip span).
export function LinkList({ links, categories }: LinkListProps) {
  const core = links.filter((l) => l.tier === "Core")
  const trusted = links.filter((l) => l.tier === "Trusted")

  // Sort: explicit category order (from link_categories.sort) first,
  // then any unmapped categories alphabetically at the end.
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

  const byCategory = new Map<string, Link[]>()
  for (const l of trusted) {
    const k = l.category || "Other"
    if (!byCategory.has(k)) byCategory.set(k, [])
    byCategory.get(k)!.push(l)
  }

  const orderedKeys = Array.from(byCategory.keys()).sort((a, b) => {
    const sa = sortMap.get(a)
    const sb = sortMap.get(b)
    if (sa != null && sb != null) return sa - sb
    if (sa != null) return -1
    if (sb != null) return 1
    return a.localeCompare(b)
  })

  if (links.length === 0) return null

  return (
    <div className="space-y-6">
      {core.length > 0 && (
        <section>
          <div className="text-xs uppercase tracking-wide text-[var(--text-mut)] mb-2">Top links</div>
          <div className="flex flex-wrap gap-2">
            {core.map((link) => (
              <LinkIconBtn
                key={link.id}
                href={link.href}
                thumbnailUrl={link.thumbnailUrl}
                name={link.name}
                description={link.description}
                size={28}
              />
            ))}
          </div>
        </section>
      )}

      {orderedKeys.map((category) => {
        const items = byCategory.get(category)!
        const label = labelMap.get(category) ?? category
        const icon = iconMap.get(category) ?? null
        return (
          <section key={category}>
            <div className="text-xs uppercase tracking-wide text-[var(--text-mut)] mb-2">
              {icon ? `${icon} ` : ""}{label}
            </div>
            <div className="flex flex-wrap gap-2">
              {items.map((link) => (
                <LinkIconBtn
                  key={link.id}
                  href={link.href}
                  thumbnailUrl={link.thumbnailUrl}
                  name={link.name}
                  description={link.description}
                  size={20}
                />
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}
