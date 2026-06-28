-- Migration: link_categories scope (per-coin categories)
-- Adds asset_id to link_categories so a category can be scoped to a single
-- asset (coin). When asset_id is NULL the category stays global (visible for
-- every coin, as before). When asset_id is set, the category is shown only on
-- that asset's page/drawer.
--
-- PK stays `key` (text) — keys remain globally unique, so `links.category`
-- (also text) doesn't need a schema change and a single-coin category can be
-- inserted between globals by writing its position into assets.category_orders.
--
-- Run this in Supabase SQL editor.

alter table public.link_categories
  add column if not exists asset_id text references public.assets(id) on delete cascade;

create index if not exists link_categories_asset_idx
  on public.link_categories (asset_id, sort);

create index if not exists link_categories_global_idx
  on public.link_categories (sort)
  where asset_id is null;

-- Existing read policy `link_categories_read` uses `using (true)` and covers
-- both global and scoped rows. The admin write policy covers all rows by
-- default as well, so no RLS changes are needed here.
--
-- After data normalisation (no `links.category` outside the categories table),
-- uncomment to enforce FK:
--
-- alter table public.links
--   add constraint links_category_fk
--   foreign key (category) references public.link_categories(key)
--   on update cascade on delete set null;