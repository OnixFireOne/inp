// proxy.ts (Next 16: middleware was renamed to proxy)
// Lightweight gate for /admin/*: just check that the user is authenticated.
// We do NOT touch the DB here (no role lookup) to keep the public showcase
// hot path fast. The authoritative role check lives in app/(admin)/admin/layout.tsx.
import { NextRequest, NextResponse } from "next/server"
import { createServerClient } from "@supabase/ssr"

export const config = {
  matcher: ["/admin/:path*"],
}

export async function proxy(req: NextRequest) {
  // Build a response we can attach refreshed cookies to.
  const res = NextResponse.next()

  // Short-lived read-only client: we only need `getUser()` to validate the JWT.
  const sb = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll: () => req.cookies.getAll(),
        // We never write from proxy: SSR will refresh the session cookies
        // on the next request via the server client.
        setAll: () => {},
      },
    },
  )

  const {
    data: { user },
  } = await sb.auth.getUser()

  if (!user) {
    const url = req.nextUrl.clone()
    url.pathname = "/auth/signin"
    url.searchParams.set("next", req.nextUrl.pathname + req.nextUrl.search)
    return NextResponse.redirect(url)
  }

  return res
}
