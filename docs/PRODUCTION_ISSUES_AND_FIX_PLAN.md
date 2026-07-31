# 生产环境问题记录与修复计划

## 文档目的

本文记录 SanHub 生产环境中图片生成、批量生成、历史记录与媒体存储相关问题。后续修复按优先级逐项推进，每项完成后补充实际修改、验证结果和遗留风险。

## 当前环境

- 项目仓库：`https://github.com/i6ww/sanhub.git`
- 部署方式：Docker Compose
- 应用容器：`sanhub`
- 数据库容器：`sanhub-mysql`
- 生产项目目录：`/opt/sanhub`
- 数据库：MySQL
- 调查日期：2026-07-31
- Docker 日志时间：UTC

## 用户可见问题

### 问题一：创作页立即生成速度慢

一次生成任务的耗时可能来自以下阶段：

1. 等待队列领取；
2. 调用上游图片渠道；
3. 下载上游图片；
4. 上传到 Lsky 或其他媒体存储；
5. 更新数据库完成状态；
6. 前端轮询并加载最终图片。

当前已确认队列锁超时曾经只有 `90` 秒，长任务可能被重复领取。重复领取会增加上游请求、延长任务时间，并造成状态竞争。

### 问题二：批量生成或创作页偶尔显示结果异常

部分任务在前端显示异常，但稍后历史记录中可以正常看到图片。

当前判断可能由多因素叠加：

- 后端任务已经完成，但前端轮询期间遇到瞬时接口错误；
- 同一任务被过期锁重复执行；
- 媒体上传失败后回退为 Base64；
- 历史与状态接口读取大字段导致耗时增加；
- 前端在非终态错误下提前显示失败。

该问题需要在队列和媒体存储修复后再次复现确认，避免只修复表面提示。

## 已确认的生产证据

### 1. Lsky 存储空间不足

应用日志中重复出现：

```text
[ImageBucket] Lsky v2 upload failed: storage space insufficient
```

这会导致媒体保存逻辑可能保留原始 Base64，并写入 `generations.result_url`，造成数据库持续膨胀。

### 2. 队列锁超时曾经过短

历史生产配置曾出现：

```text
generation_queue_enabled: 1
generation_queue_image_concurrency: 800
generation_queue_channel_concurrency: 50
generation_queue_lock_timeout_seconds: 90
generation_queue_max_attempts: 1
```

日志中发现同一任务约 `90` 秒后再次出现 `Running job`，说明锁过期后可能被重复领取。

### 3. 队列配置已调整

当前生产数据库配置：

```text
generation_queue_enabled: 1
generation_queue_image_concurrency: 80
generation_queue_channel_concurrency: 50
generation_queue_lock_timeout_seconds: 900
generation_queue_max_attempts: 1
```

已确认：

- `lock_timeout_seconds` 已从 `90` 调整为 `900`；
- 最近日志样本中未发现同一任务在 `900` 秒内重复 `Running job`；
- 最近样本任务大约在 `48` 到 `80` 秒内完成；
- 上游 `503`、`429` 属于外部渠道问题，不作为本项目根因。

### 4. 数据库中存在历史 Base64 图片

生产数据库查询结果：

```text
generations rows: 38881
result_url total size: 2.04 GB
result_url > 1 MB: 354
result_url > 5 MB: 126
result_url > 10 MB: 87
```

这说明 `generations` 表空间主要被 `result_url` 历史大字段占用，是历史接口和状态接口变慢的重要风险。

### 5. 存在历史孤立任务

孤立任务数量：

```text
orphan generation_jobs: 2894
failed: 1729
succeeded: 1165
```

这些孤立任务全部是终态，未发现 `queued` 或 `running` 的孤立任务，因此不造成当前队列积压。它们属于历史清理残留，后续可在备份后处理。

## 问题清单与处理顺序

| ID | 问题 | 优先级 | 当前状态 |
| --- | --- | --- | --- |
| P0-1 | Lsky 存储空间不足 | P0 | 已扩容并验证通过 |
| P0-2 | 媒体上传失败后回退为 Base64 | P0 | 已修改，待生产验证 |
| P0-3 | 过期队列任务可能被重复领取 | P0 | 代码已加固，待生产验证 |
| P1-1 | 前端轮询期间显示异常 | P1 | 已修复，待生产验证 |
| P1-2 | `generations` 表存在约 `2.04 GB` Base64 | P1 | 已确认，待迁移 |
| P1-3 | 本地媒体文件缺少后台清理入口 | P1 | 已新增后台清理能力 |
| P1-4 | 任务状态更新缺少执行者保护 | P1 | 待检查并修改 |
| P2-1 | `2894` 条终态孤立任务 | P2 | 已确认，待备份后清理 |
| P2-2 | 生成阶段缺少耗时日志 | P2 | 待补充 |
| P2-3 | `generations` 表空间回收 | P2 | 待数据迁移后处理 |

## 第一阶段：先止损

目标是阻止问题继续扩大，不直接删除历史数据。

- [x] 确认 Lsky 存储已扩容或恢复可用；
- [x] 用测试图片验证上传成功；
- [x] 保持 `lock_timeout_seconds=900`；
- [x] 观察新任务是否继续产生大字段 `result_url`；
- [x] 修改媒体保存逻辑，避免新 Base64 写入 `generations.result_url`；
- [x] 为后台网站配置页新增本地媒体孤儿文件清理入口；
- [ ] 暂不删除历史 Base64 图片；
- [ ] 暂不清理孤立任务。

### 本阶段代码修改

- `lib/media-storage.ts`
  - Base64 保存失败时不再静默返回原始 Base64；
  - 远程图床上传失败后回退到本地持久化文件；
  - 新增本地媒体文件统计与孤儿文件清理函数。
- `lib/db.ts`
  - 新增读取仍被 `generations.result_url = file:*` 引用的本地媒体文件名集合。
- `app/api/admin/media/cleanup/route.ts`
  - 新增管理员接口；
  - `GET` 只统计；
  - `POST` 删除未被历史记录引用的本地媒体文件。
- `app/admin/site/page.tsx`
  - 网站配置页新增 `Local Media Cleanup` 卡片；
  - 展示本地文件数、历史引用数、孤儿文件数、可释放空间；
  - 删除前需要浏览器确认。

### 验证命令

记录基线：

```bash
cd /opt/sanhub

docker compose exec mysql sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE" -e "
SELECT
  COUNT(*) AS generation_count,
  ROUND(SUM(OCTET_LENGTH(result_url)) / 1024 / 1024 / 1024, 2) AS result_url_gb,
  SUM(OCTET_LENGTH(result_url) > 1048576) AS over_1mb,
  SUM(OCTET_LENGTH(result_url) > 5242880) AS over_5mb,
  SUM(OCTET_LENGTH(result_url) > 10485760) AS over_10mb
FROM generations;

SELECT
  generation_queue_enabled AS enabled,
  generation_queue_image_concurrency AS image_concurrency,
  generation_queue_channel_concurrency AS channel_concurrency,
  generation_queue_lock_timeout_seconds AS lock_timeout_seconds,
  generation_queue_max_attempts AS max_attempts
FROM system_config
WHERE id = 1;
"'
```

观察最近生成任务：

```bash
docker compose logs \
  --no-color \
  --timestamps \
  --since 20m \
  sanhub | grep -Ei "ImageBucket|MediaStorage|GenerationQueue|upload failed|storage|Completed job|Job .* failed"
```

检查最近 `20` 分钟完成的图片是否还写入大 Base64：

```bash
docker compose exec mysql sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE" -e "
SELECT
  id,
  status,
  type,
  LEFT(result_url, 32) AS result_prefix,
  ROUND(OCTET_LENGTH(result_url) / 1024 / 1024, 2) AS result_mb,
  created_at,
  updated_at
FROM generations
WHERE created_at >= (UNIX_TIMESTAMP() * 1000 - 20 * 60 * 1000)
ORDER BY created_at DESC
LIMIT 30;
"'
```

第一阶段通过标准：

- 最近新任务日志不再出现 `Lsky v2 upload failed`；
- 新完成任务的 `result_prefix` 是 `http`、`https` 或 `file:`；
- 新完成任务的 `result_mb` 不应持续大于 `1 MB`；
- `lock_timeout_seconds` 保持为 `900`；
- 后台 `Local Media Cleanup` 能正常展示统计；
- 清理按钮只删除未被 `file:` 历史记录引用的本地文件。

## 第二阶段：队列一致性加固

涉及文件：

- `lib/generation-queue.ts`
- `lib/db.ts`

目标：

- 过期任务重新领取时检查 `attempts` 与 `max_attempts`；
- 防止达到最大尝试次数的任务继续被领取；
- 完成、失败和退款操作校验当前 worker 的任务所有权；
- 避免旧 worker 覆盖新 worker 的状态；
- 对长任务增加锁续期或更明确的超时恢复逻辑。

### 本阶段代码修改

- `claimGenerationJobs()` 领取任务时增加 `attempts < max_attempts` 条件；
- `completeGenerationJob()` 和 `failGenerationJob()` 在 MySQL 下使用单条 `UPDATE ... JOIN` 同时更新 `generations` 与 `generation_jobs`；
- `completeGenerationJob()`、`failGenerationJob()`、`releaseGenerationJob()` 都校验 `locked_by`，旧 worker 无法写回；
- 队列 worker 执行任务时周期性续期 `locked_until`；
- 生成过程中的中间状态写回会校验当前 job 锁仍属于本 worker；
- 到达最大尝试次数且锁已过期的 `running` job 会被扫描为失败，并触发 generation 失败与退款处理；
- 成功完成时清空旧的 `error_message`，避免重试成功后历史记录仍展示旧错误。

### 第二阶段验证命令

部署后先观察最近队列日志：

```bash
cd /opt/sanhub

docker compose logs \
  --no-color \
  --timestamps \
  --since 30m \
  sanhub | grep -Ei "GenerationQueue|Running job|Completed job|Lost lock|expired|max attempts|failed"
```

检查是否仍有 `attempts` 超过 `max_attempts` 的非终态任务：

```bash
docker compose exec mysql sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE" -e "
SELECT
  status,
  COUNT(*) AS jobs
FROM generation_jobs
WHERE attempts > max_attempts
GROUP BY status;

SELECT
  status,
  attempts,
  max_attempts,
  COUNT(*) AS jobs
FROM generation_jobs
WHERE status IN (\"queued\", \"running\")
GROUP BY status, attempts, max_attempts
ORDER BY status, attempts DESC, max_attempts DESC;
"'
```

检查最近任务是否存在同一 job 被重复领取：

```bash
docker compose logs \
  --no-color \
  --timestamps \
  --since 60m \
  sanhub | sed -n "s/.*Running job \([^ ]*\).*/\1/p" | sort | uniq -c | sort -nr | head
```

正常情况下，同一 `jobId` 在锁未过期且 worker 正常续期时不应重复出现。

验收标准：

- 同一 `job` 不会在有效锁期内出现两次 `Running job`；
- 同一 `generation` 不会出现互相覆盖的完成和失败状态；
- `attempts` 不会超过设计上限；
- 重启或 worker 异常后，任务能进入明确的失败或恢复状态。

## 第三阶段：前端状态显示修复

涉及文件：

- `lib/generation-client.ts`
- `components/generator/image-generation-page.tsx`
- `components/generator/batch-image-generation-page.tsx`
- `app/api/generate/status/[id]/route.ts`

目标：

- 瞬时网络错误、状态接口 `5xx` 和非 JSON 响应继续轮询；
- 只有服务端明确返回终态失败时才显示失败；
- 完成状态返回后确认媒体 URL 可访问；
- 批量任务和普通创作任务使用一致的状态判定。

### 本阶段代码修改

- `lib/generation-client.ts`
  - 完成判定必须同时满足终态成功和 `url` 存在；
  - 状态接口返回成功后，会先检查 `/api/media/:id` 是否可访问；
  - 媒体暂时不可访问时继续轮询，不立即展示异常结果；
  - `404`、`408`、`409`、`425`、`429`、`5xx`、非 JSON 响应和媒体未就绪都按瞬时状态处理。
- `components/generator/image-generation-page.tsx`
  - 非终态轮询失败时，任务保持 `pending` 或 `processing`；
  - 轮询超时不再把任务标记为失败，而是提示稍后查看历史记录并触发重新同步。
  - 对 `allowEmptyPrompt=false` 的模型，要求用户必须输入提示词，即使已经上传参考图。
- `components/generator/batch-image-generation-page.tsx`
  - 批量任务与普通创作任务使用相同的轮询语义；
  - 只有服务端明确返回 `failed` 或 `cancelled` 时才标记为失败；
  - 查询异常或轮询超时时保持等待状态。
  - 对不允许空提示词的模型，批量任务也必须填写提示词。
- `app/api/generate/image/route.ts`
  - 后端提交入口同步校验 `allowEmptyPrompt=false` 的模型必须提供提示词；
  - “仅参考图但模型要求提示词”的请求在扣费和入队前返回 `400`。
- `lib/polling-utils.ts`
  - 补充状态轮询场景下的瞬时错误识别。
  - `400` 不再作为瞬时轮询错误处理，避免把永久参数错误当成可恢复状态。

### 第三阶段验证命令

部署后观察状态接口、媒体接口和队列日志：

```bash
cd /opt/sanhub

docker compose logs \
  --no-color \
  --timestamps \
  --since 30m \
  sanhub | grep -Ei "Get generation status|Media API|GenerationQueue|Completed job|Job .* failed|MediaStorage"
```

检查最近完成任务是否能通过媒体接口访问：

```bash
GENERATION_ID="<replace-with-generation-id>"
curl -I "https://<your-domain>/api/media/${GENERATION_ID}"
```

检查最近任务状态是否和历史记录一致：

```bash
docker compose exec mysql sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE" -e "
SELECT
  id,
  status,
  LEFT(result_url, 32) AS result_prefix,
  error_message,
  created_at,
  updated_at
FROM generations
ORDER BY created_at DESC
LIMIT 20;
"'
```

验收标准：

- 状态接口偶发 `5xx`、非 JSON 或媒体 `404/204` 时，前端不直接显示失败；
- 历史记录稍后出现成功图片时，创作页和批量页能同步为完成；
- 只有数据库中 `generations.status` 已明确为 `failed` 或 `cancelled` 时，前端才显示失败；
- completed 任务展示前，`/api/media/:id` 能返回可访问响应。

## 第四阶段：历史数据迁移

涉及数据：

- `generations.result_url`
- 大于 `1 MB` 的历史 Base64 图片

处理顺序：

1. 创建 MySQL 备份；
2. 确认新的媒体存储可用；
3. 将 Base64 图片迁移到新存储；
4. 更新 `result_url`；
5. 校验图片访问；
6. 备份后清理终态孤立任务；
7. 最后在维护窗口执行表空间回收。

禁止直接执行以下操作：

```sql
DELETE FROM generations;
UPDATE generations SET result_url = '';
DROP TABLE generations;
```

除非已经完成备份、迁移和逐条访问验证。

## 第五阶段：补充可观测性

需要新增或完善以下日志字段：

- `generationId`
- `jobId`
- `channelId`
- `modelId`
- `queueWaitMs`
- `upstreamDurationMs`
- `mediaDownloadDurationMs`
- `mediaUploadDurationMs`
- `databaseUpdateDurationMs`
- `totalDurationMs`

目标是能直接判断一次慢请求发生在队列、上游、媒体存储还是数据库。

## 当前不处理的问题

以下错误来自外部上游渠道，不作为本项目本轮根因：

- 上游 `503`
- 上游 `429`
- 上游服务不可用
- 上游渠道自身限流或容量不足

项目仍需正确记录这些错误、保持任务状态一致并避免重复扣费，但不通过修改本项目来解决上游容量问题。
