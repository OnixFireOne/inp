import type { Metadata } from 'next';
import { Providers } from '@/components/Providers';
import './globals.css';
import { Suspense } from 'react';
import { SITE_URL } from '@/lib/site';

export const metadata: Metadata = {
  title: 'inp.one',
  description: 'Cryptocurrency catalog',
  metadataBase: new URL(SITE_URL),
};

// AssetDrawer / ChartModal are mounted as global singletons inside
// <Providers>. No parallel route slots — opening the drawer is a
// client-state change (window.history.pushState + lib/drawer-state),
// never a route navigation, so the catalog page never unmounts.
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <head>
        {/* TradingView warmup: open TCP/TLS + DNS early so the chart loads fast. */}
        <link rel="preconnect" href="https://s.tradingview.com" crossOrigin="" />
        <link rel="preconnect" href="https://s3.tradingview.com" crossOrigin="" />
        <link rel="dns-prefetch" href="https://data.tradingview.com" />
      </head>
      <body>
        <script dangerouslySetInnerHTML={{__html: `(function(){try{var t=localStorage.getItem('theme');if(t)document.documentElement.dataset.theme=t}catch(e){}})()` }} />
        <Suspense>
          <Providers>
            {children}
          </Providers>
        </Suspense>
      </body>
    </html>
  );
}
