-- The one clock, SQL side (simulation databases ONLY).
--
-- server/utils/clock.ts gives JS code one injectable "now". This gives SQL the
-- SAME now: unqualified now() in queries, column defaults and plpgsql resolves
-- to simclock.now() = pg_catalog.now() + the simulation offset, because the
-- database's search_path lists simclock BEFORE an explicit pg_catalog.
--
-- Install BEFORE building the schema (column DEFAULT now() binds at CREATE
-- TABLE time), then build with scripts/ci/build-schema-from-repo.sh. The
-- harness writes the same offset to simclock.state and to the JS clock file
-- (ACREOS_SIM_CLOCK_FILE) in one step (tests/simulation/platform/world.ts).
--
-- Not covered (SQL keywords, not functions — they cannot be shadowed):
-- CURRENT_TIMESTAMP, CURRENT_DATE, LOCALTIMESTAMP. The repo has 8 such sites
-- (measured 2026-10-07); scorecard limits list them.
create schema if not exists simclock;
create table if not exists simclock.state (
  id int primary key default 1 check (id = 1),
  offset_ms bigint not null default 0
);
insert into simclock.state (id, offset_ms) values (1, 0) on conflict (id) do nothing;

create or replace function simclock.now() returns timestamptz
language sql stable as $$
  select pg_catalog.now() + ((select offset_ms from simclock.state where id = 1) * interval '1 millisecond')
$$;

-- Refuse to be installed anywhere but a simulation database.
do $$
begin
  if current_database() !~ '^acreos_(simplat|founder|b2|market)' then
    raise exception 'simclock refuses database %', current_database();
  end if;
  execute format('alter database %I set search_path = "$user", public, simclock, pg_catalog', current_database());
end $$;
