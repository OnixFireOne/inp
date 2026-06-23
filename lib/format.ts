// lib/format.ts
// Small shared formatters. Keep this file free of JSX so it's safe to import
// from both server and client components.

/**
 * Format a USD amount compactly for large values, and as full dollars for
 * smaller ones.
 *
 *   >= $1T          → "$1.23T"
 *   >= $1B          → "$75.16B"
 *   >= $1M          → "$432.10M"
 *   >= $100         → "$1,234"      (whole dollars, no cents)
 *   >= $1           → "$12.34"
 *   <  $1           → "$0.123456"   (up to 6 fraction digits)
 */
export function compactUsd(n: number): string {
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`
  if (n >= 100) return `$${Math.round(n).toLocaleString("en-US")}`
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: n < 1 ? 2 : 2,
    maximumFractionDigits: n < 1 ? 6 : 2,
  }).format(n)
}
