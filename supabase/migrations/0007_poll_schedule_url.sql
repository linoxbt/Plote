-- Reschedules the 5-minute poller (job 'plote-poll', first created by 0005) so its URL isn't hard-coded: the app URL
-- is read from Supabase Vault at call time (secret 'plote_app_url', e.g. https://plote-vert.vercel.app), falling back
-- to https://plote-vert.vercel.app when the secret doesn't exist. The request still carries POLL_SECRET from Vault
-- ('plote_poll_secret', see 0005). Idempotent: cron.schedule with an existing job name replaces that job.
--
-- Optional one-time setup (service role / SQL editor; the URL isn't a secret, Vault just keeps it out of this file):
--   select vault.create_secret('https://plote-vert.vercel.app', 'plote_app_url');
-- To move the poller to another deployment: select vault.update_secret((select id from vault.secrets where name = 'plote_app_url'), 'https://<new>');

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'plote-poll',
  '*/5 * * * *',
  $$
  select net.http_get(
    url := rtrim(coalesce(
      (select decrypted_secret from vault.decrypted_secrets where name = 'plote_app_url' limit 1),
      'https://plote-vert.vercel.app'
    ), '/') || '/api/cron/poll',
    headers := jsonb_build_object(
      'x-cron-secret',
      (select decrypted_secret from vault.decrypted_secrets where name = 'plote_poll_secret' limit 1)
    ),
    timeout_milliseconds := 60000
  );
  $$
);
