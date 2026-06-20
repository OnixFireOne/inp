-- Migration: add icon text column to links
-- Run this in Supabase SQL editor

alter table public.links add column if not exists icon text;
