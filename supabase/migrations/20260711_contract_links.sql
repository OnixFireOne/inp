-- supabase/migrations/20260711_contract_links.sql
-- Aspect: contract links (DexScreener / GMGN / Birdeye) driven by
-- {contract}/{chain} placeholders in pattern templates + a per-row
-- chain_map (CoinGecko chain key → target site slug).
-- See plan/contract-links.md.
--
-- Order matters:
--   1) chain_map column (idempotent).
--   2) unique index on link_templates (provider, source_key) for provider
--      rows so the existing seed-style `on conflict do nothing` becomes
--      truly idempotent (current seed would otherwise duplicate on re-run).
--   3) seed the global `dex` category BEFORE any template that references
--      it — the BEFORE trigger link_templates_category_is_global would
--      reject the insert otherwise.
--   4) seed starter DexScreener / GMGN / Birdeye pattern rows.

-- ---------------------------------------------------------------------------
-- 1) chain_map on link_templates
-- ---------------------------------------------------------------------------
alter table public.link_templates
  add column if not exists chain_map jsonb;

-- ---------------------------------------------------------------------------
-- 2) Unique index for provider rows (idempotent re-runs of seed)
-- ---------------------------------------------------------------------------
create unique index if not exists link_templates_provider_source_uq
  on public.link_templates (provider, source_key)
  where kind = 'provider';

-- ---------------------------------------------------------------------------
-- 3) Global DEX tools category
-- ---------------------------------------------------------------------------
insert into public.link_categories (key, label, sort) values
  ('dex', 'DEX tools', 15)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 4) Starter contract-link templates
--    After this migration these are just normal rows; admins can edit /
--    disable / delete / add more from /admin/link-templates.
-- ---------------------------------------------------------------------------
insert into public.link_templates
  (kind, category, label, url_pattern, chain_map, tier, sort, enabled)
values
  ('pattern','dex','DexScreener','https://dexscreener.com/{chain}/{contract}',
   '{"ethereum":"ethereum","binance-smart-chain":"bsc","solana":"solana","base":"base","arbitrum-one":"arbitrum","polygon-pos":"polygon","avalanche":"avalanche","tron":"tron"}'::jsonb,
   'Trusted',10,true),
  ('pattern','dex','GMGN','https://gmgn.ai/{chain}/token/{contract}',
   '{"ethereum":"eth","binance-smart-chain":"bsc","solana":"sol","base":"base","tron":"tron"}'::jsonb,
   'Trusted',20,true),
  ('pattern','dex','Birdeye','https://birdeye.so/token/{contract}?chain={chain}',
   '{"solana":"solana","ethereum":"ethereum","binance-smart-chain":"bsc","base":"base"}'::jsonb,
   'Trusted',30,true)
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 5) explorer template: clear its label so the resolver's labelFromUrl
--    fallback kicks in (BTC → "Blockchair", ETH → "Etherscan" etc.).
--    The previous default ("Эксплорер") is now produced only if URL parsing
--    fails — which it never does for blockchain_site entries.
-- ---------------------------------------------------------------------------
update public.link_templates
   set label = ''
 where kind = 'provider'
   and provider = 'coingecko'
   and source_key = 'explorer'
   and label = 'Эксплорер';