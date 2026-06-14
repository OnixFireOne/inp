interface SparklineProps {
  data?: number[];
  positive?: boolean;
}

export function Sparkline({ data = [1,2,1.5,3,2.5,4,3.8], positive = true }: SparklineProps) {
  const color = positive ? 'var(--up)' : 'var(--down)';
  const points = data.map((v, i) => `${(i / (data.length - 1)) * 100},${100 - ((v - Math.min(...data)) / (Math.max(...data) - Math.min(...data) || 1)) * 80 - 10}`).join(' ');

  return (
    <svg width="80" height="28" viewBox="0 0 100 100" className="overflow-visible">
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="3"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
