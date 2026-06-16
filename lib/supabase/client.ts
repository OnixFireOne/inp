import { createBrowserClient } from "@supabase/ssr"

// 2026: only the new publishable (opaque) key. Legacy `anon` is not used.
export const supabaseBrowser = () =>
  createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  )
