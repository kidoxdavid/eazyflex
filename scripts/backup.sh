#!/usr/bin/env bash
# Logical backup of the database: pg_dump (custom format) -> optional AES-256 encryption -> checksum manifest -> prune old backups.
# Env: DATABASE_URL (required), BACKUP_DIR (default ./backups), BACKUP_PASSPHRASE (strongly recommended), BACKUP_RETENTION_DAYS (default 35).
# Ship BACKUP_DIR off-host (object storage with versioning + a separate account/credentials). A backup that lives only next to the database is not a backup.
set -euo pipefail
: "${DATABASE_URL:?DATABASE_URL is required}"
DIR="${BACKUP_DIR:-./backups}"; DAYS="${BACKUP_RETENTION_DAYS:-35}"; mkdir -p "$DIR"; chmod 700 "$DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"; OUT="$DIR/openhour-$STAMP.dump"
pg_dump --format=custom --no-owner --no-privileges --dbname="$DATABASE_URL" --file="$OUT"
if [ -n "${BACKUP_PASSPHRASE:-}" ]; then
  openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -in "$OUT" -out "$OUT.enc" -pass env:BACKUP_PASSPHRASE && shred -u "$OUT" 2>/dev/null || rm -f "$OUT"; OUT="$OUT.enc"
else echo "WARNING: BACKUP_PASSPHRASE not set — backup is NOT encrypted" >&2; fi
chmod 600 "$OUT"; ( cd "$DIR" && sha256sum "$(basename "$OUT")" >> SHA256SUMS )
find "$DIR" -maxdepth 1 -name 'openhour-*.dump*' -mtime +"$DAYS" -print -delete | sed 's/^/pruned (retention): /'
echo "backup written: $OUT ($(du -h "$OUT" | cut -f1))"
