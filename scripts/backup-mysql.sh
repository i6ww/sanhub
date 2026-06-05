#!/bin/sh
set -eu

BACKUP_DIR="${BACKUP_DIR:-backups}"
mkdir -p "$BACKUP_DIR"

TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
OUTPUT_FILE="${1:-$BACKUP_DIR/sanhub-$TIMESTAMP.sql}"

echo "[SanHub] Creating MySQL backup: $OUTPUT_FILE"
docker compose exec -T mysql sh -c 'mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" --single-transaction --routines --triggers "$MYSQL_DATABASE"' > "$OUTPUT_FILE"
echo "[SanHub] Backup completed: $OUTPUT_FILE"
