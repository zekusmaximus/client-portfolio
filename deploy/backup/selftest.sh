#!/usr/bin/env bash
# Self-test for pg-backup.sh (tier-0 WP4). Run it only against a THROWAWAY
# PostgreSQL server: it creates and drops databases named pgb_selftest_*.
#
#   SELFTEST_SERVER_URL          superuser URL of that server without a database
#                                name (default: postgresql://postgres@127.0.0.1:5432)
#   SELFTEST_WRONG_PASSWORD_URL  optional: a source URL with a wrong password;
#                                that case is skipped when unset (CI's server
#                                trusts every connection)
#
# Seeds a source database with init-db.sql plus synthetic rows, backs it up
# with a throwaway age key, decrypts and restores the output and checks the
# counts. Then runs each failure path and checks that it exits non-zero with
# the expected message, leaves no .dump.age and no plaintext behind, and never
# prints a connection string or the private key.

set -euo pipefail
umask 077

here=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
repo=$(cd -- "$here/../.." && pwd)
server=${SELFTEST_SERVER_URL:-postgresql://postgres@127.0.0.1:5432}
export PGSSLMODE=prefer PGOPTIONS='-c client_min_messages=warning'

t=$(mktemp -d)
databases=(pgb_selftest_source pgb_selftest_restore pgb_selftest_verify
           pgb_selftest_empty pgb_selftest_nousers)

psql_on() { local db=$1; shift; psql -X -q -At -w -v ON_ERROR_STOP=1 --dbname="$server/$db" "$@"; }
fresh() { psql_on postgres -c "DROP DATABASE IF EXISTS $1" -c "CREATE DATABASE $1"; }

cleanup() {
  local db
  for db in "${databases[@]}"; do
    psql_on postgres -c "DROP DATABASE IF EXISTS $db" >/dev/null 2>&1 || true
  done
  rm -rf -- "$t"
}
trap cleanup EXIT

# --- fixtures --------------------------------------------------------------

age-keygen -o "$t/key.txt" 2>/dev/null
recipient=$(age-keygen -y "$t/key.txt")
secret=$(grep '^AGE-SECRET-KEY-' "$t/key.txt")

fresh pgb_selftest_source
psql_on pgb_selftest_source -f "$repo/init-db.sql"
psql_on pgb_selftest_source -f - <<'SQL'
INSERT INTO users (username, password_hash) VALUES
  ('selftest-partner-a', 'synthetic-not-a-hash'),
  ('selftest-partner-b', 'synthetic-not-a-hash');
INSERT INTO clients (user_id, name, status, practice_area, stickiness)
SELECT (SELECT min(id) FROM users), format('Synthetic Client %s', i), 'IF',
       ARRAY['Synthetic'], 1 + i % 5
  FROM generate_series(1, 5) AS i;
INSERT INTO client_revenues (client_id, year, revenue_amount)
SELECT c.id, y, 10000 * (y - 2022)
  FROM clients c CROSS JOIN generate_series(2023, 2025) AS y;
SQL
expected='2 5 15'   # users, clients, client_revenues

fresh pgb_selftest_empty
fresh pgb_selftest_nousers
psql_on pgb_selftest_nousers -f "$repo/init-db.sql"

# Stand-ins for the two failures a real server cannot be made to produce on
# demand: pg_dump failing after the snapshot is exported, and age writing
# something that is not age output.
mkdir -p "$t/bin-pgdump" "$t/bin-age"
cat >"$t/bin-pgdump/pg_dump" <<EOF
#!/usr/bin/env bash
if [ "\${1:-}" = --version ]; then exec "$(command -v pg_dump)" --version; fi
echo 'pg_dump: error: simulated failure' >&2
exit 1
EOF
cat >"$t/bin-age/age" <<'EOF'
#!/usr/bin/env bash
out=''
while [ $# -gt 0 ]; do
  case $1 in --output) out=$2; shift 2 ;; *) shift ;; esac
done
[ "$out" = /dev/null ] && exit 0
echo 'not age output' >"$out"
EOF
# A partner saving a client while the dump runs: one more users row appears
# after the snapshot was exported. The counts and the dump must both miss it.
mkdir -p "$t/bin-write"
cat >"$t/bin-write/pg_dump" <<EOF
#!/usr/bin/env bash
if [ "\${1:-}" != --version ]; then
  psql -X -q -w -v ON_ERROR_STOP=1 --dbname="$server/pgb_selftest_source" \\
    -c "INSERT INTO users (username, password_hash) VALUES ('selftest-concurrent', 'x')"
fi
exec "$(command -v pg_dump)" "\$@"
EOF
chmod +x "$t/bin-pgdump/pg_dump" "$t/bin-age/age" "$t/bin-write/pg_dump"

# --- harness ---------------------------------------------------------------

passed=0 failed=0 status=0

# run_backup [NAME=value ...]: runs pg-backup.sh with the defaults below,
# overridden by the arguments; sets $status and writes $t/log.
run_backup() {
  rm -rf -- "$t/out" "$t/tmp"
  mkdir -p "$t/out" "$t/tmp"
  set +e
  env BACKUP_DATABASE_URL="$server/pgb_selftest_source" \
      RESTORE_CHECK_URL="$server/pgb_selftest_restore" \
      AGE_RECIPIENT="$recipient" BACKUP_OUT_DIR="$t/out" TMPDIR="$t/tmp" \
      "$@" bash "$here/pg-backup.sh" >"$t/log" 2>&1
  status=$?
  set -e
}

entries() { find "$1" -mindepth 1 -printf '%f '; }
leaks() { grep -q -e 'postgres://' -e 'postgresql://' "$t/log" || grep -qF "$secret" "$t/log"; }
pass() { printf 'ok - %s\n' "$1"; passed=$((passed + 1)); }
fail() {
  printf 'not ok - %s\n' "$1"
  sed 's/^/    | /' "$t/log"
  failed=$((failed + 1))
}

# expect_failure NAME EXPECTED-MESSAGE [NAME=value ...]
expect_failure() {
  local name=$1 message=$2
  shift 2
  run_backup "$@"
  if [ "$status" -eq 0 ]; then fail "$name: exited 0"
  elif ! grep -qF -- "$message" "$t/log"; then fail "$name: no '$message' in the output"
  elif [ -n "$(entries "$t/out")" ]; then fail "$name: left $(entries "$t/out")in the output directory"
  elif [ -n "$(entries "$t/tmp")" ]; then fail "$name: left $(entries "$t/tmp")in TMPDIR"
  elif leaks; then fail "$name: printed a connection string or the private key"
  else pass "$name (exit $status): $(grep -m1 '^pg-backup: error:' "$t/log")"
  fi
}

# --- happy path ------------------------------------------------------------

fresh pgb_selftest_restore
run_backup
sed 's/^/    | /' "$t/log"
shopt -s nullglob
files=("$t"/out/client_portfolio_*.dump.age)
shopt -u nullglob
if [ "$status" -ne 0 ]; then fail "backup: exited $status"
elif [ "${#files[@]}" -ne 1 ] || [ "$(entries "$t/out")" != "$(basename "${files[0]}") " ]; then
  fail "backup: expected exactly one .dump.age, found: $(entries "$t/out")"
elif [ -n "$(entries "$t/tmp")" ]; then fail "backup: left $(entries "$t/tmp")in TMPDIR"
elif leaks; then fail "backup: printed a connection string or the private key"
elif [ "$(head -c 21 "${files[0]}")" != 'age-encryption.org/v1' ]; then fail "backup: output is not age-encrypted"
else
  pass "backup: one encrypted file, $(basename "${files[0]}"), no plaintext left"
  age --decrypt --identity "$t/key.txt" --output "$t/verify.dump" "${files[0]}"
  fresh pgb_selftest_verify
  pg_restore --no-owner --no-privileges --exit-on-error --no-password \
    --dbname="$server/pgb_selftest_verify" "$t/verify.dump"
  rm -f -- "$t/verify.dump"
  got=$(psql_on pgb_selftest_verify -c "SELECT concat_ws(' ',
          (SELECT count(*) FROM users), (SELECT count(*) FROM clients),
          (SELECT count(*) FROM client_revenues))")
  if [ "$got" = "$expected" ]; then
    pass "decrypt and restore: users, clients, client_revenues = $got"
  else
    fail "decrypt and restore: expected $expected, got $got"
  fi
fi

fresh pgb_selftest_restore
run_backup PATH="$t/bin-write:$PATH"
after=$(psql_on pgb_selftest_source -c 'SELECT count(*) FROM users')
if [ "$status" -eq 0 ] && grep -q 'users *2 *2$' "$t/log" && [ "$after" = 3 ]; then
  pass "write during the dump: counts and dump share the snapshot (2 users dumped, 3 now)"
else
  fail "write during the dump: exit $status, $after users now"
fi
psql_on pgb_selftest_source -c "DELETE FROM users WHERE username = 'selftest-concurrent'"

# --- failure paths ---------------------------------------------------------

fresh pgb_selftest_restore
expect_failure 'unreachable database' 'cannot connect to the source database' \
  BACKUP_DATABASE_URL="postgresql://postgres@127.0.0.1:1/pgb_selftest_source"

if [ -n "${SELFTEST_WRONG_PASSWORD_URL:-}" ]; then
  expect_failure 'wrong password' 'cannot connect to the source database' \
    BACKUP_DATABASE_URL="$SELFTEST_WRONG_PASSWORD_URL"
else
  printf 'ok - wrong password # SKIP SELFTEST_WRONG_PASSWORD_URL not set\n'
fi

expect_failure 'missing variable' 'AGE_RECIPIENT is not set' AGE_RECIPIENT=
expect_failure 'invalid age recipient' 'is not a valid age recipient' \
  AGE_RECIPIENT=age1notavalidrecipient
expect_failure 'private key as recipient' 'holds an age PRIVATE key' \
  AGE_RECIPIENT="$secret"
expect_failure 'restore target is the source' 'are the same' \
  RESTORE_CHECK_URL="$server/pgb_selftest_source"
expect_failure 'empty source database' 'table users is missing' \
  BACKUP_DATABASE_URL="$server/pgb_selftest_empty"
expect_failure 'source without users' 'users table is empty' \
  BACKUP_DATABASE_URL="$server/pgb_selftest_nousers"
expect_failure 'pg_dump fails inside the snapshot' 'pg_dump failed' \
  PATH="$t/bin-pgdump:$PATH"

fresh pgb_selftest_restore
psql_on pgb_selftest_restore -c 'CREATE TABLE leftover (id int)' \
  -c 'INSERT INTO leftover VALUES (1)'
expect_failure 'restore target already has rows' 'is not empty'

# An event trigger adds one row to users as pg_restore creates the table:
# the restore succeeds and only the count comparison can catch it.
fresh pgb_selftest_restore
psql_on pgb_selftest_restore -f - <<'SQL'
CREATE FUNCTION selftest_extra_row() RETURNS event_trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_event_trigger_ddl_commands()
              WHERE command_tag = 'CREATE TABLE' AND object_identity = 'public.users') THEN
    INSERT INTO public.users (id, username, password_hash) VALUES (-1, 'extra', 'extra');
  END IF;
END $$;
CREATE EVENT TRIGGER selftest_extra_row ON ddl_command_end
  EXECUTE FUNCTION selftest_extra_row();
SQL
expect_failure 'count mismatch' 'row counts of the restored dump differ'
grep MISMATCH "$t/log" | sed 's/^/    | /'

fresh pgb_selftest_restore
expect_failure 'encrypted output is not age' 'does not start with an age header' \
  PATH="$t/bin-age:$PATH"

printf '%s passed, %s failed\n' "$passed" "$failed"
[ "$failed" -eq 0 ]
