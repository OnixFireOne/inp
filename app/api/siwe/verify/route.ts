import { SiweMessage } from "siwe"
import { createClient } from "@supabase/supabase-js"
import { cookies } from "next/headers"

export async function POST(req: Request) {
  const { message, signature } = await req.json()
  const nonce = (await cookies()).get("siwe_nonce")?.value
  const siwe = new SiweMessage(message)
  const result = await siwe.verify({ signature, nonce })
  if (!result.success) return Response.json({ ok: false }, { status: 401 })

  const address = siwe.address.toLowerCase()

  // SERVICE ROLE ONLY ON SERVER
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  // find or create user by wallet + set profile.wallet_address
  // (simplified: in real would use admin.auth.admin.generateLink)
  return Response.json({ ok: true, address })
}
