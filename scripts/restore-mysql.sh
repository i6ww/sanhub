#!/bin/sh
set -eu

if [ $# -lt 1 ]; then
  echo "Usage: sh scripts/restore-mysql.sh <backup.sql>"
  exit 1
fi

BACKUP_FILE="$1"

if [ ! -f "$BACKUP_FILE" ]; then
  echo "[SanHub] ERROR: backup file not found: $BACKUP_FILE"
  exit 1
fi

if [ "${CONFIRM_RESTORE:-}" != "yes" ]; then
  echo "[SanHub] ERROR: restore is destructive."
  echo "[SanHub] Run again with CONFIRM_RESTORE=yes after confirming the target database."
  exit 1
fi

echo "[SanHub] Restoring MySQL backup: $BACKUP_FILE"
docker compose exec -T mysql sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE"' < "$BACKUP_FILE"
echo "[SanHub] Restore completed."
