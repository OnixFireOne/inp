-- Migration: link_categories table
-- Run this in Supabase SQL editor

create table if not exists public.link_categories (
  key text primary key,
  label text not null,
  icon text,
  sort int not null default 0
);

alter table public.link_categories enable row level security;

-- читать могут все (нужно витрине для группировки)
create policy link_categories_read on public.link_categories
  for select using (true);

-- писать только админ
create policy link_categories_admin_write on public.link_categories
  for all
  using (exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.role = 'admin'))
  with check (exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.role = 'admin'));

-- сид текущими значениями
insert into public.link_categories (key, label, sort) values
  ('trade','Trade',4),
  ('chart','Charts',2),
  ('earn','Earn',9),
  ('tools','Tools',8),
  ('news','News',3),
  ('social','Social',7),
  ('review','Review',5),
  ('team','Team',6),
  ('tokenomics','Tokenomics',10),
  ('aggregator','Aggregators',1)
on conflict (key) do nothing;
