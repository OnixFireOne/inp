import type { Link } from "@/types/asset"
import { LinkIconBtn } from "./LinkIconBtn"

interface LinkListProps {
  links: Link[]
}

// Group by category. "Core" tier = Top links card.
// Trusted links = chip grid.
// Visible: icon only. Name + description shown on hover (custom tooltip span).
export function LinkList({ links }: LinkListProps) {
  const core = links.filter((l) => l.tier === "Core")
  const trusted = links.filter((l) => l.tier === "Trusted")

  const byCategory = new Map<string, Link[]>()
  for (const l of trusted) {
    const k = l.category || "Other"
    if (!byCategory.has(k)) byCategory.set(k, [])
    byCategory.get(k)!.push(l)
  }

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

      {Array.from(byCategory.entries()).map(([category, items]) => (
        <section key={category}>
          <div className="text-xs uppercase tracking-wide text-[var(--text-mut)] mb-2">{category}</div>
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
      ))}
    </div>
  )
}
