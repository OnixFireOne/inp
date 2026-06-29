// lib/links/build-template-submit.ts
// Build the values object sent to useCreate/useUpdate for link_templates.
//
// Two responsibilities (§7.2 / §7.4 + review item #3):
//   - clear opposite-kind fields so the row never carries stale data
//     (pattern → provider=null, source_key=null; provider → url_pattern=null)
//   - on create, compute `sort` automatically as (max sort in category) + 10
//     so the new row lands at the bottom of its bucket without UI input
//   - on edit, keep the existing sort untouched; drag-and-drop owns reordering

import { computeNextSortForCategory } from "./dnd-rank"
import type { LinkTemplate } from "./resolve"

export type EditingTemplate = Partial<LinkTemplate>

export function buildTemplateSubmitValues(
  editing: EditingTemplate,
  options: {
    isCreate: boolean
    existingRows: Pick<LinkTemplate, "category" | "sort">[]
  },
): Record<string, unknown> {
  const kind = editing.kind === "provider" ? "provider" : "pattern"
  const values: Record<string, unknown> = {
    kind,
    category: editing.category ?? null,
    label: editing.label ?? "",
    icon: editing.icon ?? null,
    tier: editing.tier ?? "Trusted",
    enabled: editing.enabled ?? true,
  }

  if (kind === "pattern") {
    values.url_pattern = editing.url_pattern ?? ""
    values.provider = null
    values.source_key = null
  } else {
    values.url_pattern = null
    values.provider = editing.provider ?? ""
    values.source_key = editing.source_key ?? ""
  }

  if (options.isCreate) {
    const cat = (editing.category ?? "").toString()
    values.sort = computeNextSortForCategory(options.existingRows, cat)
  } else if (typeof editing.sort === "number") {
    values.sort = editing.sort
  }

  return values
}