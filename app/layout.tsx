import type { Metadata } from 'next';
import { Providers } from '@/components/Providers';
import './globals.css';
import { Suspense } from 'react';

export const metadata: Metadata = {
  title: 'inp.one',
  description: 'Cryptocurrency catalog',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" data-theme="dark">
      <head>
        {/* TradingView warmup: open TCP/TLS + DNS early so the chart loads fast. */}
        <link rel="preconnect" href="https://s.tradingview.com" crossOrigin="" />
        <link rel="preconnect" href="https://s3.tradingview.com" crossOrigin="" />
        <link rel="dns-prefetch" href="https://data.tradingview.com" />
      </head>
      <body>
        <Suspense>
          <Providers>{children}</Providers>
        </Suspense>
      </body>
    </html>
  );
}
