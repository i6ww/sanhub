# 生产问题排障与修复总结

## 背景

本文记录 2026-08-01 对 SanHub 生产环境进行的一轮问题排查、代码修复、部署验证与后续处理建议。

生产环境关键信息：

- 仓库：`https://github.com/i6ww/sanhub.git`
- 生产目录：`/opt/sanhub`
- 应用容器：`sanhub`
- 数据库容器：`sanhub-mysql`
- 数据库：MySQL 8.4
- 媒体数据卷：`sanhub_sanhub_data`
- 数据库数据卷：`sanhub_sanhub_mysql`

本轮部署前已完成备份：

- 备份目录：`/opt/sanhub-backups/before-upgrade-20260801-014225`
- 数据库备份：`mysql.sql`
- 媒体卷备份：`sanhub_data.tar.gz`
- 配置备份：`.env`、`docker-compose.yml`、`.dockerignore`

## 当前线上版本

已部署并验证的最新提交：

- `874259a Index generation client request IDs`

重要前置提交：

- `9190e28 Improve prompt error classification`
- `786457e Speed up image generation submission`

## 问题一：创作页点击立即生成时提交很慢

### 用户现象

用户在创作页文生图时，点击“立即生成”后长时间停留在“提交中”。

### 生产证据

部署新版指标后，生产日志出现如下提交耗时指标：

```text
[ImageSubmitMetrics] {"generationId":"3698ace6-d311-4bb3-a3f0-457a637a9f75","modelId":"a469af56-48bd-4c74-8b79-c0c49eae5e5a","queued":true,"inlineImageCount":0,"deferredReferenceImageCount":0,"payloadBytes":444,"totalDurationMs":53194,"getSystemConfigMs":4,"getSessionMs":20,"parseRequestBodyMs":3,"assertPromptsAllowedMs":1,"getImageModelMs":17,"getUserMs":0,"getGenerationByClientRequestIdMs":53121,"prepareReferenceInputsMs":0,"prechargeBalanceMs":5,"saveGenerationMs":6,"createGenerationJobMs":9}
```

关键判断：

- 总提交耗时：`53194ms`
- 幂等查重耗时：`53121ms`
- 扣积分、保存任务、入队均为毫秒级

因此慢点不在上游渠道、不在图床、不在队列执行，而在提交接口里的 `getGenerationByClientRequestId`。

### 根因

旧逻辑把 `clientRequestId` 存在 `generations.params` 中，并用文本模糊匹配查重：

```sql
SELECT *
FROM generations
WHERE user_id = ?
  AND params LIKE ?
ORDER BY created_at DESC
LIMIT 10;
```

`params` 是文本字段，`LIKE` 带前置通配符无法有效使用普通索引。随着 `generations` 表增长，该查询会越来越慢。

### 修复方案

彻底修复方式是把 `clientRequestId` 从 `params` 拆到独立可索引字段：

- 新增 `generations.client_request_id`
- 从历史 `params.clientRequestId` 回填新字段
- 清理同一用户同一 `client_request_id` 的历史重复值
- 创建唯一索引 `idx_user_client_request_id`
- 新任务保存时直接写入 `client_request_id`
- 查重改成索引查询
- 并发重复提交时复用已有任务，并回滚本次预扣积分

涉及文件：

- `lib/db.ts`
- `app/api/generate/image/route.ts`
- `types/index.ts`

### 生产验证

索引已确认存在：

```text
idx_user_client_request_id user_id 0
idx_user_client_request_id client_request_id 0
```

修复后生产指标：

```text
[ImageSubmitMetrics] {"generationId":"09c9f797-21c5-4870-a1f4-e814abdf8b3e","modelId":"a469af56-48bd-4c74-8b79-c0c49eae5e5a","queued":true,"inlineImageCount":0,"deferredReferenceImageCount":0,"payloadBytes":441,"totalDurationMs":49,"getSystemConfigMs":1,"getSessionMs":2,"parseRequestBodyMs":1,"assertPromptsAllowedMs":1,"getImageModelMs":17,"getUserMs":0,"getGenerationByClientRequestIdMs":2,"prepareReferenceInputsMs":0,"prechargeBalanceMs":6,"saveGenerationMs":7,"createGenerationJobMs":9}
```

效果：

- 提交总耗时从 `53194ms` 降到 `49ms`
- 查重耗时从 `53121ms` 降到 `2ms`

## 问题二：提交阶段下载 URL 型参考图导致慢

### 用户现象

用户使用历史图片或外链作为参考图时，点击“立即生成”后提交阶段较慢。

这里的“历史图片/外链作为参考图”指：

- 用户从历史记录里选一张已生成图片作为参考图
- 用户提交一个远程图片 URL 作为参考图
- 前端请求中携带的是 URL，而不是本地上传文件的 base64 内容

### 根因

旧逻辑在提交接口里提前下载 URL 型参考图，把下载耗时算进“提交中”。当远程图片慢、URL 过期、图片较大或网络波动时，用户会卡在提交阶段。

### 修复方案

方案 A 已实施：

- 提交阶段不再下载 URL 型参考图
- 提交阶段只分类并写入队列
- Worker 执行任务时再解析和下载参考图
- 本地上传参考图仍保留前端压缩后提交的现有链路

涉及文件：

- `app/api/generate/image/route.ts`
- `lib/generation-queue.ts`
- `lib/reference-image.ts`

### 验证方式

观察提交指标：

```sh
cd /opt/sanhub
docker compose logs --no-color --timestamps --since 30m sanhub | grep -F "[ImageSubmitMetrics]"
```

文生图或 URL 参考图提交阶段应重点看：

- `totalDurationMs`
- `prepareReferenceInputsMs`
- `inlineImageCount`
- `deferredReferenceImageCount`
- `payloadBytes`

## 问题三：批量生成或创作页偶尔显示结果异常

### 用户现象

前端偶尔显示“结果异常”或失败，但过一会儿历史记录中图片又正常出现。

### 判断

该问题本质上是前端轮询在任务尚未最终完成、或短暂接口异常时过早进入失败展示。

### 修复方案

已调整轮询与错误归类逻辑：

- 确认 generation 最终状态后再展示失败
- 对瞬时错误继续轮询
- 对可明确识别的业务错误展示中文原因

涉及文件：

- `lib/polling-utils.ts`
- `components/generator/image-generation-page.tsx`
- `components/generator/batch-image-generation-page.tsx`

### 当前状态

人工测试已通过：

- 普通创作
- 批量生成
- 历史记录查看
- 异常提示展示

## 问题四：只上传参考图但不写提示词时错误提示不准确

### 用户现象

某些模型不支持“仅参考图生成”，用户只上传参考图、不填写提示词时，前端错误提示曾误导为缺少参考图。

### 根因

上游返回的错误语义是“必须填写提示词”或“不支持只上传参考图”，但前端错误归类中没有覆盖这些中文短语。

### 修复方案

补充错误归类规则：

- `必须填写提示词`
- `不能只上传参考图`

涉及文件：

- `lib/polling-utils.ts`

提交：

- `9190e28 Improve prompt error classification`

### 当前状态

生产已部署。用户复测确认该问题已解决。

## 问题五：未配置图床时生成结果图片存储位置

### 结论

当上游返回类似 S3 预签名 URL 时，如果没有配置图床，图片不会落到本地服务器，也不会写入 `/app/data/media`。

实际行为：

- `generations.result_url` 保存远程 URL
- 前端预览直接使用该远程 URL
- 如果历史接口转成 `/api/media/:id`，媒体接口也只是做 302 重定向
- 只有 `data:` base64 结果才会落到本地媒体目录
- 本地媒体目录在容器内是 `/app/data/media`
- `/app/data` 挂载在 Docker volume `sanhub_sanhub_data`

涉及文件：

- `lib/media-storage.ts`
- `app/api/media/[id]/route.ts`
- `app/api/user/history/route.ts`

## 问题六：图床空间不足与媒体持久化

### 用户现象

Lsky 空间不足时，图片上传图床失败，历史记录与结果显示存在异常风险。

### 根因

远端媒体保存失败时，如果继续把大 base64 写入 `generations.result_url`，会导致数据库行膨胀，历史接口和状态接口变慢。

### 修复方案

已调整媒体保存策略：

- 优先上传远端图床
- 图床不可用时回退到本地文件持久化
- 不再静默把大 base64 长期写入 `generations.result_url`
- 后台网站配置中增加本地媒体清理功能

涉及文件：

- `lib/media-storage.ts`
- `app/api/admin/media/cleanup/route.ts`
- `app/admin/site/page.tsx`
- `lib/db.ts`

### 当前状态

Lsky 空间已扩容。新生成数据应继续观察是否出现大 `result_url`。

## 问题七：队列配置与任务状态

### 生产配置

当前队列配置：

```text
generation_queue_enabled: 1
generation_queue_image_concurrency: 80
generation_queue_channel_concurrency: 50
generation_queue_lock_timeout_seconds: 900
generation_queue_max_attempts: 1
```

### 判断

- `503`、`429` 已确认属于上游渠道问题
- `lock_timeout_seconds = 900` 可避免长任务在 90 秒时被重复领取
- 当前没有 `queued` 或 `running` 堆积

### 常用查询

```sh
cd /opt/sanhub
docker compose exec mysql sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE" -e "
SELECT status, COUNT(*) AS jobs
FROM generation_jobs
GROUP BY status;
"'
```

## 问题八：管理后台用户搜索页面跳动

### 用户现象

管理后台用户管理中，搜索用户时每输入一个字页面会跳动。

### 修复方案

已优化搜索交互，避免输入时布局频繁抖动。

涉及文件：

- `app/admin/users/page.tsx`

### 当前状态

人工测试通过。

## 问题九：本地测试时静态资源 404

### 用户现象

本地启动 standalone 服务后，浏览器静态资源大量 404，页面异常。

### 根因

standalone 运行方式需要 `.next/static` 存在于 standalone 运行目录下。

### 处理方式

本地测试时已补齐 `.next/static`，页面恢复正常。

### 生产状态

生产 Dockerfile 已包含：

```text
COPY --from=builder /app/.next/static ./.next/static
```

生产静态资源验证通过：

```text
/_next/static/chunks/webpack-ff4080743d89e74e.js
HTTP/1.1 200 OK
```

## 问题十：401 报错

### 用户现象

测试过程中出现 401。

### 结论

已确认是登录态问题，不是本轮代码 bug。

## 问题十一：历史 result_url 大字段清理与表空间回收

### 用户目标

清理 MySQL 中历史遗留的大 `generations.result_url`，降低表体积、备份体积和历史查询负担。

### 清理前数据

清理前 `result_url` 分布：

```text
total_generations: 38932
total_result_url_gb: 2.04
data_url_count: 506
file_url_count: 125
http_url_count: 34664
over_1mb: 354
over_5mb: 126
over_10mb: 87
```

按类型聚合：

```text
data_url: 506 rows, 2080.47 MB, avg 4210.29 KB, max 16.29 MB
http_url: 34664 rows, 4.13 MB
file_url: 125 rows, 0.01 MB
empty: 3637 rows
```

判断：

- 大字段几乎全部来自 `data:image/...;base64,...`
- `http_url` 与 `file_url` 都很小
- `params` 未发现大字段，最大约 `0.01 MB`

### 执行操作

用户确认可接受这 506 条历史 base64 图片不可预览后，直接清空对应 `result_url`：

```sql
UPDATE generations
SET
  result_url = '',
  updated_at = UNIX_TIMESTAMP() * 1000
WHERE result_url LIKE 'data:%';
```

随后在无活跃任务、应用容器已停止的维护窗口执行表空间回收：

```sql
OPTIMIZE TABLE generations;
ANALYZE TABLE generations;
```

执行前已补充当前状态备份：

```text
/opt/sanhub-backups/before-optimize-20260801-032656/mysql-current.sql.gz
```

### 清理后验证

清理后 `result_url`：

```text
data_url_rows: 0
total_result_url_mb: 4.14
over_1mb: 0
over_5mb: 0
over_10mb: 0
```

数据行数对比：

```text
generations_before: 38932
generations_after: 38932
jobs_before: 41752
jobs_after: 41752
```

磁盘与表空间：

```text
generations.ibd: 84M
generation_jobs.ibd: 136M
generations Data_length: 65.7 MB
generations Index_length: 14.8 MB
generations Data_free: 4 MB
root filesystem free: 48G
```

结果：

- MySQL 中历史 `data_url` 大字段已清空
- `generations.result_url` 总体积从约 `2.04 GB` 降到 `4.14 MB`
- `generations.ibd` 回收到约 `84 MB`
- `generations` 和 `generation_jobs` 行数未变化
- 506 条历史 base64 图片对应的预览不可用，这是本次清理的预期结果

## 部署安全策略

本轮生产部署遵循：

- 先备份 `.env`
- 先备份 `docker-compose.yml`
- 先备份 MySQL
- 先备份媒体 volume
- 不执行 `docker compose down -v`
- 不删除 Docker volume
- 不覆盖 `.env`
- 只重建应用容器
- MySQL 容器保持原容器和原数据卷

禁用的高风险命令：

```sh
docker compose down -v
docker volume rm sanhub_sanhub_mysql
docker volume rm sanhub_sanhub_data
docker system prune --volumes
git reset --hard
```

## 当前建议观察项

### 提交耗时

```sh
cd /opt/sanhub
docker compose logs --no-color --timestamps --since 30m sanhub | grep -F "[ImageSubmitMetrics]"
```

正常参考：

- `totalDurationMs` 为几十到几百毫秒
- `getGenerationByClientRequestIdMs` 为毫秒级

### 任务执行耗时

```sh
cd /opt/sanhub
docker compose logs --no-color --timestamps --since 30m sanhub | grep -F "[GenerationMetrics]"
```

重点字段：

- `queueWaitMs`
- `referenceImageResolveDurationMs`
- `upstreamDurationMs`
- `mediaStorageDurationMs`
- `databaseUpdateDurationMs`

### 队列积压

```sh
cd /opt/sanhub
docker compose exec mysql sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE" -e "
SELECT status, COUNT(*) AS jobs
FROM generation_jobs
GROUP BY status;
"'
```

### 数据库索引

```sh
cd /opt/sanhub
docker compose exec mysql sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE" -e "
SELECT INDEX_NAME, COLUMN_NAME, SEQ_IN_INDEX, NON_UNIQUE
FROM information_schema.STATISTICS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = \"generations\"
  AND INDEX_NAME = \"idx_user_client_request_id\";
"'
```

## 后续待办

- 继续观察真实用户提交指标，确认提交慢问题长期稳定消失
- 备份后清理终态孤立 `generation_jobs`
- 根据真实并发情况重新评估 `image_concurrency` 和 `channel_concurrency`
- 增加更集中化的生产观测面板或日志过滤脚本
