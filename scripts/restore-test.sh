#!/usr/bin/env bash
# Restore drill: restores a backup into a SCRATCH database and verifies it. Run this regularly (monthly) — an untested backup is a hope, not a backup.
# Usage: scripts/restore-test.sh <backup-file> [scratch-db-name]
# Env: ADMIN_DATABASE_URL (a connection that can CREATE/DROP DATABASE, e.g. .../postgres), BACKUP_PASSPHRASE (if encrypted), LEDGER_FILE (optional: re-apply erasures)
#      SOURCE_DATABASE_URL (optional: compare row counts against the live database)
set -euo pipefail
FILE="${1:?usage: restore-test.sh <backup-file> [scratch-db]}"; SCRATCH="${2:-eazyflex_restore_check}"
: "${ADMIN_DATABASE_URL:?ADMIN_DATABASE_URL required (a role that can create databases)}"
case "$SCRATCH" in *prod*|*production*) echo "refusing: scratch db name looks like production"; exit 2;; esac
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"; [ -n "${KEEP_SCRATCH:-}" ] || psql "$ADMIN_DATABASE_URL" -qc "drop database if exists \"$SCRATCH\"" >/dev/null 2>&1 || true' EXIT   # KEEP_SCRATCH=1 leaves the restored DB for inspection
SRC="$FILE"
if [[ "$FILE" == *.enc ]]; then : "${BACKUP_PASSPHRASE:?BACKUP_PASSPHRASE required for an encrypted backup}"; openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -in "$FILE" -out "$WORK/db.dump" -pass env:BACKUP_PASSPHRASE; SRC="$WORK/db.dump"; fi
pg_restore --list "$SRC" >/dev/null   # the archive is readable
psql "$ADMIN_DATABASE_URL" -qc "drop database if exists \"$SCRATCH\"" -c "create database \"$SCRATCH\""
BASE="${ADMIN_DATABASE_URL%/*}"; SCRATCH_URL="$BASE/$SCRATCH"
pg_restore --no-owner --no-privileges --dbname="$SCRATCH_URL" "$SRC"
q() { psql "$SCRATCH_URL" -Atc "$1"; }
MIG=$(q "select count(*) from drizzle.__drizzle_migrations"); USERS=$(q "select count(*) from users"); TABLES=$(q "select count(*) from information_schema.tables where table_schema='public'")
AUDIT=$(q "select count(*) from audit_logs"); echo "restored: $TABLES tables, $MIG migrations, $USERS users, $AUDIT audit rows"
[ "$MIG" -ge 1 ] && [ "$TABLES" -ge 20 ] || { echo "FAIL: restored database looks empty or incomplete"; exit 1; }
q "select 1 from pg_trigger where tgname='audit_logs_no_update'" | grep -q 1 || { echo "FAIL: audit-log immutability trigger missing after restore"; exit 1; }
if [ -n "${SOURCE_DATABASE_URL:-}" ]; then
  for t in users opportunities applications assignments messages audit_logs; do a=$(psql "$SOURCE_DATABASE_URL" -Atc "select count(*) from $t"); b=$(q "select count(*) from $t"); echo "  $t: source=$a restored=$b"; [ "$b" -le "$a" ] || { echo "FAIL: restored $t has MORE rows than source"; exit 1; }; done
fi
if [ -n "${LEDGER_FILE:-}" ]; then DATABASE_URL="$SCRATCH_URL" LEDGER_FILE="$LEDGER_FILE" npx tsx scripts/reapply-deletions.ts; fi
echo "RESTORE DRILL OK"
