// lib/links/dnd-rank.ts
// Pure helpers for ordering drag-and-drop scopes. Each scope is identified by
// a string key (e.g. category for link_templates; or a "global" pseudo-scope
// for link_categories where scope is asset_id === null). The order is written
// as 10, 20, 30... automatically so the numeric field can stay hidden in the UI.

/**
 * Rewrite `sort` as 10, 20, 30... inside each (scopeKey) bucket, preserving
 * every other field. The array order represents the desired final order.
 *
 * The row type only needs a `sort` field and a discriminating scope key
 * (the `scopeKey` argument below). For dnd-kit's id we accept any unique key
 * extractor, so callers can use dnd-kit's `id` (string) without coupling
 * the row shape to ours.
 */
export type Sortable = { id: string; sort: number }

export function rerankWithinScope<T extends { sort: number; [k: string]: unknown }>(
  rows: T[],
  scopeKey: keyof T,
): T[] {
  const out: T[] = []
  const byScope = new Map<string, T[]>()
  for (const r of rows) {
    const key = String(r[scopeKey] ?? "")
    const list = byScope.get(key) ?? []
    list.push(r)
    byScope.set(key, list)
  }
  for (const list of byScope.values()) {
    list.forEach((r, i) => {
      out.push({ ...r, sort: (i + 1) * 10 })
    })
  }
  return out
}

/** Back-compat for Aspect 7 (link_templates). */
export function rerankWithinCategory<
  T extends { sort: number; category: string },
>(rows: T[]): T[] {
  return rerankWithinScope(rows, "category")
}

export function computeNextSortForCategory<
  T extends { sort: number; category: string },
>(rows: T[], category: string): number {
  let max = 0
  for (const r of rows) {
    if (r.category === category && r.sort > max) max = r.sort
  }
  return max + 10
}