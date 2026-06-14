import { useQuery } from "@tanstack/react-query"
import type { PricesResponse } from "@/lib/types"

export function usePrices(ids: string[]) {
  const key = [...ids].sort().join(",")
  return useQuery({
    queryKey: ["prices", key],
    enabled: ids.length > 0,
    queryFn: async (): Promise<PricesResponse> => {
      const r = await fetch(`/api/prices?ids=${encodeURIComponent(key)}`)
      return r.json()
    },
    refetchInterval: 20_000,
    refetchOnWindowFocus: true,
    staleTime: 15_000,
  })
}
