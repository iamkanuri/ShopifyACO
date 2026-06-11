-- 0002_grants — the app connects ONLY with the service-role (secret) key, which
-- authenticates as the service_role Postgres role. Tables created through the
-- session pooler (as the postgres role) are not auto-granted to service_role, so
-- grant explicitly. Intentionally NOT granted to anon/authenticated: these tables
-- hold emails and stay private to the server (never reachable via the public key).

grant usage on schema public to service_role;
grant select, insert, update, delete on table leads, runs, events to service_role;
grant usage, select on all sequences in schema public to service_role;
