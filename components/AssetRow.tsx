'use client';

import { Sparkline } from './Sparkline';
import { PriceCell } from './PriceCell';
import type { Asset } from '@/types/asset';
import type { Quote } from '@/lib/types';
import { useWatchlist } from '@/hooks/useWatchlist';

interface AssetRowProps {
  asset: Asset;
  index: number;
  quote?: Quote;
  sparkData?: number[];
}

export function AssetRow({ asset, index, quote, sparkData }: AssetRowProps) {
  const positive = (quote?.change24h ?? 0) >= 0;
  const { toggle, isInWatchlist } = useWatchlist();
  const starred = isInWatchlist(asset.id);

  return (
    <tr className="border-b border-[var(--border)] hover:bg-[var(--surface)] group cursor-pointer h-[56px]">
      <td className="px-4 text-[var(--text-mut)] tabular-nums">{index}</td>
      <td className="px-4">
        <a href={`/asset/${asset.id}`} className="flex items-center gap-3 hover:text-[var(--accent)]">
          <div className="w-6 h-6 rounded-full bg-[var(--surface-2)]" />
          <div>
            <div className="font-medium flex items-center gap-1">
              {asset.name} <span className="text-[var(--text-mut)]">↗</span>
            </div>
            <div className="text-xs text-[var(--text-mut)]">{asset.ticker}</div>
          </div>
        </a>
      </td>
      <td className="px-4 text-right tabular-nums text-sm"><PriceCell quote={quote} /></td>
      <td className="px-4 text-right tabular-nums text-sm text-[var(--text-mut)]">$1.28T</td>
      <td className="px-4 text-right tabular-nums text-sm"><PriceCell quote={quote} /></td>
      <td className="px-4 flex items-center gap-2">
        <button
          onClick={(e) => { e.stopPropagation(); toggle(asset.id); }}
          className="text-lg"
          aria-label={starred ? "Remove from watchlist" : "Add to watchlist"}
        >
          {starred ? "★" : "☆"}
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); /* open chart tab */ }}
          className="hover:bg-[var(--surface-2)] rounded p-1"
          aria-label={`Open chart for ${asset.ticker}`}
        >
          <Sparkline data={sparkData} positive={positive} />
        </button>
      </td>
    </tr>
  );
}
