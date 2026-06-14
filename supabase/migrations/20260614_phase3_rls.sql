-- supabase/migrations/20260614_phase3_rls.sql
-- profiles + watchlist + RLS (Phase 3)

create table if not exists profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'user' check (role in ('user','admin')),
  wallet_address text unique,
  created_at timestamptz not null default now()
);

create table if not exists watchlist (
  user_id uuid not null references auth.users(id) on delete cascade,
  asset_id text not null references assets(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, asset_id)
);

alter table profiles enable row level security;
alter table watchlist enable row level security;

-- profiles: only own rows
create policy profiles_self_select on profiles
  for select using (auth.uid() = user_id);
create policy profiles_self_upsert on profiles
  for insert with check (auth.uid() = user_id);
create policy profiles_self_update on profiles
  for update using (auth.uid() = user_id);

-- watchlist: full CRUD only own rows
create policy watchlist_self_all on watchlist
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- auto-create profile on signup
create or replace function handle_new_user() returns trigger
  language plpgsql security definer as $$
begin
  insert into profiles(user_id) values (new.id)
  on conflict (user_id) do nothing;
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();
