-- ============================================================
-- BUILD THE HOUSE — Supabase Setup
-- Run this entire file in the Supabase SQL Editor
-- ============================================================

-- AGENTS TABLE (one record per user account)
create table if not exists agents (
  id uuid references auth.users(id) on delete cascade primary key,
  name text not null default '',
  email text,
  created_at timestamptz default now()
);

-- Auto-create agent record when a new user signs up
create or replace function handle_new_user()
returns trigger as $$
begin
  insert into agents (id, email, name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1))
  );
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure handle_new_user();

-- BUYERS TABLE
create table if not exists buyers (
  id uuid default gen_random_uuid() primary key,
  client_name text default '',
  agent_name text default '',
  status text default 'Active',
  contacts jsonb default '[]'::jsonb,
  property_address text default '',
  north_star jsonb default '{}'::jsonb,
  profile jsonb default '{}'::jsonb,
  showings jsonb default '[]'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ROW LEVEL SECURITY
alter table agents enable row level security;
alter table buyers enable row level security;

-- Agents: any logged-in user can read all agents; only update your own
create policy "agents_select" on agents for select to authenticated using (true);
create policy "agents_insert" on agents for insert to authenticated with check (auth.uid() = id);
create policy "agents_update" on agents for update to authenticated using (auth.uid() = id);

-- Buyers: all logged-in users can read, create, update, delete
create policy "buyers_select" on buyers for select to authenticated using (true);
create policy "buyers_insert" on buyers for insert to authenticated with check (true);
create policy "buyers_update" on buyers for update to authenticated using (true);
create policy "buyers_delete" on buyers for delete to authenticated using (true);

-- Enable realtime on buyers table
alter publication supabase_realtime add table buyers;
