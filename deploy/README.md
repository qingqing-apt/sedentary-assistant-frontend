# 部署手册（测试环境）

三个容器：`edge`（nginx，唯一对外）、`api`（FastAPI）、`runtime`（CopilotKit）。镜像来自 ACR，
版本用不可变 tag（`sha-xxxxxxxx` 或 `vX.Y.Z`）。所有命令都在服务器上的 `deploy/` 目录执行。

## 服务器一次性准备

```bash
sudo mkdir -p /opt/sedentary && sudo chown "$USER" /opt/sedentary
# 把本目录（compose.yaml / deploy.sh / .env.example）同步到 /opt/sedentary
cp .env.example .env && chmod 600 .env      # 然后填 ACR 与模型密钥，不要把 .env 提交到任何地方
mkdir -p certs                              # fullchain.pem / privkey.pem 放这里
docker login crpi-1bv9mjbeu8xhh314.cn-guangzhou.personal.cr.aliyuncs.com
```

安全组只放行 443（22 沿用现有策略）。8000/3000 不映射到宿主机，也不需要放行。

## 首次部署

```bash
./deploy.sh check                                     # 只读：磁盘、证书、.env 权限、compose 语法
./deploy.sh apply sha-e1a9c48 sha-bc2f141 sha-bc2f141  # api web runtime
curl -s https://<域名>/api/health
```

`apply` 的顺序是固定的：备份 → 拉镜像 → `up -d` → 三个容器都 `healthy` → 写 `state/current.json`。
中途任何一步失败会自动回滚到 `state/last-good.json` 并返回非 0。

## 日常发布

1. 两个仓库分别打 tag（`v0.2.0`），CI 构建 + 冒烟通过后才推 ACR；
2. 到服务器执行 `./deploy.sh apply <后端sha> <前端sha> <前端sha>`（web 与 runtime 同仓库，tag 相同）；
3. `./deploy.sh status` 看一眼。

tag 只用 sha：`latest` 这类标签会让「线上到底是哪个提交」变得无法回答。

## 回滚

```bash
./deploy.sh rollback                    # 回到上一次验证过的版本（state/last-good.json）
./deploy.sh rollback /path/to/record.json   # 指定某个版本：把 history.jsonl 里对应那行单独存成 .json
```

回滚只换镜像，**不碰数据卷**。回滚后 `last-good` 会变成你刚离开的那个版本，所以可以再滚回去。

## 备份与还原验证

```bash
./deploy.sh backup
```

- 数据库走 SQLite 的 `backup` API，不是 `cp`（WAL 模式下 `cp` 出来的文件可能不一致）；
- 线程目录打成 `threads-<时间>.tgz`；
- 还原只在独立位置做（例如 `/opt/sedentary/restore/app-test.db`），打开数一下行数证明可读，
  不要直接覆盖线上库。

## 出问题时

```bash
./deploy.sh status                # 当前 tag + 三容器状态 + 最近日志
docker compose logs --tail=100 api
```

排查顺序固定：先看容器是否 healthy，再看 nginx 层（502 = 上游不通），最后才看业务 4xx。
**不要** `down -v`、`system prune --volumes`、`rm -rf data/` —— 这三条会连数据一起删掉。
