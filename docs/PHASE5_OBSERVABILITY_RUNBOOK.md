# 第五阶段：生成链路可观测性手册

## 目标

第五阶段用于判断一次图片生成慢在哪里：队列等待、上游渠道、媒体保存，还是数据库写回。

应用现在会在每次图片任务完成或失败时输出一条单行日志：

```text
[GenerationMetrics] {"event":"completed","generationId":"...","jobId":"...","channelId":"...","modelId":"...","queueWaitMs":0,"upstreamDurationMs":0,"mediaDownloadDurationMs":0,"mediaUploadDurationMs":0,"mediaStorageDurationMs":0,"databaseUpdateDurationMs":0,"totalDurationMs":0}
```

## 字段说明

- `event`：`completed` 或 `failed`。
- `generationId`：生成记录 ID。
- `jobId`：队列任务 ID。直接生成模式可能为空。
- `workerId`：执行任务的 worker。
- `channelId`：图片渠道 ID。
- `modelId`：图片模型 ID。
- `attempt`：当前尝试次数。
- `maxAttempts`：最大尝试次数。
- `queueWaitMs`：从任务创建到 worker 开始执行的等待时间。
- `upstreamDurationMs`：调用上游生成接口耗时。
- `mediaDownloadDurationMs`：下载上游返回媒体的耗时。上游直接返回 Base64 时通常为 `0`。
- `mediaUploadDurationMs`：上传到图床或写入本地文件的耗时。
- `mediaStorageDurationMs`：完整媒体保存耗时，包含图床配置读取、下载、上传和本地兜底。
- `databaseUpdateDurationMs`：本次执行过程中数据库状态写回总耗时。
- `totalDurationMs`：worker 执行总耗时。
- `mediaInputKind`：上游结果类型，例如 `remote-url` 或 `data-url`。
- `mediaOutputKind`：最终保存类型，例如 `remote-bucket`、`local-file` 或 `remote-url`。
- `errorMessage`：失败时的错误摘要。

## 查看最近日志

```bash
cd /opt/sanhub

docker compose logs \
  --no-color \
  --timestamps \
  --since 60m \
  sanhub | grep "GenerationMetrics"
```

## 提取慢任务

按总耗时排序：

```bash
docker compose logs --no-color --since 60m sanhub \
  | grep "GenerationMetrics" \
  | sed 's/^.*GenerationMetrics] //' \
  | jq -r '[.totalDurationMs, .queueWaitMs, .upstreamDurationMs, .mediaStorageDurationMs, .databaseUpdateDurationMs, .generationId, .jobId, .channelId, .modelId, .event] | @tsv' \
  | sort -nr \
  | head -20
```

按队列等待排序：

```bash
docker compose logs --no-color --since 60m sanhub \
  | grep "GenerationMetrics" \
  | sed 's/^.*GenerationMetrics] //' \
  | jq -r '[.queueWaitMs, .totalDurationMs, .generationId, .jobId, .channelId, .modelId, .event] | @tsv' \
  | sort -nr \
  | head -20
```

按上游耗时排序：

```bash
docker compose logs --no-color --since 60m sanhub \
  | grep "GenerationMetrics" \
  | sed 's/^.*GenerationMetrics] //' \
  | jq -r '[.upstreamDurationMs, .totalDurationMs, .generationId, .jobId, .channelId, .modelId, .event] | @tsv' \
  | sort -nr \
  | head -20
```

按媒体保存耗时排序：

```bash
docker compose logs --no-color --since 60m sanhub \
  | grep "GenerationMetrics" \
  | sed 's/^.*GenerationMetrics] //' \
  | jq -r '[.mediaStorageDurationMs, .mediaDownloadDurationMs, .mediaUploadDurationMs, .totalDurationMs, .generationId, .jobId, .mediaInputKind, .mediaOutputKind, .event] | @tsv' \
  | sort -nr \
  | head -20
```

## 判断标准

- `queueWaitMs` 高：队列容量、渠道并发、上游慢导致 worker 长时间占用。
- `upstreamDurationMs` 高：主要是上游渠道耗时。
- `mediaDownloadDurationMs` 高：上游返回远程 URL，但下载慢。
- `mediaUploadDurationMs` 高：图床上传慢或本地卷写入慢。
- `databaseUpdateDurationMs` 高：MySQL 写入慢、连接池拥塞或表压力较大。
- `totalDurationMs` 高但单项不高：优先检查日志中是否有重试、锁续期、上传兜底等组合问题。

## 部署后验收

1. 提交一个普通图片生成任务。
2. 确认日志中出现 `GenerationMetrics`。
3. 确认成功日志有 `completed`，失败日志有 `failed`。
4. 对慢任务按上述命令排序，能定位主要耗时阶段。
