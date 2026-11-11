-- Audit 2 (11 Nov 2026). Server (service role) only, like 0002/0003: every new table has RLS on and no policies, every
-- function is SECURITY DEFINER with a fixed search_path and is revoked from anon/authenticated. Idempotent.

-- 1. Event poller (web/lib/server/poller.ts): receipts already processed, with or without events, so they're never
--    fetched again. The cursor stays in poll_cursor (0001): last block height fully processed per estate.
create table if not exists poll_receipts (
  receipt_id text primary key,
  estate text not null,
  tx_hash text not null,
  block_height bigint not null,
  events integer not null default 0,
  processed_at timestamptz not null default now()
);
create index if not exists poll_receipts_estate_idx on poll_receipts (estate, block_height desc);
alter table poll_receipts enable row level security;
alter table poll_cursor enable row level security; -- already on since 0001; restated so this file stands alone

-- 2. Evidence uploads: the size the surveyor declared and the 5-minute upload deadline (SPEC §17.2). Supabase signed
--    upload URLs can't be shortened or bound to a size, so the poller's storage check enforces both.
alter table evidence_files add column if not exists size_bytes bigint check (size_bytes is null or size_bytes > 0);
alter table evidence_files add column if not exists upload_expires_at timestamptz;

-- 3. /api/verify: a verdict OutLayer was paid for, kept until submit_verdict lands, so a retry doesn't pay again.
create table if not exists verify_results (
  estate text not null,
  evidence_id text not null,
  verdict jsonb not null,
  last_error text,
  submitted_at timestamptz,
  submitted_tx text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (estate, evidence_id)
);
alter table verify_results enable row level security;

-- 4. 1Click → family wall: the quote's chip_name / chip_note are copied to chipins once per deposit address.
alter table oneclick_quotes add column if not exists chipin_recorded boolean not null default false;
create unique index if not exists chipins_deposit_address_key on chipins (deposit_address) where deposit_address is not null;

-- 5. Gate passes (POST /api/gate/verify) are claimed with claim_once(scope 'gate', ...) from 0003, which has a TTL.
--    The gate_nonces table from 0001 was never used and has no TTL; it stays (service role only) and is unused.

-- 6. Housekeeping, called by the scheduled poller after each run.
create or replace function poll_prune()
returns void
language sql
security definer
set search_path = public
as $$
  delete from poll_receipts where processed_at < now() - interval '30 days';
  delete from verify_results where updated_at < now() - interval '30 days';
$$;
revoke all on function poll_prune() from public, anon, authenticated;
grant execute on function poll_prune() to service_role;

-- Belt and braces: no table added here is readable through the anon/authenticated API roles.
revoke all on table poll_receipts, verify_results from anon, authenticated;
