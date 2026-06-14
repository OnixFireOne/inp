'use client';

import { AssetRow } from './AssetRow';
import type { Asset } from '@/types/asset';

interface AssetTableProps {
  assets?: Asset[];
}

export function AssetTable({ assets = [] }: AssetTableProps) {
  // Phase 1: static seed data, ISR later
  const mockAssets: Asset[] = assets.length ? assets : [
    { id: 'bitcoin', name: 'Bitcoin', ticker: 'BTC', icon: null },
    { id: 'ethereum', name: 'Ethereum', ticker: 'ETH', icon: null },
  ];

  return (
    <div className="border border-[var(--border)] rounded-[var(--radius)] overflow-hidden">
      <table className="w-full">
        <thead>
          <tr className="border-b border-[var(--border)] text-left text-sm text-[var(--text-mut)]">
            <th className="px-4 py-3 w-12">#</th>
            <th className="px-4 py-3">Name</th>
            <th className="px-4 py-3 text-right">Price</th>
            <th className="px-4 py-3 text-right">Market Cap</th>
            <th className="px-4 py-3 text-right">24h</th>
            <th className="px-4 py-3 w-32">24h</th>
          </tr>
        </thead>
        <tbody>
          {mockAssets.map((asset, idx) => (
            <AssetRow key={asset.id} asset={asset} index={idx + 1} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
