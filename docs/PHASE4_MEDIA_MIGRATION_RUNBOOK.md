# Phase 4 Runbook: Historical Media Migration

This document covers the migration of historical `generations.result_url` values that still store large Base64 payloads.

## Goal

- Reduce MySQL row size and history query pressure.
- Preserve every record.
- Make the migration resumable and low-risk.

## Script

Use the built-in migration script:

```bash
npm run migrate:generation-media -- --dry-run
```

Or, inside the production container:

```bash
node scripts/migrate-generation-result-media.mjs --dry-run
```

## Recommended Flow

1. Back up MySQL first.
2. Run a dry run with a small limit.
3. Verify several migrated rows through `/api/media/:id`.
4. Run the execute mode in batches.
5. Re-run until no Base64 rows remain above the threshold.
6. After a quiet period, consider `OPTIMIZE TABLE generations`.

## Safe Defaults

Recommended production command:

```bash
node scripts/migrate-generation-result-media.mjs \
  --execute \
  --limit 20 \
  --batch-size 5 \
  --min-bytes 1048576 \
  --sleep-ms 500 \
  --max-failures 5
```

If you want to avoid remote uploads during the first pass, add:

```bash
--local-only
```

## Validation

Check remaining Base64 rows:

```sql
SELECT
  COUNT(*) AS base64_rows,
  ROUND(SUM(OCTET_LENGTH(result_url)) / 1024 / 1024 / 1024, 2) AS result_url_gb
FROM generations
WHERE result_url LIKE 'data:%;base64,%';
```

Check recent results:

```sql
SELECT
  id,
  LEFT(result_url, 32) AS result_prefix,
  ROUND(OCTET_LENGTH(result_url) / 1024 / 1024, 2) AS result_mb,
  created_at,
  updated_at
FROM generations
WHERE result_url LIKE 'data:%;base64,%'
ORDER BY created_at DESC
LIMIT 20;
```

Check media access:

```bash
curl -I "https://<your-domain>/api/media/<generation-id>"
```

## Stop Conditions

- Stop if the script reports repeated upload failures.
- Stop if media URLs are not accessible after migration.
- Stop if MySQL load becomes too high.

## Rollback

- Do not delete the original database backup until the migration is fully verified.
- If a migrated row points to a bad URL, restore that row from the backup and re-run the script for that ID.
- Do not run destructive SQL against `generations` without a backup.
