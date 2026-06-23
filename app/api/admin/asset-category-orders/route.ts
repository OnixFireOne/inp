// app/api/admin/asset-category-orders/route.ts
// Admin-only: persist per-asset category sort overrides for a single asset.
//
//   POST /api/admin/asset-category-orders
//   { id?: string, coingecko_id?: string, category_orders: Record<string, number> }
//
// `id` is the assets.id; we accept `coingecko_id` as a convenience for the
// "all" virtual row whose id == "all" and coingecko_id == "all".
//
// Invalidates `links:<cg>` in the in-memory KV so the next fetch reflects the
// new sort order.

import { NextRequest } from "next/server"
import { kvDel } from "@/lib/kv"
import { supabaseServer } from "@/lib/supabase/server"

async function assertAdmin(): Promise<boolean> {
  const supabase = await supabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return false
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("user_id", user.id)
    .single()
  return !!profile && profile.role === "admin"
}

function bad(message: string, status = 400) {
  return new Response(JSON.stringify({ ok: false, error: message }), {
    status,
    headers: { "content-type": "application/json" },
  })
}

export async function POST(req: NextRequest) {
  if (!(await assertAdmin())) {
    return new Response(JSON.stringify({ ok: false, error: "forbidden" }), {
      status: 403,
      headers: { "content-type": "application/json" },
    })
  }

  let body: { id?: string; coingecko_id?: string; category_orders?: unknown } = {}
  try {
    body = await req.json()
  } catch {
    return bad("invalid json")
  }

  const id = typeof body.id === "string" ? body.id : null
  const coingeckoId = typeof body.coingecko_id === "string" ? body.coingecko_id : null
  if (!id && !coingeckoId) return bad("id or coingecko_id required")

  // Validate overrides: must be a plain object of string -> finite number.
  const raw = body.category_orders
  if (raw == null) {
    // explicit null is allowed → clear overrides
  } else if (typeof raw !== "object" || Array.isArray(raw)) {
    return bad("category_orders must be an object")
  } else {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof v !== "number" || !Number.isFinite(v)) {
        return bad(`category_orders.${k} must be a number`)
      }
    }
  }

  const supabase = await supabaseServer()

  // Locate the asset row (by id, fallback to coingecko_id).
  let assetRow: { id: string; coingecko_id: string } | null = null
  if (id) {
    const { data } = await supabase
      .from("assets")
      .select("id, coingecko_id")
      .eq("id", id)
      .maybeSingle()
    assetRow = data ?? null
  }
  if (!assetRow && coingeckoId) {
    const { data } = await supabase
      .from("assets")
      .select("id, coingecko_id")
      .eq("coingecko_id", coingeckoId)
      .maybeSingle()
    assetRow = data ?? null
  }
  if (!assetRow) return bad("asset not found", 404)

  const { error: updErr } = await supabase
    .from("assets")
    .update({ category_orders: (raw ?? {}) as Record<string, number> })
    .eq("id", assetRow.id)

  if (updErr) return bad(updErr.message, 500)

  // Invalidate the per-asset links cache.
  if (assetRow.coingecko_id) {
    await kvDel(`links:${assetRow.coingecko_id}`)
  }

  return new Response(
    JSON.stringify({ ok: true, id: assetRow.id, coingecko_id: assetRow.coingecko_id }),
    { status: 200, headers: { "content-type": "application/json" } },
  )
}
