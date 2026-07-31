-- Rate-limit ledger for the public Edge Functions (barber-book, careers-apply).
-- Each row is one accepted request in a bucket ('book:ip', 'book:email',
-- 'careers:ip') for an identifier (IP or email). The functions prune expired
-- rows, count what remains in the sliding window, and reject over the cap.
--
-- Service-role only: the functions reach it with their service-role client
-- (which bypasses RLS), and no grants are given to anon/authenticated, so the
-- browser can never read or write this table. The functions degrade open if
-- this table is missing, so they keep working until this migration is applied.
create table if not exists public.rate_limit_hits (
  id bigint generated always as identity primary key,
  bucket text not null,
  identifier text not null,
  created_at timestamptz not null default now()
);

create index if not exists rate_limit_hits_lookup
  on public.rate_limit_hits (bucket, identifier, created_at);

alter table public.rate_limit_hits enable row level security;

-- service_role bypasses RLS, but grant explicitly so it can prune/read/write
-- regardless of default-privilege configuration.
grant select, insert, delete on public.rate_limit_hits to service_role;
