#!/usr/bin/env bash
# Nightly logical backup of the client-portfolio database (tier-0 WP4, D12).
#
# Runs in the private repository zekusmaximus/client-portfolio-backups
# (backup.yml), never in the public client-portfolio repository. Steps:
#
#   1. Dump the source database (pg_dump custom format, no owners, no grants)
#      and count the rows of every table in its public schema. The counts and
#      the dump share one exported snapshot, so they describe the same state
#      even if a partner edits during the run.
#   2. Refuse the dump of a wrong database: users, clients and client_revenues
#      must exist and users must not be empty.
#   3. Restore the plaintext dump into an empty, throwaway database of the same
#      PostgreSQL major version and require identical counts for every table.
#   4. Only then encrypt the dump to one age recipient, delete the plaintext and
#      publish client_portfolio_<UTC stamp>.dump.age in BACKUP_OUT_DIR.
#
# Any failure exits non-zero and leaves neither the plaintext dump nor a
# .dump.age behind. Output: versions, row counts and the output file name;
# never a connection string.
#
# Configuration, from the environment only:
#   BACKUP_DATABASE_URL  source database (production: Render's External Database
#                        URL, preferably for a read-only role)
#   PGSSLMODE            TLS mode for the source only (default: require)
#   RESTORE_CHECK_URL    an EMPTY database on a throwaway server of the same major
#                        version (backup.yml: a postgres service container)
#   RESTORE_PGSSLMODE    TLS mode for the restore check (default: prefer)
#   AGE_RECIPIENT        age public key (age1...); the private key is never here
#   BACKUP_OUT_DIR       where the .dump.age goes (default: current directory)
#   TMPDIR               where the plaintext dump lives while the script runs
# pg_dump, pg_restore and psql must be the source server's major version.

set -euo pipefail
umask 077

prog=pg-backup
work='' partial='' out='' created=0

say() { printf '%s: %s\n' "$prog" "$*"; }
die() { printf '%s: error: %s\n' "$prog" "$*" >&2; exit 1; }

cleanup() {
  local status=$?
  trap - EXIT
  if [ -n "$work" ]; then rm -rf -- "$work"; fi
  if [ -n "$partial" ]; then rm -f -- "$partial"; fi
  if [ "$status" -ne 0 ]; then
    if [ "$created" -eq 1 ]; then rm -f -- "$out"; fi
    printf '%s: FAILED (exit %s); no backup written\n' "$prog" "$status" >&2
  fi
  exit "$status"
}
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

# --- configuration ---------------------------------------------------------

for name in BACKUP_DATABASE_URL RESTORE_CHECK_URL AGE_RECIPIENT; do
  [ -n "${!name:-}" ] || die "$name is not set"
done
[ "$BACKUP_DATABASE_URL" != "$RESTORE_CHECK_URL" ] \
  || die "BACKUP_DATABASE_URL and RESTORE_CHECK_URL are the same"
source_sslmode=${PGSSLMODE:-require}
restore_sslmode=${RESTORE_PGSSLMODE:-prefer}
out_dir=${BACKUP_OUT_DIR:-.}

for tool in pg_dump pg_restore psql age; do
  command -v "$tool" >/dev/null || die "$tool is not on PATH"
done

# A private key in AGE_RECIPIENT would be printed by age's error message. Stop
# before that, without echoing it.
if [[ ${AGE_RECIPIENT^^} == *AGE-SECRET-KEY-* ]]; then
  die "AGE_RECIPIENT holds an age PRIVATE key. Remove it wherever it is set, generate a new key pair, and set only the public key (age1...)."
fi
age --encrypt --recipient "$AGE_RECIPIENT" --output /dev/null </dev/null 2>/dev/null \
  || die "AGE_RECIPIENT is not a valid age recipient (expected the public key, age1...)"

source_psql() {
  PGSSLMODE=$source_sslmode psql -X -q -At -w -v ON_ERROR_STOP=1 \
    --dbname="$BACKUP_DATABASE_URL" "$@"
}
restore_psql() {
  PGSSLMODE=$restore_sslmode psql -X -q -At -w -v ON_ERROR_STOP=1 \
    --dbname="$RESTORE_CHECK_URL" "$@"
}

# One "table|rows" line per table in the public schema, sorted by table name.
count_rows_sql() {
  cat <<'SQL'
SELECT format('SELECT %L, count(*) FROM %I.%I', c.relname, n.nspname, c.relname)
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
 ORDER BY c.relname
\gexec
SQL
}

# --- versions and targets --------------------------------------------------

client_major=''
for tool in pg_dump pg_restore; do
  read -r _ _ version _ <<<"$("$tool" --version)"
  major=${version%%[!0-9]*}
  [ -z "$client_major" ] || [ "$major" = "$client_major" ] \
    || die "pg_dump and pg_restore are different major versions"
  client_major=$major
done

source_major=$(source_psql -c "SELECT current_setting('server_version_num')::int / 10000") \
  || die "cannot connect to the source database (BACKUP_DATABASE_URL)"
restore_major=$(restore_psql -c "SELECT current_setting('server_version_num')::int / 10000") \
  || die "cannot connect to the restore-check database (RESTORE_CHECK_URL)"
say "pg_dump $version; source server PostgreSQL $source_major; restore-check server PostgreSQL $restore_major"
[ "$client_major" = "$source_major" ] \
  || die "pg_dump is PostgreSQL $client_major but the source server is $source_major; set PG_MAJOR to $source_major"
[ "$restore_major" = "$source_major" ] \
  || die "the restore-check server is PostgreSQL $restore_major but the source is $source_major; they must match"

# The restore check writes only into an empty database. This also stops a
# misconfigured RESTORE_CHECK_URL from ever writing into production.
relations=$(restore_psql -c "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public'")
[ "$relations" = 0 ] \
  || die "the restore-check database is not empty ($relations relations in public); it must be a new, empty database"

mkdir -p -- "$out_dir"
out="$out_dir/client_portfolio_$(date -u +%Y%m%dT%H%M%SZ).dump.age"
[ ! -e "$out" ] || die "$out already exists"
work=$(mktemp -d "${TMPDIR:-/tmp}/pg-backup.XXXXXX")
dump="$work/client_portfolio.dump"

# --- 1. dump and count in one snapshot -------------------------------------

# psql holds a REPEATABLE READ transaction open, counts every table in it, and
# runs pg_dump on the snapshot it exported. psql's \! ignores the command's
# exit status, so pg_dump leaves a marker file when it succeeds.
export PG_BACKUP_DUMP="$dump" PG_BACKUP_DUMP_OK="$work/dump.ok"
snapshot_script() {
  printf '%s\n' \
    'BEGIN ISOLATION LEVEL REPEATABLE READ, READ ONLY;' \
    'SELECT pg_export_snapshot() AS snapshot \gset' \
    '\setenv PG_BACKUP_SNAPSHOT :snapshot'
  count_rows_sql
  # shellcheck disable=SC2016 # expanded by the shell that psql's \! starts
  printf '%s\n' \
    '\! pg_dump --format=custom --no-owner --no-privileges --no-password --snapshot="$PG_BACKUP_SNAPSHOT" --file="$PG_BACKUP_DUMP" --dbname="$BACKUP_DATABASE_URL" && : > "$PG_BACKUP_DUMP_OK"' \
    'COMMIT;'
}
snapshot_script | source_psql -f - >"$work/source.counts" \
  || die "counting the source database's rows failed"
if [ ! -f "$PG_BACKUP_DUMP_OK" ] || [ ! -s "$dump" ]; then die "pg_dump failed"; fi
say "dumped $(wc -c <"$dump") bytes"

# --- 2. is this the client-portfolio database? ------------------------------

rows_in() { awk -F'|' -v t="$1" '$1 == t { print $2 }' "$work/source.counts"; }
for table in users clients client_revenues; do
  [ -n "$(rows_in "$table")" ] \
    || die "table $table is missing from the source; BACKUP_DATABASE_URL is not the client-portfolio database"
done
[ "$(rows_in users)" -gt 0 ] \
  || die "the users table is empty; BACKUP_DATABASE_URL is not the production database"

# --- 3. restore into the throwaway database and compare --------------------

PGSSLMODE=$restore_sslmode pg_restore --no-owner --no-privileges --exit-on-error \
  --single-transaction --no-password --dbname="$RESTORE_CHECK_URL" "$dump" \
  || die "pg_restore into the restore-check database failed"
count_rows_sql | restore_psql -f - >"$work/restored.counts" \
  || die "counting the restored rows failed"

LC_ALL=C sort -t'|' -k1,1 -o "$work/source.counts" "$work/source.counts"
LC_ALL=C sort -t'|' -k1,1 -o "$work/restored.counts" "$work/restored.counts"
printf '%s:   %-28s %12s %12s\n' "$prog" table source restored
LC_ALL=C join -t'|' -a1 -a2 -e missing -o 0,1.2,2.2 \
    "$work/source.counts" "$work/restored.counts" \
  | awk -F'|' -v p="$prog" '{
      printf "%s:   %-28s %12s %12s%s\n", p, $1, $2, $3, ($2 == $3 ? "" : "   MISMATCH")
    }'
cmp -s "$work/source.counts" "$work/restored.counts" \
  || die "row counts of the restored dump differ from the source"
say "row counts match for $(wc -l <"$work/source.counts") tables"

# --- 4. encrypt, delete the plaintext, publish ------------------------------

partial="$out.partial"
age --encrypt --recipient "$AGE_RECIPIENT" --output "$partial" "$dump" \
  || die "age encryption failed"
[ "$(head -c 21 "$partial")" = 'age-encryption.org/v1' ] \
  || die "the encrypted file does not start with an age header"
rm -f -- "$dump"
mv -- "$partial" "$out"
created=1
say "wrote $out ($(wc -c <"$out") bytes)"
