-- Plote off-chain cache and file index (SPEC 14.2). The chain stays the source of truth.
-- Writes go through the service-role key in Vercel functions only; the browser gets read access to public tables.

-- photos (bucket "evidence", public read; writes only via signed upload URLs)
create table if not exists evidence_files (
  id uuid primary key default gen_random_uuid(),
  estate text not null,
  evidence_id bigint,                 -- filled after submit_evidence lands
  path text not null unique,
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  uploaded_by text not null,          -- NEAR account
  exif jsonb,                         -- client-side EXIF snapshot (display only)
  created_at timestamptz not null default now()
);
create index if not exists evidence_files_estate_idx on evidence_files (estate, created_at desc);

-- event cache for fast feeds
create table if not exists events (
  id bigserial primary key,
  network text not null check (network in ('testnet', 'mainnet')),
  estate text not null,
  unit text,
  standard text not null,             -- plote | nep171
  event text not null,
  data jsonb not null,
  tx_hash text not null,
  block_height bigint not null,
  block_time timestamptz not null,
  unique (tx_hash, event, unit)
);
create index if not exists events_estate_idx on events (estate, block_height desc);

create table if not exists oneclick_quotes (
  deposit_address text primary key,
  network text not null default 'mainnet',
  estate text not null,
  unit text not null,
  quote jsonb not null,
  status text not null default 'PENDING_DEPOSIT',
  synced boolean not null default false,
  chip_name text check (char_length(chip_name) <= 40),
  chip_note text check (char_length(chip_note) <= 140),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists chipins (
  id bigserial primary key,
  estate text not null,
  unit text not null,
  tx_hash text,
  deposit_address text,
  display_name text check (char_length(display_name) <= 40),
  note text check (char_length(note) <= 140),
  amount numeric,
  created_at timestamptz not null default now()
);
create index if not exists chipins_unit_idx on chipins (estate, unit, created_at desc);

create table if not exists notify_subscriptions (
  account text not null,
  estate text not null,
  unit text not null,
  email text not null check (position('@' in email) > 1),
  created_at timestamptz not null default now(),
  primary key (account, estate, unit)
);

create table if not exists gate_nonces (
  nonce text primary key,
  used_at timestamptz not null default now()
);

-- poller cursor (last processed block per estate)
create table if not exists poll_cursor (
  estate text primary key,
  block_height bigint not null default 0,
  updated_at timestamptz not null default now()
);

-- Row-level security: on everywhere; public read only where the data is public by design.
alter table evidence_files enable row level security;
alter table events enable row level security;
alter table oneclick_quotes enable row level security;
alter table chipins enable row level security;
alter table notify_subscriptions enable row level security;
alter table gate_nonces enable row level security;
alter table poll_cursor enable row level security;

drop policy if exists "public read" on evidence_files;
create policy "public read" on evidence_files for select using (true);
drop policy if exists "public read" on events;
create policy "public read" on events for select using (true);
drop policy if exists "public read" on chipins;
create policy "public read" on chipins for select using (true);
-- oneclick_quotes, notify_subscriptions, gate_nonces, poll_cursor: service role only (no policies).

-- Storage bucket for evidence photos: public read, no anonymous writes (uploads use signed URLs).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('evidence', 'evidence', true, 12582912, array['image/jpeg', 'image/png', 'image/heic'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
