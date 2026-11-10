-- Security hardening for the API routes (pre-audit review). Server (service role) only: every table has RLS on and
-- no policies, and every function is revoked from anon/authenticated.

-- 1. Single-use values: NEP-413 nonces (upload / notify) and relayed delegate hashes, with an expiry.
create table if not exists used_nonces (
  scope text not null,
  nonce text not null,
  expires_at timestamptz not null,
  primary key (scope, nonce)
);
alter table used_nonces enable row level security;

-- True only for the first caller within the TTL (an expired entry can be claimed again).
create or replace function claim_once(p_scope text, p_nonce text, p_ttl_seconds integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  insert into used_nonces as u (scope, nonce, expires_at)
  values (p_scope, p_nonce, now() + make_interval(secs => p_ttl_seconds))
  on conflict (scope, nonce) do update
    set expires_at = excluded.expires_at
    where u.expires_at < now();
  get diagnostics n = row_count;
  return n = 1;
end;
$$;
revoke all on function claim_once(text, text, integer) from public, anon, authenticated;
grant execute on function claim_once(text, text, integer) to service_role;

-- 2. HTTPS verification runs (/api/verify): one run at a time per evidence (a lease) and a cap on total runs,
--    so concurrent or repeated calls can't each pay OutLayer.
create table if not exists verify_claims (
  estate text not null,
  evidence_id text not null,
  attempts integer not null default 0,
  leased_until timestamptz not null,
  updated_at timestamptz not null default now(),
  primary key (estate, evidence_id)
);
alter table verify_claims enable row level security;

create or replace function verify_claim(p_estate text, p_evidence_id text, p_lease_seconds integer, p_max_attempts integer)
returns table (ok boolean, tries integer, why text)
language plpgsql
security definer
set search_path = public
as $$
declare
  a integer;
  l timestamptz;
begin
  insert into verify_claims as v (estate, evidence_id, attempts, leased_until, updated_at)
  values (p_estate, p_evidence_id, 1, now() + make_interval(secs => p_lease_seconds), now())
  on conflict (estate, evidence_id) do update
    set attempts = v.attempts + 1,
        leased_until = now() + make_interval(secs => p_lease_seconds),
        updated_at = now()
    where v.leased_until < now() and v.attempts < p_max_attempts
  returning v.attempts into a;
  if a is not null then
    return query select true, a, 'claimed'::text;
    return;
  end if;
  select v.attempts, v.leased_until into a, l from verify_claims v where v.estate = p_estate and v.evidence_id = p_evidence_id;
  return query select false, a, (case when l >= now() then 'busy' else 'exhausted' end)::text;
end;
$$;
revoke all on function verify_claim(text, text, integer, integer) from public, anon, authenticated;
grant execute on function verify_claim(text, text, integer, integer) to service_role;

-- Ends the lease once a run has finished; the attempt still counts.
create or replace function verify_release(p_estate text, p_evidence_id text)
returns void
language sql
security definer
set search_path = public
as $$
  update verify_claims set leased_until = now() - interval '1 second', updated_at = now()
  where estate = p_estate and evidence_id = p_evidence_id;
$$;
revoke all on function verify_release(text, text) from public, anon, authenticated;
grant execute on function verify_release(text, text) to service_role;

-- 3. Family wall: one note per transaction. Keep the oldest row of any existing duplicates first.
delete from chipins a using chipins b
where a.tx_hash is not null and a.tx_hash = b.tx_hash and a.id > b.id;
create unique index if not exists chipins_tx_hash_key on chipins (tx_hash) where tx_hash is not null;

-- 4. Housekeeping, called by the scheduled poller.
create or replace function security_prune()
returns void
language sql
security definer
set search_path = public
as $$
  delete from used_nonces where expires_at < now();
  delete from verify_claims where updated_at < now() - interval '30 days' and leased_until < now();
$$;
revoke all on function security_prune() from public, anon, authenticated;
grant execute on function security_prune() to service_role;
