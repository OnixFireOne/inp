function formatMktCap(n: number | null) {
  if (n == null) return "—"
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`
  return `$${n.toLocaleString()}`
}

export function MarketCapCell({ value }: { value?: number | null }) {
  if (value == null) {
    return <span className="inline-block w-16 h-5 bg-[var(--surface-2)] rounded animate-pulse" aria-hidden />
  }
  return <span className="tabular-nums text-[var(--text-mut)]">{formatMktCap(value)}</span>
}
