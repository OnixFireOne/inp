-- supabase/migrations/20260629_link_templates.sql
-- Aspect 1: schema for generated link templates + asset meta snapshots + asset status.
-- See plan/link-templates-spec.md (sections "Миграция" and "Аспект 1").
--
-- Summary of changes:
--   1) public.link_templates  — global rules for generating virtual links
--      (kind = pattern | provider). Order is managed out-of-band (drag-and-drop),
--      `sort` is a service field, not shown in admin UI.
--   2) public.asset_meta      — provider-agnostic snapshot cache
--      (first provider: 'coingecko'). Split out of assets.cg_meta so adding
--      new APIs doesn't require schema changes.
--   3) public.assets.status   — 'described' | 'template'.
--      'undescribed' is the implicit state when no row exists at all.
--   4) seed missing categories: site, docs, social, team, explorer
--      (social/team already existed — on conflict do nothing).
--   5) seed starter link_templates so generation works out of the box
--      (2 pattern + 7 provider).
--
-- Note on FK to link_categories.key:
--   link_categories gained asset_id in 20260627, so `key` is only unique within
--   the same asset_id (no global PK). We enforce "category points to a GLOBAL
--   link_categories row" via a BEFORE trigger instead of a foreign key.

-- ---------------------------------------------------------------------------
-- 1) link_templates
-- ---------------------------------------------------------------------------
create table if not exists public.link_templates (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null check (kind in ('pattern','provider')),
  category    text not null,
  label       text not null,
  icon        text,
  -- kind='pattern'
  url_pattern text,
  -- kind='provider'
  provider    text,
  source_key  text,
  tier        text not null default 'Trusted' check (tier in ('Core','Trusted')),
  sort        int  not null default 0,
  enabled     boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint link_templates_kind_fields check (
    (kind = 'pattern'  and url_pattern is not null) or
    (kind = 'provider' and provider is not null and source_key is not null)
  )
);

create index if not exists link_templates_enabled_idx
  on public.link_templates (enabled, category, sort);

alter table public.link_templates enable row level security;

drop policy if exists link_templates_read on public.link_templates;
create policy link_templates_read on public.link_templates
  for select using (true);

drop policy if exists link_templates_admin_write on public.link_templates;
create policy link_templates_admin_write on public.link_templates
  for all
  using (exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.role = 'admin'))
  with check (exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.role = 'admin'));

-- Enforce: category must point at a GLOBAL link_categories row (asset_id is null).
-- We use a trigger because after 20260627 the `key` column is no longer globally
-- unique, so a plain foreign key wouldn't work.
create or replace function public.link_templates_category_is_global()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1 from public.link_categories
    where key = new.category and asset_id is null
  ) then
    raise exception 'link_templates.category=% must reference a global link_categories.key (asset_id is null)', new.category;
  end if;
  return new;
end $$;

drop trigger if exists link_templates_category_global_chk on public.link_templates;
create trigger link_templates_category_global_chk
  before insert or update of category on public.link_templates
  for each row execute function public.link_templates_category_is_global();

-- ---------------------------------------------------------------------------
-- 2) asset_meta — provider-agnostic snapshot cache
-- ---------------------------------------------------------------------------
create table if not exists public.asset_meta (
  asset_id   text not null references public.assets(id) on delete cascade,
  provider   text not null,
  data       jsonb not null,
  fetched_at timestamptz not null default now(),
  primary key (asset_id, provider)
);

alter table public.asset_meta enable row level security;

drop policy if exists asset_meta_read on public.asset_meta;
create policy asset_meta_read on public.asset_meta
  for select using (true);

drop policy if exists asset_meta_admin_write on public.asset_meta;
create policy asset_meta_admin_write on public.asset_meta
  for all
  using (exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.role = 'admin'))
  with check (exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.role = 'admin'));

-- ---------------------------------------------------------------------------
-- 3) assets.status — described | template
--    'undescribed' is the implicit state when the row doesn't exist at all.
-- ---------------------------------------------------------------------------
alter table public.assets
  add column if not exists status text not null default 'described'
    check (status in ('described','template'));

-- ---------------------------------------------------------------------------
-- 4) Missing global categories for provider links
--    (social/team already exist from the original seed — on conflict no-op)
-- ---------------------------------------------------------------------------
insert into public.link_categories (key, label, sort) values
  ('site',     'Сайт',          5),
  ('docs',     'Документация', 45),
  ('social',   'Соцсети',       60),
  ('team',     'Команда',       80),
  ('explorer', 'Эксплореры',    95)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 5) Starter link_templates seed (so generation works out of the box)
-- ---------------------------------------------------------------------------

-- pattern: by variables {slug}/{symbol}
insert into public.link_templates (kind, category, label, icon, url_pattern, tier, sort, enabled) values
  ('pattern','trade','CoinGecko',   '🦎','https://www.coingecko.com/en/coins/{slug}',     'Core',10,true),
  ('pattern','trade','TradingView', '📈','https://www.tradingview.com/symbols/{symbol}USD','Core',20,true)
on conflict do nothing;

-- provider: pulled from coingecko asset_meta.data.links
insert into public.link_templates (kind, category, label, icon, provider, source_key, tier, sort, enabled) values
  ('provider','site',     'Сайт',       '🌐','coingecko','homepage',  'Core',   10,true),
  ('provider','docs',     'Whitepaper', '📄','coingecko','whitepaper','Trusted',10,true),
  ('provider','social',   'X (Twitter)','🐦','coingecko','twitter',   'Trusted',10,true),
  ('provider','social',   'Telegram',   '✈️','coingecko','telegram',  'Trusted',20,true),
  ('provider','social',   'Reddit',     '👽','coingecko','reddit',    'Trusted',30,true),
  ('provider','team',     'GitHub',     '💻','coingecko','github',    'Trusted',10,true),
  ('provider','explorer', 'Эксплорер',  '🔎','coingecko','explorer',  'Trusted',10,true)
on conflict do nothing;