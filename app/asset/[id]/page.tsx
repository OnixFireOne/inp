// app/asset/[id]/page.tsx — server component, full SEO page.
// Direct visit /asset/[id] renders inside the same chrome as / (markets list
// stays mounted, AssetOverview in the centre).
//
// Data: Supabase `assets` row + /api/links?cg= + /api/markets?ids=.
// No client-side fetches on first paint → fully indexable HTML.

import type { Metadata } from "next"
import { AssetOverview } from "@/components/AssetOverview"
import { AssetTable } from "@/components/AssetTable"
import type { MarketsResponse } from "@/lib/types"
import type { Link } from "@/types/asset"
import { supabaseServer } from "@/lib/supabase/server"
import { SITE_URL, INTERNAL_BASE_URL } from "@/lib/site"

interface AssetRow {
  id: string
  name: string
  ticker: string
  icon: string | null
  coingecko_id: string
  tv_symbol: string | null
}

interface LinksPayload {
  asset: Pick<AssetRow, "id" | "name" | "ticker" | "icon" | "coingecko_id" | "tv_symbol"> | null
  links: Link[]
  categories: { key: string; label: string; icon: string | null; sort: number }[]
}

interface PageProps {
  params: Promise<{ id: string }>
}

async function fetchAll(baseUrl: string, id: string) {
  const [assetRes, linksRes, marketRes] = await Promise.all([
    // Supabase server-side (admin layout guard already ensures RLS allows reads)
    (await supabaseServer())
      .from("assets")
      .select("id, name, ticker, icon, coingecko_id, tv_symbol")
      .eq("coingecko_id", id)
      .maybeSingle<AssetRow>(),
    fetch(`${baseUrl}/api/links?cg=${encodeURIComponent(id)}`, { next: { revalidate: 60 } })
      .then((r) => (r.ok ? r.json() : { asset: null, links: [], categories: [] }))
      .catch(() => ({ asset: null, links: [], categories: [] })),
    fetch(`${baseUrl}/api/markets?ids=${encodeURIComponent(id)}`, { next: { revalidate: 45 } })
      .then((r) => (r.ok ? r.json() : { rows: [] }))
      .catch(() => ({ rows: [] })),
  ])

  return {
    asset: assetRes.data ?? null,
    describedAsset: linksRes.asset ?? null,
    links: linksRes.links ?? [],
    categories: linksRes.categories ?? [],
    marketRow: marketRes.rows?.[0] ?? null,
  }
}

type MarketRowMinimal = {
  id: string
  name: string
  symbol: string
  image: string
  price: number
  marketCap: number | null
  change24h: number
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params
  const internalBaseUrl = INTERNAL_BASE_URL

  const [{ data: asset }, linksRes, marketRes] = await Promise.all([
    (await supabaseServer())
      .from("assets")
      .select("id, name, ticker, icon, coingecko_id")
      .eq("coingecko_id", id)
      .maybeSingle<{ id: string; name: string; ticker: string; icon: string | null; coingecko_id: string }>(),
    fetch(`${internalBaseUrl}/api/links?cg=${encodeURIComponent(id)}`, { next: { revalidate: 60 } })
      .then((r) => (r.ok ? (r.json() as Promise<LinksPayload>) : { asset: null, links: [], categories: [] }))
      .catch(() => ({ asset: null, links: [], categories: [] })),
    fetch(`${internalBaseUrl}/api/markets?ids=${encodeURIComponent(id)}`, { next: { revalidate: 45 } })
      .then((r) => (r.ok ? (r.json() as Promise<{ rows: MarketRowMinimal[] }>) : { rows: [] }))
      .catch(() => ({ rows: [] })),
  ])

  const name = asset?.name ?? marketRes.rows?.[0]?.name ?? id
  const ticker = asset?.ticker ?? marketRes.rows?.[0]?.symbol ?? ""
  const icon = asset?.icon ?? marketRes.rows?.[0]?.image ?? null
  const linksCount = linksRes.links?.length ?? 0

  const title = `${name} (${ticker}) — курируемые ссылки | inp.one`
  const description = `Курируемые ссылки ${name}: ${linksCount} источников. Биржи, графики, инструменты и официальные ресурсы.`

  return {
    title,
    description,
    alternates: { canonical: `${SITE_URL}/asset/${id}` },
    openGraph: {
      title,
      description,
      url: `${SITE_URL}/asset/${id}`,
      ...(icon ? { images: [{ url: icon, alt: `${name} icon` }] } : {}),
      type: "article",
    },
    twitter: {
      card: icon ? "summary_large_image" : "summary",
      title,
      description,
      ...(icon ? { images: [icon] } : {}),
    },
  }
}

export default async function AssetPage({ params }: PageProps) {
  const { id } = await params
  const baseUrl = INTERNAL_BASE_URL

  const [{ asset, describedAsset, links, categories, marketRow }, marketsHome] = await Promise.all([
    fetchAll(baseUrl, id),
    fetch(`${baseUrl}/api/markets?page=1`, { next: { revalidate: 30 } })
      .then((r) => (r.ok ? (r.json() as Promise<MarketsResponse>) : null))
      .catch(() => null),
  ])

  const market = marketRow
    ? {
        name: marketRow.name,
        symbol: marketRow.symbol,
        image: marketRow.image,
        price: marketRow.price,
        change24h: marketRow.change24h,
        marketCap: marketRow.marketCap,
      }
    : undefined

  return (
    <main className="min-h-screen pb-16">
      <div className="px-4 pt-4">
        <div className="mb-3">
          <a href="/" className="text-sm text-[var(--text-mut)] hover:text-[var(--text)]">
            ← К каталогу
          </a>
        </div>

        <article className="border border-[var(--border)] rounded-2xl bg-[var(--surface)] overflow-hidden max-w-[var(--maxw)] mx-auto">
          <header className="flex items-center gap-4 px-6 py-5 border-b border-[var(--border)]">
            {market?.image || asset?.icon ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={(asset?.icon ?? market?.image)!}
                alt=""
                width={56}
                height={56}
                className="w-14 h-14 rounded-full bg-[var(--surface-2)]"
              />
            ) : (
              <div className="w-14 h-14 rounded-full bg-[var(--surface-2)]" />
            )}
            <div className="min-w-0">
              <h1 className="text-2xl font-semibold truncate">
                {asset?.name ?? market?.name ?? id}
              </h1>
              <div className="text-sm text-[var(--text-mut)] uppercase">
                {asset?.ticker ?? market?.symbol ?? ""}
              </div>
            </div>
            {market && (
              <div className="ml-auto text-right">
                <div className="text-xl tabular-nums">${market.price.toLocaleString()}</div>
                <div
                  className={`text-sm tabular-nums ${market.change24h >= 0 ? "text-emerald-500" : "text-rose-500"}`}
                >
                  {market.change24h >= 0 ? "+" : ""}
                  {market.change24h.toFixed(2)}% (24h)
                </div>
              </div>
            )}
          </header>

          <AssetOverview
            asset={describedAsset ?? asset}
            links={links}
            categories={categories}
            market={market}
            variant="page"
          />
        </article>

        <section className="mt-10">
          <h2 className="text-lg font-medium mb-3">Все монеты</h2>
          <AssetTable initialData={marketsHome ?? undefined} />
        </section>
      </div>
    </main>
  )
}
