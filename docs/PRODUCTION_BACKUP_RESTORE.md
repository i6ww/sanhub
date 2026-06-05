# 生产备份与恢复流程

这份流程面向使用 `docker-compose.yml` 部署的生产环境，数据库为 Compose 内置的 MySQL 服务。

## 备份

在项目目录执行：

```sh
sh scripts/backup-mysql.sh
```

默认会生成到 `backups/` 目录，例如：

```sh
backups/sanhub-20260605-120000.sql
```

也可以指定输出文件：

```sh
sh scripts/backup-mysql.sh backups/sanhub-before-upgrade.sql
```

建议在每次上线、迁移、升级前都执行一次备份，并把备份文件同步到服务器之外的位置。

## 恢复

恢复会覆盖当前数据库内容，请先确认备份文件和目标环境。

建议先暂停应用容器，避免恢复过程中继续写入：

```sh
docker compose stop sanhub
```

确认后执行恢复：

```sh
CONFIRM_RESTORE=yes sh scripts/restore-mysql.sh backups/sanhub-before-upgrade.sql
```

恢复完成后重新启动：

```sh
docker compose up -d
```

## 生产启动前检查

生产环境必须在 `.env` 中显式配置这些值：

```sh
NEXTAUTH_URL=https://your-domain.example
NEXTAUTH_SECRET=replace_with_a_random_secret
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=replace_with_a_strong_password
MYSQL_PASSWORD=replace_with_a_strong_password
MYSQL_ROOT_PASSWORD=replace_with_a_strong_password
```

可以用下面的命令生成随机密钥：

```sh
openssl rand -hex 32
```

如果仍使用默认弱密码，应用会拒绝启动。
