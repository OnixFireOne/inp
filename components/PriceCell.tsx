// PriceCell — PRICE ONLY (no change % — that lives in its own column).
// Large prices (>= $100) → whole dollars only (no cents).
// Smaller prices (< $100) → cents + up to 6 decimal places for tiny amounts.

function formatUsd(n: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: n < 1 ? 2 : n < 100 ? 2 : 0,
    maximumFractionDigits: n < 1 ? 6 : 2,
  }).format(n)
}

export function PriceCell({ price }: { price?: number }) {
  if (price == null) {
    return <span className="inline-block w-24 h-5 bg-[var(--surface-2)] rounded animate-pulse" aria-hidden />
  }
  return <span className="tabular-nums text-[14px]">{formatUsd(price)}</span>
}
