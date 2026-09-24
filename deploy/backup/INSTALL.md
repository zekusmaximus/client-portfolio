# Installing the nightly backup

Two independent layers protect the production database (tier-0 D12):

- **Layer 1: Render's own backups.** Whatever Render provides for the database's
  instance type (backups, point-in-time recovery). Nothing to install; step 1
  confirms what you have.
- **Layer 2: a nightly logical backup.** A GitHub Actions job in the private
  repository `zekusmaximus/client-portfolio-backups` runs `pg_dump` against
  Render's External Database URL at 07:00 UTC (about 3 am Eastern). It restores
  the dump into a throwaway PostgreSQL of the same major version, compares the
  row count of every table with production, and only then encrypts the dump
  with `age` and keeps it as a 90-day workflow artifact. Any failure fails the
  run and uploads nothing, and GitHub emails you.

The job runs only in the private repository, never in `client-portfolio`: that
repository is public, so its Actions logs and artifacts are readable by anyone.
You copy the two files the job needs into the private repository (step 5), so
the job holding the production credentials never runs code fetched from the
public one.

Everything below runs in Windows PowerShell on your machine. Allow about an
hour, including the restore drill in `RESTORE.md`.

## 0. Tools

```powershell
winget install --id FiloSottile.age -e
winget install --id GitHub.cli -e
winget install --id Docker.DockerDesktop -e
```

Open a new PowerShell window afterwards so `age`, `gh` and `docker` are on
`PATH`, start Docker Desktop once, and sign in to GitHub:

```powershell
gh auth login
age --version; gh --version; docker version --format '{{.Server.Version}}'
```

If winget reports that an id is not found, `winget search age`,
`winget search "GitHub CLI"` or `winget search docker` shows the current one.
Docker provides `psql`, `pg_dump` and `pg_restore` at exactly the server's
major version (`postgres:<major>` images), which is why these steps use it
rather than a native PostgreSQL install. With a native install
(`winget search PostgreSQL`) the same commands work without the
`docker run ... postgres:<major>` prefix.

## 1. Confirm the Render instance type and what Layer 1 gives you

In the Render Dashboard, open the database (not the web service) and write
down, from its pages:

- the instance type (Free or a paid type);
- the PostgreSQL major version, which becomes `PG_MAJOR`;
- whether point-in-time recovery is offered, and how far back;
- whether any other backups or exports are offered, and how long they are kept;
- any expiry date the dashboard shows.

Render documents recovery and backups at
<https://render.com/docs/postgresql-backups> and the Free plan's limits at
<https://render.com/docs/free>. Plans and retention windows change, so the
dashboard is the authority: if the docs name a feature the dashboard does not
show you, your instance type does not include it.

**If the instance type is Free:** read <https://render.com/docs/free> before
anything else and check the dashboard for an expiry date. If a free database
can expire or has no backups (confirm both there), it is not a production
database: upgrade it to a paid instance type in the dashboard before relying
on it. Layer 2 works on a free instance, and until the upgrade it is the only
backup, so do the rest of this guide today. It cannot stop an expired database
from taking the site down.

Put the values in the WP4 notes of `docs/plans/tier-0.md` section 2 when you
set WP4 to `verified on gbacpod.com`.

## 2. Optional: a read-only role for the backup

The job needs only to read. A role that cannot write means a leaked
`BACKUP_DATABASE_URL` cannot damage the book. If `CREATE ROLE` below fails
with `permission denied to create role`, skip the rest of this step; the job
then uses the database's own URL.

Copy the database's External Database URL from its page in the dashboard,
then:

```powershell
$major = '<PG_MAJOR from step 1>'
$ext = Read-Host 'External Database URL'
$bytes = New-Object byte[] 24
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
$pw = -join ($bytes | ForEach-Object { $_.ToString('x2') })
$pw   # store it in the password manager as "client-portfolio backup role"
docker run --rm -it -e PGSSLMODE=require "postgres:$major" psql $ext
```

In `psql`:

```sql
CREATE ROLE client_portfolio_backup LOGIN;
\password client_portfolio_backup
GRANT pg_read_all_data TO client_portfolio_backup;
```

`\password` asks for the password twice (paste `$pw`) and sends only its hash,
so the password never appears in the server's logs. `pg_read_all_data`
(PostgreSQL 14 and later) reads every table, including ones added later.

If the `GRANT` fails with `Only roles with the ADMIN option on role
"pg_read_all_data" may grant this role`, which is expected on PostgreSQL 16 and
later when Render's database user is not a superuser, grant the tables
directly instead. Run these as the database's own user, which owns the tables:

```sql
DO $$ BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO client_portfolio_backup', current_database());
END $$;
GRANT USAGE ON SCHEMA public TO client_portfolio_backup;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO client_portfolio_backup;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO client_portfolio_backup;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO client_portfolio_backup;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON SEQUENCES TO client_portfolio_backup;
\q
```

The default privileges cover tables the app creates later. Both variants were
checked in the WP4 session on PostgreSQL 16: the grant from a non-superuser
owner fails with that message, and with the table grants the backup succeeds
and a `DELETE` is refused.

Build the backup URL from the External URL, swapping in the new role, and
check it reads but cannot write:

```powershell
$backupUrl = $ext -replace '^postgres(ql)?://[^@]+@', "postgresql://client_portfolio_backup:$pw@"
docker run --rm -e PGSSLMODE=require "postgres:$major" psql $backupUrl -c 'SELECT count(*) FROM users'
docker run --rm -e PGSSLMODE=require "postgres:$major" psql $backupUrl -c "UPDATE users SET username = username WHERE false"
```

The first prints the number of partners; the second must fail with
`permission denied for table users`. Without the role, use `$backupUrl = $ext`.

## 3. Confirm the database accepts connections from GitHub-hosted runners

GitHub-hosted runners have no fixed IP address, so the database must accept
external connections from any address; access then rests on the password and
on TLS (the job sets `PGSSLMODE=require`).

In the dashboard, open the database's access-control (inbound IP) settings and
confirm that external connections are allowed from any source. Render
documents these settings at <https://render.com/docs/postgresql-creating-connecting>
and <https://render.com/docs/inbound-ip-rules>. If you have restricted them to
your own addresses and want to keep that, stop here: the nightly job cannot
connect, and the alternatives (a self-hosted runner, or a runner with a static
address) are a design change.

Step 2's `docker run` proved the URL, password and TLS from your machine. The
first workflow run (step 7) proves it from a runner; if that run fails with a
connection timeout, this setting is the cause.

## 4. Generate the age key pair

```powershell
$dir = Join-Path $env:TEMP 'cp-backup-key'
New-Item -ItemType Directory -Force $dir | Out-Null
age-keygen -o "$dir\key.txt"
$recipient = age-keygen -y "$dir\key.txt"
$recipient                 # the public key, age1...; it goes into AGE_RECIPIENT
Get-Content "$dir\key.txt"
```

Store the `AGE-SECRET-KEY-1...` line in the password manager as
"client-portfolio backup age key", with the public key in the same entry's
notes. That entry is the only copy of the private key: never put it in a
repository, a secret, a variable or an email. Losing it makes every backup
unreadable.

Prove the stored copy works before deleting the file: delete it, copy the
`AGE-SECRET-KEY-1...` line from the password manager, and decrypt a test
message with it.

```powershell
Remove-Item "$dir\key.txt"
# copy the AGE-SECRET-KEY-1... line from the password manager, then:
[IO.File]::WriteAllText("$dir\key.txt", (Get-Clipboard -Raw).Trim() + "`n")
'round trip ok' | age -r $recipient -o "$dir\test.age"
age -d -i "$dir\key.txt" "$dir\test.age"   # prints: round trip ok
Remove-Item -Recurse -Force $dir
Set-Clipboard -Value ' '
```

If Windows clipboard history is on, also delete the entry from it (Win+V).

## 5. Create the private repository and copy the files

Make sure your `client-portfolio` clone is on an up-to-date `main` that
contains `deploy/backup/` (WP4 merged), then:

```powershell
$src = '<path to your client-portfolio clone>'
$repo = 'zekusmaximus/client-portfolio-backups'
Set-Location '<folder where you keep clones>'
gh repo create $repo --private --clone --description 'Nightly encrypted backups of client-portfolio'
Set-Location client-portfolio-backups
New-Item -ItemType Directory -Force .github\workflows | Out-Null
Copy-Item "$src\deploy\backup\pg-backup.sh" .\pg-backup.sh
Copy-Item "$src\deploy\backup\backup.yml" .\.github\workflows\backup.yml
Set-Content -Path .gitattributes -Value '* text=auto eol=lf' -Encoding ascii
git add -A
git commit -m 'Nightly encrypted backup of client-portfolio'
git branch -M main
git push -u origin main
gh repo view $repo --json visibility --jq .visibility   # must print PRIVATE
```

`.gitattributes` keeps the script's line endings LF whatever your Git
settings, so bash can run it on the runner.

When `deploy/backup/pg-backup.sh` or `deploy/backup/backup.yml` changes in
`client-portfolio`, review the change there and copy the file again; the
private repository never updates itself.

## 6. Set the secret, the variables, retention and notifications

```powershell
gh secret set BACKUP_DATABASE_URL --repo $repo --body $backupUrl
gh variable set PG_MAJOR --repo $repo --body $major
gh variable set AGE_RECIPIENT --repo $repo --body $recipient
gh secret list --repo $repo
gh variable list --repo $repo
Remove-Variable backupUrl, ext, pw
```

If you opened a new PowerShell window since steps 2 and 4, set `$backupUrl`,
`$major` and `$recipient` again first, or run `gh secret set
BACKUP_DATABASE_URL --repo $repo` without `--body` and paste the URL at its
prompt.

In the private repository's Settings, under Actions, General, confirm that
"Artifact and log retention" is at least 90 days: the workflow asks for 90 and
the repository setting is the ceiling. In your GitHub account's notification
settings, under Actions, confirm that failed workflow runs are emailed to you.
A failure email is the only alarm this job has.

Actions minutes and artifact storage in a private repository count against
your GitHub plan's included amounts (Settings, Billing). A run takes a few
minutes and each artifact is about the size of the dump.

## 7. Run it once and download the result

```powershell
gh workflow run backup.yml --repo $repo
Start-Sleep 10
$run = gh run list --repo $repo --workflow backup.yml --limit 1 --json databaseId --jq '.[0].databaseId'
gh run watch $run --repo $repo --exit-status
gh run view $run --repo $repo --log | Select-String 'pg-backup:'
gh run download $run --repo $repo --name client-portfolio-backup --dir "$HOME\cp-backup-$run"
Get-ChildItem "$HOME\cp-backup-$run"
```

The log shows the versions, one line per table with the production and
restored counts, `row counts match for N tables`, and the file name,
`client_portfolio_<UTC stamp>.dump.age`. Then do the restore drill in
`RESTORE.md` sections (a) to (d) with this file and record it in section (f).

## Troubleshooting

| The run fails with | Cause and fix |
|---|---|
| `postgres:PG_MAJOR-is-not-set` (initialising containers) | the `PG_MAJOR` variable is missing: `gh variable set PG_MAJOR` |
| `cannot connect to the source database`, after a timeout | access control (step 3) |
| `cannot connect ...` with `password authentication failed` | the secret's user or password; set `BACKUP_DATABASE_URL` again |
| `pg_dump is PostgreSQL X but the source server is Y` | Render upgraded the database: `gh variable set PG_MAJOR --body Y` |
| `AGE_RECIPIENT is not a valid age recipient` | set it again to the `age1...` public key |
| `AGE_RECIPIENT holds an age PRIVATE key` | the private key was stored as a variable, and variables are not secret (the settings page shows them, and any log that printed one would show it): delete the variable, treat that key as exposed, generate a new pair (step 4) and set the new public key |
| `table users is missing` or `the users table is empty` | the secret points at another database |
| `pg_restore into the restore-check database failed` | the dump contains something the stock `postgres` image cannot restore; the lines above it name the object |
| `row counts of the restored dump differ` | the counts table above it shows which table; run the workflow again, and if it repeats, the dump is not faithful and needs investigating |

If `gh workflow list --repo $repo` ever shows the workflow as disabled, enable
it with `gh workflow enable backup.yml --repo $repo`.

## Rotating the age key

Generate a new pair (step 4) and set the new public key in `AGE_RECIPIENT`.
Keep the old private key in the password manager until the last artifact
encrypted to it has expired, 90 days later.
