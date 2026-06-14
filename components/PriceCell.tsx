import type { Quote } from "@/lib/types"

function formatUsd(n: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: n < 1 ? 4 : 2,
  }).format(n)
}

export function PriceCell({ quote }: { quote?: Quote }) {
  if (!quote) {
    return <span className="inline-block w-24 h-5 bg-[var(--surface-2)] rounded animate-pulse" aria-hidden />
  }
  const up = quote.change24h >= 0
  return (
    <span className="tabular-nums">
      {formatUsd(quote.price)}
      <span className={up ? "text-[var(--up)]" : "text-[var(--down)]"}>
        {up ? "+" : "−"}{Math.abs(quote.change24h).toFixed(2)}%
      </span>
    </span>
  )
}
