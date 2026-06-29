"use client"
// components/admin/StatusBadge.tsx
// Tiny status pill for the catalog overlay column.

type BadgeInput = {
  id?: string | null
  coingecko_id?: string | null
  status?: "described" | "template" | null
  links?: { count: number }[] | null
}

export function StatusBadge({
  described,
  linkCount,
}: {
  described: BadgeInput | undefined
  linkCount?: number
}) {
  if (!described) {
    return (
      <span
        className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border border-zinc-400/40 text-[var(--text-mut)]"
        title="Нет строки в assets"
      >
        <span className="w-1.5 h-1.5 rounded-full bg-zinc-400" />
        Нет
      </span>
    )
  }

  if (described.status === "template") {
    return (
      <span
        className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border border-amber-500/40 text-amber-600"
        title="Автоматически созданный шаблон"
      >
        <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
        Шаблон
      </span>
    )
  }

  const id = described.id ?? ""
  return (
    <span
      className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border border-emerald-500/40 text-emerald-600"
      title={`${id}${typeof linkCount === "number" ? ` · ${linkCount} links` : ""}`}
    >
      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
      Описано
      {typeof linkCount === "number" && (
        <span className="text-[var(--text-mut)]">· {linkCount}</span>
      )}
    </span>
  )
}