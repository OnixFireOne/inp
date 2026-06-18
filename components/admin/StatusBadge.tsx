"use client"
// components/admin/StatusBadge.tsx
// Tiny status pill for the catalog overlay column.
//   described -> the asset row exists in Supabase
//   missing   -> no row in assets for this coingecko_id
//
// Type is kept loose on purpose: the catalog page builds a Map of
// `useList('assets')` rows, the editor's DescribedAsset is a single
// fully-typed record. We accept the common id+links subset.

type BadgeInput = {
  id?: string | null
  coingecko_id?: string | null
  links?: { count: number }[] | null
}

export function StatusBadge({
  described,
  linkCount,
}: {
  described: BadgeInput | undefined
  linkCount?: number
}) {
  if (described) {
    const id = described.id ?? ""
    return (
      <span
        className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border border-emerald-500/40 text-emerald-600"
        title={`${id}${typeof linkCount === "number" ? ` · ${linkCount} links` : ""}`}
      >
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
        описана
        {typeof linkCount === "number" && (
          <span className="text-[var(--text-mut)]">· {linkCount}</span>
        )}
      </span>
    )
  }
  return (
    <span
      className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border border-zinc-400/40 text-[var(--text-mut)]"
      title="Нет строки в assets"
    >
      <span className="w-1.5 h-1.5 rounded-full bg-zinc-400" />
      нет
    </span>
  )
}
