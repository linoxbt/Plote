-- Shared rate limits for the API routes (fixed window per key), so limits hold across every serverless instance.
-- Only the server (service role) can call it; the table has RLS on and no policies, so anon/authenticated see nothing.
create table if not exists rate_limits (
  key text primary key,
  window_start timestamptz not null,
  hits integer not null
);
alter table rate_limits enable row level security;

create or replace function rate_limit_hit(p_key text, p_limit integer, p_window_seconds integer)
returns table (allowed boolean, retry_after integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  w timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  h integer;
begin
  insert into rate_limits as r (key, window_start, hits) values (p_key, w, 1)
  on conflict (key) do update
    set hits = case when r.window_start = w then r.hits + 1 else 1 end,
        window_start = w
  returning r.hits into h;
  return query select h <= p_limit,
    case when h <= p_limit then 0
         else greatest(1, ceil(extract(epoch from (w + make_interval(secs => p_window_seconds) - now())))::integer) end;
end;
$$;

revoke all on function rate_limit_hit(text, integer, integer) from public, anon, authenticated;
grant execute on function rate_limit_hit(text, integer, integer) to service_role;

-- Old windows are useless; keep the table small.
create or replace function rate_limits_prune() returns void language sql security definer set search_path = public as $$
  delete from rate_limits where window_start < now() - interval '1 hour';
$$;
revoke all on function rate_limits_prune() from public, anon, authenticated;
grant execute on function rate_limits_prune() to service_role;
