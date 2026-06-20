import { AssetTable } from "@/components/AssetTable"
import type { MarketsResponse } from "@/lib/types"
import { INTERNAL_BASE_URL } from "@/lib/site"

// SSR prefetch: fetch markets server-side so the initial HTML already
// contains real data. This eliminates the skeleton → data CLS shift.
export default async function Home() {
  let initialData: MarketsResponse | null = null
  try {
    const res = await fetch(`${INTERNAL_BASE_URL}/api/markets?page=1`, {
      next: { revalidate: 30 },
    })
    if (res.ok) {
      initialData = await res.json()
    }
  } catch {
    // If SSR fails, AssetTable will fetch client-side as normal
  }

  return (
    <main className="min-h-screen pb-16">
      <div className="px-4 pt-4">
        <AssetTable initialData={initialData} />
      </div>
    </main>
  )
}
