// app/auth/callback/route.ts
// OAuth callback. Supports ?next=/safe/path so we can deep-link to /admin
// after Google sign-in. SIWE flow is untouched (it doesn't go through here).
//
// Redirect safety: a single leading slash is NOT enough — a string like
// "//evil.com" still starts with "/" and is a protocol-relative URL that
// the browser will follow to a different host. We reject both "//" and "/\".
import { NextRequest, NextResponse } from "next/server"
import { supabaseServer } from "@/lib/supabase/server"
import { safeNextPath } from "@/lib/auth/safe-next"

export async function GET(req: NextRequest) {
  const next = safeNextPath(req.nextUrl.searchParams.get("next"))
  const code = req.nextUrl.searchParams.get("code")

  if (code) {
    const sb = await supabaseServer()
    await sb.auth.exchangeCodeForSession(code)
  }

  return NextResponse.redirect(new URL(next, req.url))
}
