"use client"
// app/(admin)/admin/providers.tsx
// Client-side Refine root, scoped to the admin route group.
// The published showcase does NOT import from here, so Refine chunks stay
// inside the /admin build output.
//
// Data providers:
//   - default: @refinedev/supabase over lib/supabase/client.ts
//     (env NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY — never the service role)
//   - "markets": lib/admin/market-provider.ts over /api/markets
//     (live CoinGecko feed, read-only)
//
// Resources point at /admin/catalog — the catalog is the single screen
// for stage 1; deeper routes (e.g. /admin/catalog/[id]) are not managed
// by Refine's `list/edit/create` convention because the asset editor is
// the same route for described/un-described and does its own branching.
import { useMemo, useState, type ReactNode } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { Refine } from "@refinedev/core"
import routerProvider from "@refinedev/nextjs-router"
import { dataProvider as supabaseDataProvider } from "@refinedev/supabase"
import { supabaseBrowser } from "@/lib/supabase/client"
import { marketDataProvider } from "@/lib/admin/market-provider"

export function AdminProviders({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Catalog data is refreshed on action; don't burn the user's
            // network on every focus.
            refetchOnWindowFocus: false,
            retry: 1,
            staleTime: 30_000,
          },
        },
      }),
  )

  // Memoize so Refine doesn't see a new dataProvider object on every render
  // (which would tear down its internal cache).
  const providers = useMemo(
    () => ({
      default: supabaseDataProvider(supabaseBrowser()),
      markets: marketDataProvider,
    }),
    [],
  )

  return (
    <QueryClientProvider client={queryClient}>
      <Refine
        dataProvider={providers}
        routerProvider={routerProvider}
        resources={[
          { name: "assets" },
          { name: "links" },
          { name: "markets" },
        ]}
        options={{ disableTelemetry: true }}
      >
        {children}
      </Refine>
    </QueryClientProvider>
  )
}
