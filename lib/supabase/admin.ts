import "server-only"
import { createClient } from "@supabase/supabase-js"

// 2026: secret key only, for server-side admin/seed operations. Never in browser.
export const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  }
)
