-- Cross-tenant WRITE detection for simulation databases ONLY.
--
-- The db tap (preload.mjs) sets simplat.actor_org on the connection before
-- every write made inside a request acting for a tenant. This AFTER trigger,
-- installed on every public table with an organization_id column, records any
-- row written (inserted, updated — before or after — or deleted) whose
-- organization_id is a DIFFERENT tenant. The invariant monitor reads
-- simplat.tenant_writes after every tick. Founder requests, jobs and webhooks
-- carry no actor and are not checked here (they are platform scope by design).
do $$ begin
  if current_database() !~ '^acreos_simplat' then raise exception 'tenant tap refuses database %', current_database(); end if;
end $$;
create schema if not exists simplat;
create table if not exists simplat.tenant_writes (
  id bigserial primary key,
  at timestamptz not null default now(),
  actor_org int not null,
  row_org int not null,
  tbl text not null,
  op text not null
);
create or replace function simplat.tenant_check() returns trigger language plpgsql as $$
declare a text := current_setting('simplat.actor_org', true); o int; n int;
begin
  if a is null or a = '' then return null; end if;
  if TG_OP in ('UPDATE', 'DELETE') then o := nullif(to_jsonb(OLD)->>'organization_id', '')::int; end if;
  if TG_OP in ('INSERT', 'UPDATE') then n := nullif(to_jsonb(NEW)->>'organization_id', '')::int; end if;
  if o is not null and o > 0 and o <> a::int then
    insert into simplat.tenant_writes (actor_org, row_org, tbl, op) values (a::int, o, TG_TABLE_NAME, TG_OP);
  elsif n is not null and n > 0 and n <> a::int then
    insert into simplat.tenant_writes (actor_org, row_org, tbl, op) values (a::int, n, TG_TABLE_NAME, TG_OP);
  end if;
  return null;
end $$;
do $$ declare r record; begin
  for r in select c.table_name from information_schema.columns c join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
            where c.table_schema = 'public' and c.column_name = 'organization_id' and c.data_type in ('integer', 'bigint') and t.table_type = 'BASE TABLE'
  loop
    execute format('drop trigger if exists simplat_tenant_tap on public.%I', r.table_name);
    execute format('create trigger simplat_tenant_tap after insert or update or delete on public.%I for each row execute function simplat.tenant_check()', r.table_name);
  end loop;
end $$;
select count(*) as tables_tapped from pg_trigger where tgname = 'simplat_tenant_tap';
