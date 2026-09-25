# Moving CKSE out of Fixor's database

Status: design, 2026-09-25. Tracker item 4. Nothing here has been run.

## What is shared today

One Neon project, one branch, one database (`neondb`), one role (`neondb_owner`). Fixor's seven
tables (`installations`, `orgs`, `org_settings`, `audit_log`, `api_tokens`, `cost_ledger`,
`scan_runs`) sit beside six that belong to CKSE (`alembic_version`, `block`, `page`,
`projection_state`, `source`, `suppression_audit`). CKSE is disconnected: its stored connection
string carries the password that was reset on 2026-09-23, so it has been failing to connect since.

Why it has to move before CKSE is reconnected: one credential reaches both projects; an Alembic
autogenerate run by CKSE without a table filter emits `DROP TABLE` for every Fixor table; a
`drizzle-kit push` from Fixor emitted the same for CKSE's until the `tablesFilter` in
`drizzle.config.ts` (this branch); and a point-in-time restore of one project rolls back the other.

## Target

Same Neon project and branch, a second database `ckse` owned by a new role `ckse_owner` that can
connect to `ckse` only. `neondb_owner` keeps `neondb` and cannot connect to `ckse`. CKSE's
connection string names `ckse` and `ckse_owner`; Fixor's `DATABASE_URL` does not change.

## Cost

$0 on the Free plan, with one check. Neon's plan page: creating databases and roles inside an
existing project carries no charge (the limits are 100 projects, 10 branches per project, 500
databases per branch, 0.5 GB storage and 100 CU-hours per project). A second database on the same
branch shares the project's compute and storage, so the only way this costs anything is storage:
copying CKSE's data doubles its footprint until the old tables are dropped, and past 0.5 GB the
Free plan does not bill, it **refuses writes** for the whole project, Fixor's included. Step 1 reads
the size first; if the copy would cross 0.5 GB, stop and choose path A (no copy) or drop the old
tables in the same session as the copy.

## Path A or path B

- **Path A, fresh schema, no data copy.** CKSE recreates its schema in `ckse` with its own
  migrations, run by CKSE's owner in CKSE's environment (never from this repository; the rule in
  CLAUDE.md is that no Alembic command runs here). No password appears in any SQL. Choose this if
  CKSE's data (`block`, `page`, `source`, `projection_state`) is re-derivable from its sources,
  which the owner knows and this design does not.
- **Path B, copy the data.** There is no `pg_dump` on this machine and the Neon SQL Editor cannot
  copy across databases, so the copy runs inside Postgres with the `dblink` extension (in Neon's
  supported list, all Postgres versions). `dblink` needs a connection string with a password in
  the SQL text. That text lands in the Neon Console's query history. Use a **throwaway** role
  (`ckse_migrator`, step B2) for the source side, and drop it in the same session, so the password
  that appears in history is one that no longer exists. `neondb_owner`'s password is never typed.

## Steps, in order

Run each in the Neon SQL Editor **connected to the database named in the step**. Passwords: make
them yourself (a password manager or `openssl rand -base64 24`), at least 60 bits of entropy per
Neon's rule, and type them only where the step says. Do not paste any of them into a chat.

### 1. Size, in `neondb`

```sql
select relname, pg_size_pretty(pg_total_relation_size(quote_ident(relname))) as size,
       pg_total_relation_size(quote_ident(relname)) as bytes
from pg_class
where relname in ('alembic_version','block','page','projection_state','source','suppression_audit')
  and relkind = 'r'
order by bytes desc;
select pg_size_pretty(pg_database_size(current_database())) as neondb_total;
```

Means: the sum of `bytes` is what path B adds to the project until step 7. If
`neondb_total + sum(bytes)` is anywhere near 0.5 GB, path B is off the table unless step 7 runs
in the same session; otherwise proceed.

### 2. The role, in `neondb`, as `neondb_owner`

Create it with SQL, not the Console: a Console-created role is a member of `neon_superuser`,
which can create databases and roles, and would defeat the isolation. A SQL-created role has only
the default `PUBLIC` privileges.

```sql
create role ckse_owner with login password '<type the ckse_owner password here>';
select rolname, rolsuper, rolcreatedb, rolcreaterole from pg_roles where rolname = 'ckse_owner';
```

Means: one row, all three booleans `false`. If `rolcreatedb` or `rolcreaterole` is `true`, the
role was created the wrong way; drop it and repeat.

### 3. The database, in `neondb`, as `neondb_owner`

```sql
create database ckse owner ckse_owner;
revoke connect on database ckse from public;
revoke connect on database neondb from public;
select datname,
       has_database_privilege('ckse_owner', datname, 'CONNECT') as ckse_owner_can_connect,
       has_database_privilege('neondb_owner', datname, 'CONNECT') as neondb_owner_can_connect
from pg_database where datname in ('neondb','ckse');
```

Means: `neondb`: `false`, `true`. `ckse`: `true`, `false`. Owners keep every privilege on their
own database; `PUBLIC` no longer grants CONNECT to anyone else. One reading is acceptable with a
note: if `ckse` shows `true` for `neondb_owner`, that comes from its `neon_superuser` membership
(Console-created roles carry it), and the residual is one-directional: Fixor's credential could
still read CKSE's database, while CKSE's credential reaches nothing of Fixor's, which is the
direction that matters for Fixor. Any `true` for `ckse_owner` on `neondb` means stop.

Then, still in `neondb`: confirm Fixor is unaffected by reading the dashboard's
`https://app.fixor.dev/api/health` and the backend's `/health`; both should still answer `ok`,
because `neondb_owner` owns `neondb`.

### 4A. Path A: CKSE creates its schema

In CKSE's environment, set its connection string to the `ckse` database as `ckse_owner` (Neon's
connection string for the branch with `dbname=ckse` and the new user) and run CKSE's own migration
command there. Then, in `ckse`:

```sql
select tablename from pg_tables where schemaname = 'public' order by 1;
```

Means: CKSE's tables exist in `ckse`, owned by `ckse_owner`. Skip to step 6.

### 4B. Path B: copy the data with `dblink`

B1, in `ckse`, as `neondb_owner` cannot connect there (step 3), so as `ckse_owner`: in the SQL
Editor choose database `ckse` and role `ckse_owner`.

```sql
create extension if not exists dblink;
```

B2, in `neondb`, as `neondb_owner`: a throwaway reader for the copy.

```sql
create role ckse_migrator with login password '<type a throwaway password here>';
grant connect on database neondb to ckse_migrator;
grant usage on schema public to ckse_migrator;
grant select on alembic_version, block, page, projection_state, source, suppression_audit to ckse_migrator;
```

B3, in `neondb`, as `neondb_owner`: the DDL to recreate the six tables in `ckse`. CKSE's own
migrations are the right source of DDL (run them as in 4A, then copy rows into the empty tables).
If CKSE's migrations cannot run first, read the definitions:

```sql
select table_name, column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
  and table_name in ('alembic_version','block','page','projection_state','source','suppression_audit')
order by table_name, ordinal_position;
```

and recreate them by hand in `ckse` before B4. Primary keys, indexes and foreign keys come from
`pg_indexes` and `pg_constraint` the same way; getting them wrong is why 4A-first is preferred.

B4, in `ckse`, as `ckse_owner`, one statement per table, `alembic_version` last:

```sql
insert into block
select * from dblink(
  'host=<the branch host from the Neon connection string> dbname=neondb user=ckse_migrator password=<the throwaway password> sslmode=require',
  'select * from block'
) as t(<the column list with types, from B3>);
```

Means: `INSERT 0 <n>` with `n` equal to `select count(*) from block` in `neondb`. Repeat for
`page`, `source`, `projection_state`, `suppression_audit`, then `alembic_version` (so CKSE sees its
migrations as applied at the same revision).

B5, in `neondb`, as `neondb_owner`, in the same session as B4:

```sql
drop role ckse_migrator;
select count(*) from pg_roles where rolname = 'ckse_migrator';
```

Means: `0`. The password that appeared in the query history now opens nothing.

### 5. Row counts, both databases

In `neondb` and then in `ckse`:

```sql
select 'block' as t, count(*) from block
union all select 'page', count(*) from page
union all select 'source', count(*) from source
union all select 'projection_state', count(*) from projection_state
union all select 'suppression_audit', count(*) from suppression_audit
union all select 'alembic_version', count(*) from alembic_version;
```

Means: identical counts (path B) or the expected empty tables (path A). A mismatch: stop before
step 7; nothing has been dropped yet.

### 6. CKSE runs on `ckse`

Point CKSE at `ckse` as `ckse_owner` (the password typed into CKSE's configuration only) and let
it run for as long as the owner wants before anything is dropped. Read, in `neondb`:

```sql
select usename, datname, count(*) from pg_stat_activity group by 1, 2 order by 2, 1;
```

Means: no session as `ckse_owner` on `neondb`, and no session as `neondb_owner` on `ckse`. Any
other combination means a connection string is wrong.

### 7. Drop the old tables, in `neondb`, as `neondb_owner`

Only after step 6 has held for as long as the owner wants.

```sql
begin;
drop table suppression_audit, projection_state, page, block, source, alembic_version;
select tablename from pg_tables where schemaname = 'public' order by 1;
-- expect exactly: api_tokens, audit_log, cost_ledger, installations, org_settings, orgs, scan_runs
commit;
```

Means: the listed seven tables and nothing else. If anything else appears, `rollback` instead of
`commit`. (`drop table` of several names in one statement resolves their foreign keys together.)

### 8. Afterwards, in this repository

Remove the six names from `CKSE_TABLES` in `drizzle.config.ts` and the corresponding lines in
`src/test/test-drizzle-config-filter.ts` in one commit: the filter would otherwise name tables
that no longer exist, which is harmless but misleading. Record the move in the tracker.

## What this design does not cover

- Neon's point-in-time restore is per branch, so a restore still rolls both databases back
  together. Separate branches, or a second project, would fix that; both are $0 on the Free plan
  (10 branches per project, 100 projects) and a second project also separates the compute-hour
  and storage quotas. A second project is the better long-term home if CKSE grows; this design
  keeps one project because the owner asked for a database and a role.
- The dashboard's `DATABASE_URL` (Vercel) and the backend's (Railway) are unchanged and untouched.
