-- Houston Kart Sim: online backend (run once in your Supabase project's SQL editor).
-- Stores every lap posted by players; the leaderboard view keeps each player's best lap per class.
create table if not exists public.laps (
  id bigint generated always as identity primary key,
  player text not null check (char_length(player) between 4 and 16),
  name text not null check (char_length(name) between 1 and 16),
  kart_class text not null check (kart_class in ('adult', 'junior')),
  lap_ms integer not null check (lap_ms between 20000 and 180000),
  track text not null check (char_length(track) between 1 and 40),
  created_at timestamptz not null default now()
);
create index if not exists laps_board on public.laps (track, kart_class, lap_ms);
alter table public.laps enable row level security;
drop policy if exists "anyone can read laps" on public.laps;
create policy "anyone can read laps" on public.laps for select to anon using (true);
drop policy if exists "anyone can post a lap" on public.laps;
create policy "anyone can post a lap" on public.laps for insert to anon with check (true);
grant select, insert on public.laps to anon;

create or replace view public.leaderboard with (security_invoker = on) as
  select distinct on (track, kart_class, player) track, kart_class, player, name, lap_ms, created_at
  from public.laps
  order by track, kart_class, player, lap_ms asc, created_at asc;
grant select on public.leaderboard to anon;
-- Live races use Supabase Realtime broadcast/presence channels; no tables are needed for those.
