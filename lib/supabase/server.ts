import { createServerClient } from "@supabase/ssr"
import { cookies } from "next/headers"

export async function supabaseServer() {
  const store = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll: () => store.getAll(),
        // Cookies can only be written from a Server Action / Route Handler /
        // Middleware. If supabaseServer() is invoked from a Server Component
        // (e.g. our admin layout) and the session needs to refresh, the SSR
        // helper will try to rotate tokens and Next.js throws.
        //
        // Two layers of defence:
        //   1. proxy.ts (middleware) is the authoritative place to refresh
        //      the session, and it can legally write cookies.
        //   2. This try/catch is a safety net for any Server Component that
        //      still needs to read auth state. We swallow the write so the
        //      component doesn't crash; the next request through middleware
        //      will carry the refreshed tokens.
        setAll: (xs: Array<{ name: string; value: string; options?: object }>) => {
          try {
            for (const { name, value, options } of xs) {
              store.set(name, value, options)
            }
          } catch {
            // Ignored: cookies cannot be written from a Server Component.
            // The session will be refreshed on the next middleware pass.
          }
        },
      },
    },
  )
}
