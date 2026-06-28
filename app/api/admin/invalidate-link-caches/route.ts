// app/api/admin/invalidate-link-caches/route.ts
// Admin-only endpoint: invalidate all `links:*` KV cache entries after a
// mutation to the `link_categories` table, so the next /api/links fetch
// picks up the new category metadata (incl. scope changes and label edits).
//
// We use a cache-busting version token: bumping it changes the prefix used
// by /api/links, instantly making all old `links:*` entries unreachable
// without enumerating keys.
//
// GET is intentionally public so /api/links (server route, no user context)
// can compose its cache key without auth overhead — it only reads an opaque
// monotonic integer. POST is admin-gated: anyone able to bump the version
// can effectively force every /api/links request to re-run its 4-query
// Supabase fetch, i.e. a cache-stampede / DoS lever.

import { NextRequest } from "next/server"
import { kvGet, kvSetEx } from "@/lib/kv"
import { supabaseServer } from "@/lib/supabase/server"

const VERSION_KEY = "links:cache_version"

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

export async function POST(_req: NextRequest) {
  if (!(await assertAdmin())) {
    return new Response(JSON.stringify({ ok: false, error: "forbidden" }), {
      status: 403,
      headers: { "content-type": "application/json" },
    })
  }

  const prev = await kvGet<number>(VERSION_KEY)
  const next = (typeof prev === "number" ? prev : 0) + 1
  // Keep the version alive long enough to outlive any in-flight fetches.
  await kvSetEx(VERSION_KEY, 60 * 60 * 24 * 7, next)

  return new Response(
    JSON.stringify({ ok: true, version: next }),
    { status: 200, headers: { "content-type": "application/json" } },
  )
}

export async function GET() {
  // Public read so /api/links can compose its key.
  const v = await kvGet<number>(VERSION_KEY)
  return new Response(JSON.stringify({ version: typeof v === "number" ? v : 0 }), {
    status: 200,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  })
}