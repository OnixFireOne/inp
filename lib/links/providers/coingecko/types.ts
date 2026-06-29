// lib/links/providers/coingecko/types.ts
// Trimmed snapshot of CoinGecko /coins/{id} payload.
// We only keep the fields we actually consume in source resolvers; everything
// else is dropped at fetch time so storage stays small and a CG schema drift
// doesn't affect us.
// See plan/link-templates-spec.md, section "Аспект 2" -> "2.1".

export type CgMeta = {
  links: {
    homepage?: string[]
    whitepaper?: string
    blockchain_site?: string[]
    official_forum_url?: string[]
    chat_url?: string[]
    twitter_screen_name?: string
    telegram_channel_identifier?: string
    subreddit_url?: string
    repos_url?: { github?: string[] }
  }
  detail_platforms?: Record<
    string,
    { contract_address: string; decimal_place: number | null }
  >
  image?: { thumb?: string; small?: string; large?: string }
}
