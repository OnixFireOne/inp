// app/api/admin/revalidate-links/route.ts
// Admin-only endpoint: invalidate the /api/links?cg=<cg> cache entry after
// a mutation to the `links` (or `assets`) table.
//
// Why a server route? The in-memory KV lives in the Node process; the browser
// can't reach it. The route runs server-side, calls kvDel on the right key,
// and returns. The admin caller also invalidates the browser-side RQ cache.

import { NextRequest } from "next/server"
import { kvDel, kvGet } from "@/lib/kv"
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

export async function POST(req: NextRequest) {
  if (!(await assertAdmin())) {
    return new Response(JSON.stringify({ ok: false, error: "forbidden" }), {
      status: 403,
      headers: { "content-type": "application/json" },
    })
  }

  let body: { cg?: string; coingeckoIds?: string[] } = {}
  try {
    body = await req.json()
  } catch {
    /* empty body is fine */
  }

  const ids = new Set<string>()
  if (body.cg) ids.add(body.cg)
  if (Array.isArray(body.coingeckoIds)) {
    for (const id of body.coingeckoIds) if (typeof id === "string" && id) ids.add(id)
  }

  if (ids.size === 0) {
    return new Response(JSON.stringify({ ok: false, error: "cg required" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    })
  }

  const version = await kvGet<number>("links:cache_version")
  const v = typeof version === "number" ? version : 0
  await Promise.all(
    Array.from(ids).flatMap((cg) => [
      kvDel(`links:${cg}`),
      kvDel(`links:v${v}:${cg}`),
    ]),
  )

  return new Response(JSON.stringify({ ok: true, invalidated: Array.from(ids) }), {
    status: 200,
    headers: { "content-type": "application/json" },
  })
}
