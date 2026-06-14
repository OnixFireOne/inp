import { SupabaseClient } from "@supabase/supabase-js"

export async function migrateGuestWatchlist(sb: SupabaseClient, userId: string) {
  const raw = localStorage.getItem("inp.watchlist")
  if (!raw) return
  const ids: string[] = JSON.parse(raw)
  if (ids.length) {
    await sb.from("watchlist").upsert(
      ids.map(asset_id => ({ user_id: userId, asset_id })),
      { onConflict: "user_id,asset_id", ignoreDuplicates: true },
    )
  }
  localStorage.removeItem("inp.watchlist")
}
