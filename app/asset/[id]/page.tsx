// app/asset/[id]/page.tsx — server component. Only serializable props.
// Never pass functions (onOpenChange) across the RSC boundary.

import { AssetModal } from "./App"
import { supabaseServer } from "@/lib/supabase/server"

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await supabaseServer()

  const { data: asset } = await supabase
    .from("assets")
    .select("id, name, ticker, icon, coingecko_id, tv_symbol")
    .eq("coingecko_id", id)
    .maybeSingle()

  return <AssetModal id={id} asset={asset} />
}
