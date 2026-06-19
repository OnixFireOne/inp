import type { Metadata } from 'next';
import { Providers } from '@/components/Providers';
import './globals.css';
import { Suspense } from 'react';

export const metadata: Metadata = {
  title: 'inp.one',
  description: 'Cryptocurrency catalog',
};

// Parallel route slots:
//   children → app/page.tsx (the markets table, stays mounted across soft navigations)
//   modal    → app/@modal/(.)asset/[id]/page.tsx (intercepts /asset/[id] as overlay)
//
// Rendering BOTH slots here means: opening a modal does NOT unmount the list.
// Scroll position, React Query cache, the always-mounted ChartModal — all preserved.
export default function RootLayout({
  children,
  modal,
}: {
  children: React.ReactNode;
  modal: React.ReactNode;
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
            {modal}
          </Providers>
        </Suspense>
      </body>
    </html>
  );
}
