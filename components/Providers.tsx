'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as Tooltip from '@radix-ui/react-tooltip';
import { useState } from 'react';
import { ChartModal } from './ChartModal';

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        retry: 1,
        refetchOnWindowFocus: false,
      },
    },
  }));

  return (
    <QueryClientProvider client={queryClient}>
      <Tooltip.Provider delayDuration={150} skipDelayDuration={300}>
        {children}
        {/* Global singleton chart panel. Always mounted, listens to
            requestOpenChart() events. The widget is created once on
            first idle and reused across the whole session. */}
        <ChartModal />
      </Tooltip.Provider>
    </QueryClientProvider>
  )
}
