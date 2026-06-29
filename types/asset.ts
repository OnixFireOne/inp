export interface Asset {
  id: string;
  name: string;
  ticker: string;
  icon?: string | null;
  coingecko_id?: string;
  tv_symbol?: string;
}

export interface Link {
  id: string;
  asset_id: string;
  name: string;
  description?: string | null;
  href: string;
  tier: 'Core' | 'Trusted';
  category: string;
  health?: string | null;
  is_top?: boolean | null;
  manual_rank?: number | null;
  ai_score?: number | null;
  icon?: string | null;
  generated?: boolean;
  /**
   * @deprecated Aspect 8 — DB-backed `icon` is the source of truth. The
   * column is kept for one more release to avoid breaking any in-flight
   * readers; do not write to it.
   */
  thumbnailUrl?: string | null;
}
