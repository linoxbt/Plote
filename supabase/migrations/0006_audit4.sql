-- Audit 4 (Nov 2026): poller correctness and housekeeping. Server (service role) only, like 0002-0004: new tables have
-- RLS on and no policies; functions are SECURITY DEFINER with a fixed search_path, revoked from anon/authenticated.
-- Idempotent: safe to run again. Apply before deploying the web build that uses it (the poller needs every part).

-- 1. events: one row per real event. The old key (tx_hash, event, unit) dropped a second identical event in the same
--    transaction (two `released` of one unit, an event repeated across receipts) and multi-token NEP-171 events.
--    New key: (tx_hash, receipt_id, log_index, data_index) = the receipt, the log line in it, and the data item (one
--    per token id for NEP-171 events with several). Rows cached before this have null receipt_id/log_index/data_index;
--    the poller never re-inserts them (their receipts are in poll_receipts or below the cursor).
alter table events add column if not exists receipt_id text;
alter table events add column if not exists log_index integer;
alter table events add column if not exists data_index integer;

do $$
declare c record;
begin
  for c in
    select con.conname
    from pg_constraint con
    where con.conrelid = 'public.events'::regclass
      and con.contype = 'u'
      and (select array_agg(att.attname::text order by att.attname)
           from unnest(con.conkey) k join pg_attribute att on att.attrelid = con.conrelid and att.attnum = k)
          = array['event', 'tx_hash', 'unit']
  loop
    execute format('alter table events drop constraint %I', c.conname);
  end loop;
end $$;

create unique index if not exists events_receipt_log_key on events (tx_hash, receipt_id, log_index, data_index);

-- 2. events.notified_at: follow-ups (emails for qs_signed / released, subscription clean-up on sold / nft_transfer)
--    and booking deposit_deferred with report_deposit are done from the table, so a poller run that dies after
--    inserting loses nothing. The poller inserts those events with notified_at null and everything else stamped.
--    Rows cached before this are stamped now (no historic emails).
alter table events add column if not exists notified_at timestamptz;
update events set notified_at = now() where notified_at is null;
create index if not exists events_follow_up_idx on events (id) where notified_at is null;

-- 3. poll_cursor: a listing that didn't reach the cursor is continued next run from the saved NearBlocks token
--    (resume_next), instead of moving the cursor past receipts it never listed. resume_newest = newest height of that
--    pass (where the cursor goes when the listing is complete); resume_pending_min = lowest receipt it couldn't read.
alter table poll_cursor add column if not exists resume_next text;
alter table poll_cursor add column if not exists resume_newest bigint;
alter table poll_cursor add column if not exists resume_pending_min bigint;

-- Saves the cursor and the continuation. block_height never moves backwards (greatest), so an overlapping or late run
-- can't undo a newer one. updated_at is stamped on every save: /api/health reads it to tell whether the poller runs.
create or replace function poll_cursor_save(p_estate text, p_height bigint, p_resume_next text, p_resume_newest bigint, p_resume_pending_min bigint)
returns void
language sql
security definer
set search_path = public
as $$
  insert into poll_cursor as c (estate, block_height, resume_next, resume_newest, resume_pending_min, updated_at)
  values (p_estate, greatest(p_height, 0), p_resume_next, p_resume_newest, p_resume_pending_min, now())
  on conflict (estate) do update
    set block_height = greatest(c.block_height, excluded.block_height),
        resume_next = excluded.resume_next,
        resume_newest = excluded.resume_newest,
        resume_pending_min = excluded.resume_pending_min,
        updated_at = now();
$$;
revoke all on function poll_cursor_save(text, bigint, text, bigint, bigint) from public, anon, authenticated;
grant execute on function poll_cursor_save(text, bigint, text, bigint, bigint) to service_role;

-- 4. One poller run at a time (pg_cron and a manual workflow_dispatch can overlap): a lease row. The lease (75 s from
--    the web route) outlives the function's 60 s maxDuration, so a killed run frees it on its own.
create table if not exists poll_lock (
  name text primary key,
  holder text not null,
  leased_until timestamptz not null
);
alter table poll_lock enable row level security;

create or replace function poll_lock_acquire(p_holder text, p_ttl_seconds integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  insert into poll_lock as l (name, holder, leased_until)
  values ('poll', p_holder, now() + make_interval(secs => p_ttl_seconds))
  on conflict (name) do update
    set holder = excluded.holder, leased_until = excluded.leased_until
    where l.leased_until < now();
  get diagnostics n = row_count;
  return n = 1;
end;
$$;
revoke all on function poll_lock_acquire(text, integer) from public, anon, authenticated;
grant execute on function poll_lock_acquire(text, integer) to service_role;

create or replace function poll_lock_release(p_holder text)
returns void
language sql
security definer
set search_path = public
as $$
  update poll_lock set leased_until = now() - interval '1 second' where name = 'poll' and holder = p_holder;
$$;
revoke all on function poll_lock_release(text) from public, anon, authenticated;
grant execute on function poll_lock_release(text) to service_role;

-- 5. gate_nonces (0001) was never used: gate passes are claimed with claim_once (0003). Nothing references it.
drop table if exists gate_nonces;

-- 6. Evidence bucket: JPEG and PNG only, the same two types /api/evidence/upload-url accepts (HEIC was allowed by the
--    bucket but always refused by the route, so a HEIC upload could never be recorded or checked).
update storage.buckets set allowed_mime_types = array['image/jpeg', 'image/png'] where id = 'evidence';

-- Belt and braces: nothing added here is readable through the anon/authenticated API roles.
revoke all on table poll_lock from anon, authenticated;
