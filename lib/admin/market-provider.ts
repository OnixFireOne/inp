// lib/admin/market-provider.ts
// Refine data provider for the live CoinGecko "markets" feed.
//
// /api/markets returns { rows, page, perPage, hasMore } with no total count
// (CoinGecko does not expose one for /coins/markets). Refine v5 still
// requires `total` in GetListResponse, so we return -1 (sentinel) when
// `hasMore` is true; the catalog table then drives its own load-more
// sentinel and never trusts the total.
//
// Mutations and getOne are NOT supported — the catalog never edits
// CoinGecko. Refine surfaces a thrown error if a caller asks for them.
import type {
  CreateParams,
  CreateResponse,
  DataProvider,
  DeleteOneParams,
  DeleteOneResponse,
  GetListParams,
  GetListResponse,
  GetOneParams,
  GetOneResponse,
  UpdateParams,
  UpdateResponse,
} from "@refinedev/core"
import type { MarketRow, MarketsResponse } from "@/lib/types"

const PER_PAGE = 100

/** Append `page` to /api/markets, return the parsed payload. */
export async function fetchMarketPage(
  page: number,
  signal?: AbortSignal,
): Promise<MarketsResponse> {
  const u = new URL("/api/markets", location.origin)
  u.searchParams.set("page", String(page))
  u.searchParams.set("per_page", String(PER_PAGE))
  const res = await fetch(u.toString(), { signal, cache: "no-store" })
  if (!res.ok) {
    return { rows: [], page, perPage: PER_PAGE, hasMore: false }
  }
  return (await res.json()) as MarketsResponse
}

function notSupported(op: string): never {
  throw new Error(
    `marketDataProvider: "${op}" is not supported — CoinGecko data is read-only. ` +
      `Use the Supabase data provider to edit assets/links.`,
  )
}

export const marketDataProvider: DataProvider = {
  getApiUrl: () => "/api/markets",

  getList: async <TData extends import("@refinedev/core").BaseRecord = import("@refinedev/core").BaseRecord>(
    params: GetListParams,
  ): Promise<GetListResponse<TData>> => {
    if (params.resource !== "markets") notSupported("getList")

    // Map Refine pagination (currentPage) to /api/markets?page=N.
    const current = Math.max(1, params.pagination?.currentPage ?? 1)
    const payload = await fetchMarketPage(current)

    let data: MarketRow[] = payload.rows
    if (params.filters?.length) {
      data = data.filter((r) =>
        params.filters!.every((f) => {
          if (!("field" in f) || f.operator !== "eq") return true
          return (r as any)[f.field] === f.value
        }),
      )
    }

    return {
      data: data as unknown as TData[],
      total: payload.hasMore ? -1 : payload.rows.length,
    }
  },

  getOne: async <TData extends import("@refinedev/core").BaseRecord = import("@refinedev/core").BaseRecord>(
    params: GetOneParams,
  ): Promise<GetOneResponse<TData>> => {
    if (params.resource !== "markets") notSupported("getOne")
    // Scan a few pages cheaply — coin may be in page 2-5.
    for (let p = 1; p <= 5; p++) {
      const r = await fetchMarketPage(p)
      const hit = r.rows.find((x) => x.id === params.id)
      if (hit) return { data: hit as unknown as TData }
      if (!r.hasMore) break
    }
    throw new Error(`marketDataProvider: market "${params.id}" not found in first pages`)
  },

  create: async <TData, TVariables>(
    _params: CreateParams<TVariables>,
  ): Promise<CreateResponse<TData & MarketRow>> => notSupported("create"),

  update: async <TData, TVariables>(
    _params: UpdateParams<TVariables>,
  ): Promise<UpdateResponse<TData & MarketRow>> => notSupported("update"),

  deleteOne: async <TData, TVariables>(
    _params: DeleteOneParams<TVariables>,
  ): Promise<DeleteOneResponse<TData & MarketRow>> => notSupported("deleteOne"),
}
