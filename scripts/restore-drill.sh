#!/usr/bin/env bash
# End-to-end backup & erasure-survival drill on a DISPOSABLE, seeded database:
#   1. encrypted backup  2. erase a demo user AFTER the backup  3. export the deletion ledger  4. restore the OLD backup to a scratch DB
#   5. re-apply erasures  6. assert the erased user is anonymised in the restored database.
# Env: DATABASE_URL (seeded), ADMIN_DATABASE_URL (can create/drop databases). Exits non-zero on any failure.
set -euo pipefail
: "${DATABASE_URL:?}"; : "${ADMIN_DATABASE_URL:?}"
W="$(mktemp -d)"; trap 'rm -rf "$W"' EXIT; export BACKUP_DIR="$W/backups" BACKUP_PASSPHRASE="drill-$(date +%s)" LEDGER_FILE="$W/deletions.jsonl"
echo "== 1. encrypted backup =="; ./scripts/backup.sh
echo "== 2. erase a user after the backup =="; UID_ERASED="$(npx tsx scripts/drill-erase.ts | tail -1)"; echo "erased $UID_ERASED"
echo "== 3. export the deletion ledger (this file lives outside the backups) =="; npm run -s deletions:export
grep -q "$UID_ERASED" "$LEDGER_FILE" || { echo "FAIL: erasure missing from ledger export"; exit 1; }
echo "== 4-5. restore the OLD backup to a scratch DB and re-apply erasures =="
SCRATCH="eazyflex_drill_$$"; KEEP_SCRATCH=1 SOURCE_DATABASE_URL="$DATABASE_URL" ./scripts/restore-test.sh "$BACKUP_DIR"/eazyflex-*.dump.enc "$SCRATCH"
echo "== 6. assert the erasure survived the restore =="
BASE="${ADMIN_DATABASE_URL%/*}"; STATUS="$(psql "$BASE/$SCRATCH" -Atc "select status || '|' || full_name || '|' || email from users where id='$UID_ERASED'")"
psql "$ADMIN_DATABASE_URL" -qc "drop database if exists \"$SCRATCH\"" >/dev/null
[ "$STATUS" = "deleted|Deleted|deleted+$UID_ERASED@deleted.invalid" ] || { echo "FAIL: erased user is not anonymised after restore: $STATUS"; exit 1; }
echo "DRILL OK: backup restored, and the post-backup erasure was re-applied ($STATUS)"
