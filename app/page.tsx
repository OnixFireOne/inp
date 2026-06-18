import { AssetTable } from "@/components/AssetTable"
import type { MarketsResponse } from "@/lib/types"

// SSR prefetch: fetch markets server-side so the initial HTML already
// contains real data. This eliminates the skeleton → data CLS shift.
export default async function Home() {
  let initialData: MarketsResponse | null = null
  try {
    const baseUrl = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "http://localhost:3000"
    const res = await fetch(`${baseUrl}/api/markets?page=1`, {
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
