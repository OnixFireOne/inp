// Custom inline SVG sparkline. No third-party chart libs.
// Takes a series of numbers + a "positive" flag for the stroke color.
// The data source (7d from /api/markets, 24h from /api/sparklines) is irrelevant here.

interface SparklineProps {
  data?: number[]
  positive?: boolean
  width?: number
  height?: number
  strokeWidth?: number
}

export function Sparkline({
  data,
  positive = true,
  width = 96,
  height = 32,
  strokeWidth = 2,
}: SparklineProps) {
  if (!data || data.length < 2) {
    return (
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className="block"
        aria-hidden
      />
    )
  }

  let min = Infinity
  let max = -Infinity
  for (const v of data) {
    if (v < min) min = v
    if (v > max) max = v
  }
  const range = max - min || 1
  const padX = 2
  const padY = 3
  const innerW = width - padX * 2
  const innerH = height - padY * 2

  const points = data
    .map((v, i) => {
      const x = padX + (i / (data.length - 1)) * innerW
      const y = padY + (1 - (v - min) / range) * innerH
      return `${x.toFixed(2)},${y.toFixed(2)}`
    })
    .join(" ")

  const color = positive ? "var(--up)" : "var(--down)"

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="block overflow-visible"
      aria-hidden
    >
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  )
}
