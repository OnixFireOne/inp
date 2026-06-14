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
  description?: string;
  href: string;
  tier: 'Core' | 'Trusted';
  category: string;
  health?: string;
}
