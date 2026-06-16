// SIWE disabled for now. See /plan notes.
// To re-enable: restore the SiweMessage.verify(...) flow and Supabase admin lookup.

export async function POST() {
  return new Response(JSON.stringify({ error: "siwe_disabled" }), {
    status: 503,
    headers: { "content-type": "application/json" },
  })
}
