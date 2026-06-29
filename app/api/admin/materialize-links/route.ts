// app/api/admin/materialize-links/route.ts
// Admin-only endpoint: freeze generated template links into curated `links`.
// Works from both `undescribed` (no assets row yet) and `template` states.
// Re-running for `described` returns 409.

import { NextRequest } from "next/server"
import { kvDel, kvSetNx } from "@/lib/kv"
import { supabaseServer } from "@/lib/supabase/server"
import { getMarketRowFromCache } from "@/lib/asset-meta/markets-allowlist"
import { ensureAssetStub } from "@/lib/asset-meta/stub"
import { ensureAssetMeta } from "@/lib/asset-meta/ensure"
import { backfillAssetFromMarket } from "@/lib/links/backfill-asset"
import { getActiveTemplates } from "@/lib/links/templates-cache"
import { expandTemplates } from "@/lib/links/resolve"
import { buildAssetVars } from "@/lib/links/build-asset-vars"
import { buildMaterializeRows } from "@/lib/links/materialize"
import { bustLinkCaches } from "@/lib/asset-meta/bust-link-cache"

const LOCK_TTL_SECONDS = 60
const lockKey = (cg: string) => `materialize:lock:${cg}`

type AssetRow = {
  id: string
  coingecko_id: string
  name: string | null
  ticker: string | null
  icon: string | null
  status: "described" | "template"
}

async function assertAdmin(): Promise<boolean> {
  const supabase = await supabaseServer()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return false
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("user_id", user.id)
    .single()
  return !!profile && profile.role === "admin"
}

export async function POST(req: NextRequest) {
  if (!(await assertAdmin())) {
    return json({ ok: false, error: "forbidden" }, 403)
  }

  const { cg } = (await req.json().catch(() => ({}))) as { cg?: string }
  const coin = (cg ?? "").trim()
  if (!coin) return json({ ok: false, error: "cg required" }, 400)

  // Critical gate before creating a stub: unknown slugs must not materialize
  // into phantom described coins with bogus pattern URLs.
  const marketRow = await getMarketRowFromCache(coin)
  if (!marketRow) return json({ ok: false, error: "unknown coin" }, 404)

  const locked = await kvSetNx(lockKey(coin), LOCK_TTL_SECONDS, "1")
  if (!locked) return json({ ok: false, error: "already materializing" }, 409)

  try {
    const supabase = await supabaseServer()

    let asset = await loadAsset(supabase, coin)
    if (asset?.status === "described") {
      return json({ ok: false, error: "already materialized" }, 409)
    }

    await ensureAssetStub(coin, marketRow)
    await ensureAssetMeta(coin, { force: true, wait: true })

    asset = await loadAsset(supabase, coin)
    if (!asset) return json({ ok: false, error: "unknown coin" }, 404)
    if (asset.status === "described") {
      return json({ ok: false, error: "already materialized" }, 409)
    }

    const changed = await backfillAssetFromMarket(asset, marketRow)
    if (changed) {
      asset = await loadAsset(supabase, coin)
      if (!asset) return json({ ok: false, error: "unknown coin" }, 404)
    }

    const [{ data: meta }, templates, { data: existing }] = await Promise.all([
      supabase
        .from("asset_meta")
        .select("data")
        .eq("asset_id", asset.id)
        .eq("provider", "coingecko")
        .maybeSingle(),
      getActiveTemplates(),
      supabase.from("links").select("href").eq("asset_id", asset.id),
    ])

    const generated = expandTemplates(
      templates,
      buildAssetVars(coin, asset, marketRow),
      meta?.data ? { coingecko: meta.data } : {},
    )

    if (generated.length === 0) {
      return json({ ok: false, error: "nothing to materialize" }, 422)
    }

    const rows = buildMaterializeRows(
      generated,
      (existing ?? []).map((l) => String(l.href ?? "")),
      asset.id,
    )

    if (rows.length) {
      const { error: insertErr } = await supabase.from("links").insert(rows)
      if (insertErr) {
        return json({ ok: false, error: insertErr.message }, 500)
      }
    }

    const { error: statusErr } = await supabase
      .from("assets")
      .update({ status: "described" })
      .eq("id", asset.id)
    if (statusErr) {
      return json({ ok: false, error: statusErr.message }, 500)
    }

    await bustLinkCaches(coin)

    return json(
      { ok: true, inserted: rows.length, snapshot: !!meta?.data },
      200,
    )
  } finally {
    await kvDel(lockKey(coin)).catch(() => {})
  }
}

async function loadAsset(
  supabase: Awaited<ReturnType<typeof supabaseServer>>,
  cg: string,
): Promise<AssetRow | null> {
  const { data, error } = await supabase
    .from("assets")
    .select("id, coingecko_id, name, ticker, icon, status")
    .eq("coingecko_id", cg)
    .maybeSingle()
  if (error || !data) return null
  return data as AssetRow
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  })
}
