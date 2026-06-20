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
  ('trade','Биржи / трейд',10),
  ('chart','Графики',20),
  ('earn','Заработок',30),
  ('tools','Инструменты',40),
  ('news','Новости',50),
  ('social','Соцсети',60),
  ('review','Обзоры',70),
  ('team','Команда',80),
  ('tokenomics','Токеномика',90),
  ('aggregator','Агрегаторы',100)
on conflict (key) do nothing;
