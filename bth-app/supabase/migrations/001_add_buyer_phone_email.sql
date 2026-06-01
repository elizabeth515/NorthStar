-- Migration 001: Add phone and email columns to buyers table
-- Run this in the Supabase SQL Editor

alter table buyers add column if not exists phone text default '';
alter table buyers add column if not exists email text default '';

-- The existing RLS policies on the buyers table already cover these new columns:
--   buyers_select: all authenticated users can read all buyers
--   buyers_update: all authenticated users can update all buyers
-- No new policies are needed unless you add an agent_id foreign key for
-- per-agent ownership (the current schema uses agent_name text, not a FK).
