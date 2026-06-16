// SIWE disabled for now. See /plan notes.
// To re-enable: replace this stub with the original `siwe_nonce` set-cookie logic.

export async function GET() {
  return new Response(JSON.stringify({ error: "siwe_disabled" }), {
    status: 503,
    headers: { "content-type": "application/json" },
  })
}
