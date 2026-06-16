import { useQuery } from "@tanstack/react-query"
import type { SparklinesResponse } from "@/lib/types"

const SPARK_TTL = Number(process.env.SPARK_TTL_SECONDS ?? 300) * 1000

export function useSparklines(ids: string[]) {
  const key = [...ids].sort().join(",")
  return useQuery({
    queryKey: ["sparklines", key],
    enabled: ids.length > 0,
    queryFn: async (): Promise<SparklinesResponse> => {
      const r = await fetch(`/api/sparklines?ids=${encodeURIComponent(key)}&window=24h`)
      return r.json()
    },
    staleTime: SPARK_TTL,
  })
}
