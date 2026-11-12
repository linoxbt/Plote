-- Superseded by 0007_poll_schedule_url.sql (same job, URL read from Vault secret plote_app_url). Kept as applied.
-- Reliable 5-minute schedule for the event poller (/api/cron/poll), inside the stack. GitHub Actions' cron proved
-- unreliable (it never fired the schedule), so pg_cron + pg_net call the endpoint from the database instead.
-- The request carries POLL_SECRET, read from Supabase Vault at call time (never stored in this file or in cron.job).
--
-- One-time setup, before applying this file (run with the service role / SQL editor; never commit the value):
--   select vault.create_secret('<same value as POLL_SECRET in Vercel>', 'plote_poll_secret');
-- To rotate: select vault.update_secret((select id from vault.secrets where name = 'plote_poll_secret'), '<new>');

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'plote-poll',
  '*/5 * * * *',
  $$
  select net.http_get(
    url := 'https://plote-vert.vercel.app/api/cron/poll',
    headers := jsonb_build_object(
      'x-cron-secret',
      (select decrypted_secret from vault.decrypted_secrets where name = 'plote_poll_secret' limit 1)
    ),
    timeout_milliseconds := 60000
  );
  $$
);
