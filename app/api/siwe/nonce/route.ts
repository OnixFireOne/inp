import { randomBytes } from "crypto"

export async function GET() {
  const nonce = randomBytes(16).toString("hex")
  return new Response(JSON.stringify({ nonce }), {
    headers: {
      "content-type": "application/json",
      "set-cookie": `siwe_nonce=${nonce}; Path=/; HttpOnly; SameSite=Lax; Max-Age=300`,
    },
  })
}
