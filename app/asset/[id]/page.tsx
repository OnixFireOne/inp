'use client';

import { useState } from 'react';
import { ResponsiveSheet } from '@/components/ResponsiveSheet';
import { TvChart } from '@/components/TvChart';
import { warmTradingView } from '@/components/TvChart';

interface AssetModalProps {
  id: string;
  tvSymbol?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AssetModal({ id, tvSymbol = `BINANCE:${id.toUpperCase()}USDT`, open, onOpenChange }: AssetModalProps) {
  const [tab, setTab] = useState<'overview' | 'chart'>('overview');

  if (tab === 'chart') warmTradingView();

  return (
    <ResponsiveSheet open={open} onOpenChange={onOpenChange} title={id}>
      <div className="flex gap-2 mb-4 border-b border-[var(--border)]">
        <button onClick={() => setTab('overview')} className={tab === 'overview' ? 'font-medium border-b-2 border-[var(--accent)] pb-1' : 'text-[var(--text-mut)]'}>Overview</button>
        <button onClick={() => setTab('chart')} className={tab === 'chart' ? 'font-medium border-b-2 border-[var(--accent)] pb-1' : 'text-[var(--text-mut)]'}>Chart</button>
      </div>
      {tab === 'overview' && <div>Price / Cap / Volume metrics + LinkList for {id}</div>}
      {tab === 'chart' && <TvChart tvSymbol={tvSymbol} />}
    </ResponsiveSheet>
  );
}
