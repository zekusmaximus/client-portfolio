# Restoring from a backup

Two layers exist (see `INSTALL.md`):

- **Layer 1, Render's own backups.** When the database still exists and your
  instance type has point-in-time recovery, this is the finer-grained choice:
  it can go back to shortly before the damage. Section (e1).
- **Layer 2, the nightly artifacts** in the private repository
  `zekusmaximus/client-portfolio-backups`: one encrypted dump per night, kept
  90 days, each restore-checked before it was encrypted. Sections (a) to (d)
  to open one; (e2) to put it into production.

Everything runs in PowerShell 7 with `age`, `gh` and Docker Desktop
(`INSTALL.md` step 0), plus the age private key from the password manager; in
Windows PowerShell 5.1, drop `-MaskInput`. Use one window throughout: the
commands reuse `$repo`, `$major`, `$run`, `$work` and `$enc`.

```powershell
$repo = 'zekusmaximus/client-portfolio-backups'
gh variable list --repo $repo      # PG_MAJOR is the PostgreSQL major version
$major = '<PG_MAJOR>'
```

## (a) Download the latest backup

```powershell
$run = gh run list --repo $repo --workflow backup.yml --status success --limit 1 --json databaseId --jq '.[0].databaseId'
$work = Join-Path $HOME "cp-restore-$run"
gh run download $run --repo $repo --name client-portfolio-backup --dir $work
Get-ChildItem $work
gh run view $run --repo $repo --log | Select-String 'pg-backup:'
```

The log lines are the row counts production had when that dump was taken;
section (d) compares against them. For an older night, list the runs and pick
one: `gh run list --repo $repo --workflow backup.yml --status success --limit 40`.

## (b) Decrypt

```powershell
$key = Join-Path $work 'key.txt'
$enc = (Get-ChildItem $work -Filter *.dump.age | Select-Object -First 1).FullName
```

Run the next line on its own. At its prompt, paste the `AGE-SECRET-KEY-1...`
line copied from the password manager (asterisks show) and press Enter. The
key goes in at a prompt because copying a command from this page replaces
whatever is on the clipboard.

```powershell
$k = Read-Host -MaskInput 'Paste the AGE-SECRET-KEY line from the password manager'
```

```powershell
[IO.File]::WriteAllText($key, $k.Trim() + "`n")
Remove-Variable k
Set-Clipboard -Value ' '
age -d -i $key -o "$work\client_portfolio.dump" $enc
Remove-Item $key
Test-Path "$work\client_portfolio.dump"
```

`age` prints nothing when it succeeds, and the last line must print `True`.
If Windows clipboard history is on, delete the key from it (Win+V). The
decrypted `client_portfolio.dump` holds the whole book in plain form: keep it
in `$work`, and delete `$work` when you finish ("Clean up" below).

Go on to (c) straight away. In the first drill the decrypted file disappeared
from `$work` within minutes, before it was restored; the cause was not
established, and an antivirus quarantine is the likely one. If `pg_restore`
then reports `could not open input file`, check Windows Security, Virus &
threat protection, Protection history (without restoring or allowing
anything), and decrypt again.

## (c) Restore into a scratch database

A throwaway PostgreSQL of the same major version, with no port published:

```powershell
docker run -d --name cp-restore -e POSTGRES_HOST_AUTH_METHOD=trust -v "${work}:/work" "postgres:$major"
do { Start-Sleep 1; docker exec cp-restore pg_isready -h 127.0.0.1 -U postgres -q } until ($LASTEXITCODE -eq 0)
docker exec cp-restore createdb -U postgres client_portfolio_restoretest
docker exec cp-restore pg_restore -U postgres --no-owner --no-privileges --exit-on-error --dbname client_portfolio_restoretest /work/client_portfolio.dump
```

`pg_restore` prints nothing when it succeeds.

## (d) Compare row counts

```powershell
@'
SELECT format('SELECT %L, count(*) FROM public.%I', c.relname, c.relname)
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
 ORDER BY c.relname
\gexec
'@ | docker exec -i cp-restore psql -U postgres -d client_portfolio_restoretest -At
docker exec cp-restore psql -U postgres -d client_portfolio_restoretest -c 'SELECT max(updated_at) AS last_client_edit FROM clients'
```

Every `table|count` line must equal the matching line in the run's log from
(a). Production today may have more or fewer rows than the dump because of
edits since the backup; the log is the exact reference. The last edit time
shows how recent the dump's content is.

### Clean up

```powershell
docker rm -f cp-restore
Remove-Item -Recurse -Force $work
```

During (e2), wait until its step 9.

## (e) Restore production on Render

Tell the partners to stop editing and note the time. Decide what to restore
to: the last good moment before the damage.

### (e1) Render's own restore path first

If the database still exists and step 1 of `INSTALL.md` found point-in-time
recovery or another Render backup for your instance type, use it: open the
database in the Render Dashboard and follow Render's restore flow for a time
just before the damage. Render documents it at
<https://render.com/docs/postgresql-backups>; confirm in the dashboard whether
the restore replaces the existing database or creates a new one. If it
creates a new one, continue with (e2) steps 5 to 9 using that database.

### (e2) From a nightly dump

1. Download and decrypt the chosen night's backup: sections (a) and (b).
   Running (c) and (d) first, without the clean-up, proves the file before
   production depends on it.
2. In the Render Dashboard, create a new PostgreSQL database: the same region
   as the web service, PostgreSQL `$major`, a paid instance type. Copy its
   External Database URL.
3. Restore into it from your machine:

   ```powershell
   $new = Read-Host 'External Database URL of the NEW database'
   docker run --rm -e PGSSLMODE=require -v "${work}:/work" "postgres:$major" pg_restore --no-owner --no-privileges --exit-on-error --single-transaction --dbname $new /work/client_portfolio.dump
   ```

   Do this before the web service points at the new database: on start the
   server runs `init-db.sql`, which would create empty tables that the restore
   then collides with.
4. Check the counts on the new database, as in (d):

   ```powershell
   @'
   SELECT format('SELECT %L, count(*) FROM public.%I', c.relname, c.relname)
     FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
    ORDER BY c.relname
   \gexec
   '@ | docker run --rm -i -e PGSSLMODE=require "postgres:$major" psql -At $new
   ```

5. In the web service's Environment settings, set `DATABASE_URL` to the new
   database's URL: its Internal Database URL if the current value is an
   internal URL (web service and database in the same region), otherwise its
   External Database URL. Leave `DATABASE_SSL` as it is. Save; changing an
   environment variable means a redeploy.
6. Check the API once the deploy is live:

   ```powershell
   Invoke-RestMethod https://client-portfolio-backend.onrender.com/api/health
   ```

   `services.database` must be `connected`.
7. Sign in at <https://gbacpod.com> and check the dashboard total and a client
   you know. Partners stay signed in: sessions are stateless JWTs and the user
   ids are unchanged.
8. Point the backup at the new database: create the read-only role there
   (`INSTALL.md` step 2) and `gh secret set BACKUP_DATABASE_URL --repo $repo`
   with its URL. Until you do, tonight's backup dumps the old database, or
   fails once it is deleted.
9. Keep the old database until you are satisfied, then delete it in the
   dashboard. Run "Clean up" above.

## (f) Quarterly restore drill

In the first week of January, April, July and October, run sections (a) to (d)
on the latest backup, then "Clean up". The drill proves
four things at once: the schedule still fires (the run from (a) is from last
night; a run that never starts sends no failure email), the artifacts
download, the key in the password manager decrypts them, and the dump restores
with the counts the log recorded. Record
each drill here, and in `docs/plans/tier-0.md` section 2 for the first one.

| Date | Backup run (id, UTC stamp) | Restored without errors | Counts match the run log | Minutes | By | Notes |
|---|---|---|---|---|---|---|
| 2026-09-24 | 36047210847, `20260924T191851Z` | yes, on the second decryption | yes: `client_revenues` 251, `clients` 100, `users` 7 | about 30, including troubleshooting | Jeff | first drill, the day the job was installed; the first decrypted copy disappeared from disk before `pg_restore` (cause not established) |
| | | | | | | |
