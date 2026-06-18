-- supabase/migrations/20260618_admin_catalog_rls.sql
-- Stage 1 "catalog": nesting seed for links + admin-RLS on assets/links.
-- Profiles PK is `user_id` (see 20260614_phase3_rls.sql).

-- ---------------------------------------------------------------------------
-- 1. links: nesting seed columns.
--    We keep the model FLAT in this PR (parent_id stays NULL everywhere).
--    Columns are added now so the future tree UI does not need a migration.
-- ---------------------------------------------------------------------------
alter table public.links
  add column if not exists parent_id uuid null references public.links(id) on delete cascade;

alter table public.links
  add column if not exists sort int not null default 0;

create index if not exists idx_links_parent_id on public.links(parent_id);
create index if not exists idx_links_asset_id  on public.links(asset_id);

-- ---------------------------------------------------------------------------
-- 2. Enable RLS on assets and links (was off, so the showcase could read).
--    Read stays public; write is admin-only via profiles.role='admin'.
-- ---------------------------------------------------------------------------
alter table public.assets enable row level security;
alter table public.links  enable row level security;

-- assets: public read
drop policy if exists assets_public_read on public.assets;
create policy assets_public_read on public.assets
  for select using (true);

-- assets: admin write
drop policy if exists assets_admin_write on public.assets;
create policy assets_admin_write on public.assets
  for all
  using (
    exists (
      select 1 from public.profiles p
      where p.user_id = auth.uid() and p.role = 'admin'
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.user_id = auth.uid() and p.role = 'admin'
    )
  );

-- links: public read
drop policy if exists links_public_read on public.links;
create policy links_public_read on public.links
  for select using (true);

-- links: admin write
drop policy if exists links_admin_write on public.links;
create policy links_admin_write on public.links
  for all
  using (
    exists (
      select 1 from public.profiles p
      where p.user_id = auth.uid() and p.role = 'admin'
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.user_id = auth.uid() and p.role = 'admin'
    )
  );

-- ---------------------------------------------------------------------------
-- 3. Speed up the admin guard lookup by role.
-- ---------------------------------------------------------------------------
create index if not exists idx_profiles_role_admin
  on public.profiles(role)
  where role = 'admin';
