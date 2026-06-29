// app/api/admin/invalidate-template-caches/route.ts
// Admin-only endpoint: bump link_templates cache version (tv). /api/links
// includes tv in its key (links:v{v}:t{tv}:{cg}), so every template mutation
// retires old storefront payloads without global scans.

import { NextRequest } from "next/server"
import { kvGet, kvSetEx } from "@/lib/kv"
import { supabaseServer } from "@/lib/supabase/server"
import { TEMPLATES_VERSION_KEY } from "@/lib/links/cache-key"

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

export async function POST(_req: NextRequest) {
  if (!(await assertAdmin())) {
    return json({ ok: false, error: "forbidden" }, 403)
  }

  const prev = await kvGet<number>(TEMPLATES_VERSION_KEY)
  const next = (typeof prev === "number" ? prev : 0) + 1
  await kvSetEx(TEMPLATES_VERSION_KEY, 60 * 60 * 24 * 7, next)
  return json({ ok: true, version: next }, 200)
}

export async function GET() {
  const v = await kvGet<number>(TEMPLATES_VERSION_KEY)
  return json({ version: typeof v === "number" ? v : 0 }, 200, "no-store")
}

function json(data: unknown, status: number, cache = "no-store") {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": cache,
    },
  })
}