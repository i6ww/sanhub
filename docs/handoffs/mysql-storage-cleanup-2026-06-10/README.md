# SanHub MySQL Storage Cleanup Handoff

## Context

Date: 2026-06-10

Project path on production server:

```bash
/opt/sanhub
```

Docker Compose file:

```bash
/opt/sanhub/docker-compose.yml
```

MySQL container:

```bash
sanhub-mysql
```

MySQL Docker volume:

```bash
sanhub_sanhub_mysql
```

The initial report was that the production MySQL database occupied too much disk space.

## Findings

The issue had two separate causes.

### 1. Binary logs were the main disk consumer

Filesystem-level inspection showed:

```text
/var/lib/mysql: 56G
/var/lib/mysql/sanhub: 2.8G
```

Large files under `/var/lib/mysql` were mostly `binlog.*` files:

```text
binlog.000001 ... binlog.000053
each around 1.1G
total around 53G
```

MySQL confirmed binary logging was enabled:

```sql
SHOW VARIABLES LIKE 'log_bin';
```

Result:

```text
log_bin = ON
```

The retention period was the default 30 days:

```sql
SHOW VARIABLES LIKE 'binlog_expire_logs_seconds';
```

Initial result:

```text
binlog_expire_logs_seconds = 2592000
```

The active binary log was:

```sql
SHOW BINARY LOG STATUS;
```

Result:

```text
File = binlog.000053
Position = 1039959056
```

### 2. `generation_jobs.payload` was the main business-table consumer

MySQL table-size query showed:

```text
generation_jobs: 2283.55 MB data, 2.78 MB index
generations: 68.22 MB data, 0.89 MB index
```

Payload-size query:

```sql
SELECT
  COUNT(*) AS jobs,
  ROUND(SUM(OCTET_LENGTH(payload)) / 1024 / 1024, 2) AS payload_mb
FROM generation_jobs;
```

Result:

```text
jobs = 4393
payload_mb = 2231.77
```

Orphan-job query:

```sql
SELECT
  COUNT(*) AS orphan_jobs
FROM generation_jobs j
LEFT JOIN generations g ON g.id = j.generation_id
WHERE g.id IS NULL;
```

Result:

```text
orphan_jobs = 777
```

Interpretation:

- `generation_jobs.payload` stored full image generation requests.
- Requests with reference images could include base64 payloads.
- Completed or failed jobs kept the full payload.
- Deleting generation history deleted rows from `generations`, but previously did not delete matching `generation_jobs`, leaving orphan rows.

## Production Actions Already Performed

### Binary logs purged

In MySQL:

```sql
PURGE BINARY LOGS TO 'binlog.000053';
```

Result:

```text
Query OK
```

After purge:

```sql
SHOW BINARY LOGS;
```

Result:

```text
binlog.000053 only
```

### Binary log retention reduced

In MySQL:

```sql
SET PERSIST binlog_expire_logs_seconds = 86400;
```

Result:

```text
binlog_expire_logs_seconds = 86400
```

This keeps binary logs for 1 day instead of 30 days.

### Disk usage after purge

After purging old binary logs:

```text
/var/lib/mysql: 4.0G
/var/lib/mysql/sanhub: 2.8G
binlog.000053: about 1002M
```

The immediate disk issue was resolved:

```text
56G -> 4.0G
```

## Code Changes Made Locally

File:

```text
lib/db.ts
```

Changes:

1. Clear `generation_jobs.payload` when a job reaches a terminal state.

Affected functions:

```text
completeGenerationJob
failGenerationJob
```

New behavior:

```sql
payload = '{}'
```

is written when a job becomes:

```text
succeeded
failed
```

2. Delete matching `generation_jobs` rows when generation history is deleted.

Affected functions:

```text
deleteGeneration
deleteGenerations
deleteAllUserGenerations
deleteAllFailedGenerations
```

Purpose:

- Prevent orphan `generation_jobs`.
- Make user/admin history deletion actually reclaim job payload data logically.

Validation run locally:

```bash
npm run lint
```

Result:

```text
No ESLint warnings or errors
```

Current local git diff summary:

```text
lib/db.ts | 34 ++++++++++++++++++++++++++++++++--
```

## Recommended Next Steps

### 1. Deploy the code fix

Deploy the updated `lib/db.ts` so future completed or failed jobs do not keep large request payloads.

### 2. Check current payload size again

Run on production:

```bash
cd /opt/sanhub
docker compose exec mysql sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE" -e "SELECT COUNT(*) AS jobs, ROUND(SUM(OCTET_LENGTH(payload)) / 1024 / 1024, 2) AS payload_mb FROM generation_jobs; SELECT COUNT(*) AS orphan_jobs FROM generation_jobs j LEFT JOIN generations g ON g.id = j.generation_id WHERE g.id IS NULL;"'
```

Expected after cleanup:

```text
payload_mb should be small
orphan_jobs should be 0
```

### 3. If payload is still large, clean existing rows

Only after confirming a recent backup exists, run in MySQL:

```sql
UPDATE generation_jobs
SET payload = '{}'
WHERE status IN ('succeeded', 'failed', 'cancelled');

DELETE j
FROM generation_jobs j
LEFT JOIN generations g ON g.id = j.generation_id
WHERE g.id IS NULL;
```

Backup command used earlier:

```bash
cd /opt/sanhub
sh scripts/backup-mysql.sh backups/sanhub-before-generation-jobs-cleanup.sql
```

### 4. If `generation_jobs.ibd` remains large, rebuild the table at low traffic

If logical payload size is small but the file remains large:

```bash
docker exec sanhub-mysql sh -c 'ls -lhS /var/lib/mysql/"$MYSQL_DATABASE" | head -20'
```

If `generation_jobs.ibd` is still around 2.7G, run during a low-traffic window:

```sql
OPTIMIZE TABLE generation_jobs;
```

Notes:

- This rebuilds the table.
- It may lock or heavily load the table.
- It may generate binary logs.
- Binary logs now expire after 1 day, so they should not accumulate long term.

### 5. Consider disabling binary logs if not needed

If this MySQL instance has no replication and no point-in-time recovery requirement, binary logging can be disabled to avoid this class of disk growth.

In `docker-compose.yml`, under the MySQL `command` list:

```yaml
      - --skip-log-bin
```

Tradeoff:

- Pros: avoids binlog disk growth.
- Cons: loses binary-log-based point-in-time recovery and replication support.

## Useful Diagnostic Commands

Filesystem-level size:

```bash
sudo du -h --max-depth=2 /var/lib/docker/volumes/sanhub_sanhub_mysql/_data | sort -hr | head -30
docker exec sanhub-mysql sh -c 'du -h --max-depth=2 /var/lib/mysql 2>/dev/null | sort -hr | head -40'
```

Largest table files:

```bash
docker exec sanhub-mysql sh -c 'ls -lhS /var/lib/mysql/"$MYSQL_DATABASE" | head -40'
```

Largest MySQL data-directory files:

```bash
docker exec sanhub-mysql sh -c 'ls -lhS /var/lib/mysql | head -40'
```

Table sizes:

```sql
SELECT
  table_name,
  table_rows,
  ROUND(data_length / 1024 / 1024, 2) AS data_mb,
  ROUND(index_length / 1024 / 1024, 2) AS index_mb
FROM information_schema.tables
WHERE table_schema = DATABASE()
ORDER BY data_length + index_length DESC;
```

Payload size:

```sql
SELECT
  COUNT(*) AS jobs,
  ROUND(SUM(OCTET_LENGTH(payload)) / 1024 / 1024, 2) AS payload_mb
FROM generation_jobs;
```

Orphan jobs:

```sql
SELECT
  COUNT(*) AS orphan_jobs
FROM generation_jobs j
LEFT JOIN generations g ON g.id = j.generation_id
WHERE g.id IS NULL;
```

Binary log status:

```sql
SHOW BINARY LOG STATUS;
SHOW BINARY LOGS;
SHOW VARIABLES LIKE 'log_bin';
SHOW VARIABLES LIKE 'binlog_expire_logs_seconds';
```

## Risk Notes

- Do not manually delete `binlog.*` files from the filesystem.
- Use `PURGE BINARY LOGS` from MySQL.
- Do not run `OPTIMIZE TABLE generation_jobs` during peak traffic.
- Do not disable binary logs if replication or point-in-time recovery depends on them.
- Large updates can themselves generate large binary logs.

