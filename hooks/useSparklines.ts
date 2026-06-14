import { useQuery } from "@tanstack/react-query"
import type { SparklinesResponse } from "@/lib/types"

export function useSparklines(ids: string[]) {
  const key = [...ids].sort().join(",")
  return useQuery({
    queryKey: ["sparklines", key],
    enabled: ids.length > 0,
    queryFn: async (): Promise<SparklinesResponse> => {
      const r = await fetch(`/api/sparklines?ids=${encodeURIComponent(key)}&window=24h`)
      return r.json()
    },
    staleTime: 5 * 60_000,
  })
}
