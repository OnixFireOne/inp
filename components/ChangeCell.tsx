// ChangeCell — only the 24h change, color-coded, no price.
// Slightly smaller than the price column (Price = 14px, this = 13px).

export function ChangeCell({ value }: { value?: number }) {
  if (value == null) {
    return <span className="inline-block w-14 h-4 bg-[var(--surface-2)] rounded animate-pulse" aria-hidden />
  }
  const up = value >= 0
  const sign = up ? "+" : "−" // typographic minus
  return (
    <span className={"tabular-nums text-[13px] " + (up ? "text-[var(--up)]" : "text-[var(--down)]")}>
      {sign}
      {Math.abs(value).toFixed(2)}%
    </span>
  )
}
