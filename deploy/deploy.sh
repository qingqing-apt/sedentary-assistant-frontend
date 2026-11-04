#!/usr/bin/env bash
#
# 部署入口。四个子命令，没有第五个：
#   check                                     只读体检，不改任何东西
#   apply <api_tag> <web_tag> <runtime_tag>   备份 → 拉镜像 → 起容器 → 健康检查 → 记录
#   rollback [last-good|<json>]               用记录里的旧 tag 重来，不动卷
#   backup                                    备份 SQLite（backup API）和对话线程
#
# 硬规则写在这里，不靠人记：
#   1. 不写 .env —— 密钥由负责人线下维护，脚本只读；
#   2. 不执行 down -v / prune / 删卷；
#   3. 不做数据库迁移（本项目没有迁移框架，改表要评审 + 手工备份）；
#   4. apply 任一步失败 → 自动回滚到 last-good，并让脚本以非 0 退出；
#   5. 每次 apply 前把「当前正在跑的版本」存成 last-good，这是回滚唯一的依据。

set -euo pipefail

ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
ENV_FILE="$ROOT/.env"
STATE_DIR="$ROOT/state"
BACKUP_DIR="${BACKUP_DIR:-$ROOT/backups}"
CERTS_DIR="${CERTS_DIR:-$ROOT/certs}"
CURRENT="$STATE_DIR/current.json"
LAST_GOOD="$STATE_DIR/last-good.json"
HISTORY="$STATE_DIR/history.jsonl"
API_VOLUME="sedentary_data"
THREADS_VOLUME="sedentary_threads"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-180}"

log() { printf '[deploy] %s\n' "$*"; }
warn() { printf '[deploy] 警告：%s\n' "$*" >&2; }
die() { printf '[deploy] 错误：%s\n' "$*" >&2; exit 1; }

compose() {
  docker compose --project-directory "$ROOT" -f "$ROOT/compose.yaml" --env-file "$ENV_FILE" "$@"
}

read_env() {
  [[ -f $ENV_FILE ]] || return 1
  sed -n "s/^$1=//p" "$ENV_FILE" | tail -1
}

require_docker() {
  command -v docker >/dev/null || die "找不到 docker"
  docker compose version >/dev/null 2>&1 || die "需要 docker compose v2（docker compose 子命令）"
  docker info >/dev/null 2>&1 || die "当前用户连不上 docker daemon（是否在 docker 组 / 需要 sudo）"
}

preflight() {
  require_docker
  [[ -f $ENV_FILE ]] || die "$ENV_FILE 不存在；部署前必须先放好 .env（权限 600，不进 Git）"
  [[ -n $(read_env ACR) ]] || die ".env 里缺少 ACR"
  # 少命名空间时 docker 会报 pull access denied，看着像凭证问题，实际是路径不对
  [[ $(read_env ACR) == */* ]] || die ".env 的 ACR 缺少命名空间，应写成 主机名/命名空间（如 .../gcu）"
  mkdir -p "$STATE_DIR"
}

valid_tag() {
  # 只接受不可变 tag：sha-<7~40 位十六进制> 或 v<主>.<次>.<修>
  [[ $1 =~ ^sha-[0-9a-f]{7,40}$ || $1 =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]
}

check_tags() {
  local name tag
  for pair in "api:$1" "web:$2" "runtime:$3"; do
    name=${pair%%:*}
    tag=${pair#*:}
    valid_tag "$tag" || die "$name 的 tag 不合法：'$tag'（只接受 sha-xxxxxxx 或 vX.Y.Z）"
  done
}

read_tags() { # $1 = json 文件；输出 "api web runtime"
  python3 - "$1" <<'PY'
import json, sys
d = json.load(open(sys.argv[1], encoding="utf-8"))
print(d["api"], d["web"], d["runtime"])
PY
}

write_record() { # $1=文件 $2=api $3=web $4=runtime
  mkdir -p "$STATE_DIR"
  python3 - "$1" "$2" "$3" "$4" <<'PY'
import datetime, json, sys
path, api, web, runtime = sys.argv[1:5]
record = {
    "api": api,
    "web": web,
    "runtime": runtime,
    "deployed_at": datetime.datetime.now().astimezone().isoformat(timespec="seconds"),
}
with open(path, "w", encoding="utf-8") as fh:
    json.dump(record, fh, ensure_ascii=False, indent=2)
    fh.write("\n")
PY
}

append_history() {
  python3 - "$CURRENT" "$HISTORY" <<'PY'
import json, sys
src, hist = sys.argv[1:3]
with open(src, encoding="utf-8") as fh:
    record = json.load(fh)
with open(hist, "a", encoding="utf-8") as fh:
    fh.write(json.dumps(record, ensure_ascii=False, separators=(",", ":")) + "\n")
PY
}

export_tags() { # $1=api $2=web $3=runtime
  export API_TAG="$1" WEB_TAG="$2" RUNTIME_TAG="$3"
}

service_health() { # $1 = compose 服务名
  local id
  id=$(compose ps -q "$1" 2>/dev/null || true)
  [[ -n $id ]] || { echo missing; return; }
  docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$id"
}

wait_healthy() {
  local deadline=$((SECONDS + HEALTH_TIMEOUT)) svc states
  while (( SECONDS < deadline )); do
    states=""
    for svc in api runtime edge; do
      states+="$svc=$(service_health "$svc") "
    done
    if [[ $states == *"=healthy "* && $states != *"=starting"* && $states != *"=unhealthy"* && $states != *"=missing"* && $states != *"=none"* ]]; then
      log "健康检查通过：$states"
      return 0
    fi
    sleep 5
  done
  log "健康检查超时（${HEALTH_TIMEOUT}s）：$(for s in api runtime edge; do printf '%s=%s ' "$s" "$(service_health "$s")"; done)"
  return 1
}

show_diagnostics() {
  compose ps || true
  for svc in api runtime edge; do
    printf '\n[deploy] ---- %s 最近 40 行日志 ----\n' "$svc"
    compose logs --tail=40 "$svc" || true
  done
}

current_or_empty() {
  [[ -f $CURRENT ]] || { echo "未部署"; return; }
  read_tags "$CURRENT" 2>/dev/null || echo "记录不可读"
}

# ---------------------------------------------------------------- 子命令

cmd_check() {
  require_docker
  mkdir -p "$STATE_DIR"
  log "主机：$(hostname) / $(uname -sr)"
  log "磁盘：$(df -h "$ROOT" | awk 'NR==2 {print $4" 可用 / "$2" 总计（已用 "$5"）"}')"
  log "内存：$(free -m | awk 'NR==2 {print $7" MB 可用 / "$2" MB 总计"}')"

  if [[ -f $ENV_FILE ]]; then
    local perm
    perm=$(stat -c '%a' "$ENV_FILE")
    log ".env 权限：$perm"
    [[ $perm == 600 ]] || warn ".env 建议 chmod 600（当前 $perm）"
  else
    warn ".env 不存在，部署前必须放好"
  fi

  if [[ -f $CERTS_DIR/fullchain.pem ]]; then
    local end
    end=$(openssl x509 -enddate -noout -in "$CERTS_DIR/fullchain.pem" 2>/dev/null | sed 's/notAfter=//')
    log "证书到期：${end:-读取失败}"
  else
    warn "未找到 $CERTS_DIR/fullchain.pem（无证书时 edge 会启动失败，这是刻意的）"
  fi

  log "当前部署：$(current_or_empty)"
  if [[ -f $CURRENT ]]; then
    local api web runtime
    read -r api web runtime < <(read_tags "$CURRENT")
    export_tags "$api" "$web" "$runtime"
  else
    # 还没部署过：用占位 tag 只校验配置语法，不假装有版本
    log "尚未部署，用占位 tag 校验 compose 配置"
    export_tags "sha-0000000" "sha-0000000" "sha-0000000"
  fi

  if compose config --quiet 2>"$STATE_DIR/.config.err"; then
    log "compose 配置合法"
    rm -f "$STATE_DIR/.config.err"
  else
    warn "compose 配置校验失败："
    cat "$STATE_DIR/.config.err" >&2
  fi
  compose ps
}

cmd_backup() {
  preflight
  mkdir -p "$BACKUP_DIR"
  local ts; ts=$(date +%Y%m%d-%H%M%S)
  local acr; acr=$(read_env ACR)
  local api_tag=""

  if [[ -f $CURRENT ]]; then
    read -r api_tag _ _ < <(read_tags "$CURRENT")
  fi
  [[ -n $api_tag ]] || die "没有 state/current.json，无法确定用哪个 api 镜像做备份"

  local image="$acr/sedentary-api:$api_tag"

  if docker volume inspect "$API_VOLUME" >/dev/null 2>&1; then
    log "备份 SQLite（走 sqlite3 backup API，不是 cp）"
    docker run --rm \
      --user "$(id -u):$(id -g)" \
      -v "$API_VOLUME":/data:ro \
      -v "$BACKUP_DIR":/backup \
      "$image" \
      python -c "import sqlite3,sys;src=sqlite3.connect('/data/app.db');dst=sqlite3.connect('/backup/'+sys.argv[1]);src.backup(dst);dst.close();src.close();print('sqlite backup ->',sys.argv[1])" \
      "app-$ts.db"
  else
    warn "卷 $API_VOLUME 不存在，跳过数据库备份"
  fi

  if docker volume inspect "$THREADS_VOLUME" >/dev/null 2>&1; then
    log "打包对话线程"
    docker run --rm \
      --user "$(id -u):$(id -g)" \
      -v "$THREADS_VOLUME":/threads:ro \
      -v "$BACKUP_DIR":/backup \
      "$image" \
      tar czf "/backup/threads-$ts.tgz" -C /threads . 2>/dev/null \
      || warn "线程打包失败（可能是文件属主不同），数据库备份不受影响"
  fi

  log "备份目录：$BACKUP_DIR"
  ls -lh "$BACKUP_DIR" | tail -5
}

cmd_apply() {
  [[ $# -eq 3 ]] || die "用法：deploy.sh apply <api_tag> <web_tag> <runtime_tag>"
  local api=$1 web=$2 runtime=$3
  check_tags "$api" "$web" "$runtime"
  preflight

  # 先留数据，再动容器。备份失败就不部署 —— 宁可不发版，也不带着没有退路的状态上线。
  # 首次部署没有旧数据可备，跳过（此时卷还不存在）。
  if [[ -f $CURRENT ]]; then
    cmd_backup || die "备份失败，已中止部署（容器未改动）"
    cp "$CURRENT" "$LAST_GOOD"
    log "已记录回滚点：$(read_tags "$LAST_GOOD")"
  else
    rm -f "$LAST_GOOD"
    log "首次部署：没有历史版本可回滚"
  fi

  export_tags "$api" "$web" "$runtime"
  log "拉取镜像：api=$api web=$web runtime=$runtime"
  compose pull || die "拉取镜像失败，容器未改动"

  log "启动容器"
  if ! compose up -d --remove-orphans; then
    show_diagnostics
    fail_and_rollback "compose up 失败"
  fi

  if ! wait_healthy; then
    show_diagnostics
    fail_and_rollback "健康检查未通过"
  fi

  write_record "$CURRENT" "$api" "$web" "$runtime"
  append_history
  log "部署完成：api=$api web=$web runtime=$runtime"
  compose ps
}

apply_saved_record() { # $1 = json 文件
  local api web runtime
  read -r api web runtime < <(read_tags "$1")
  export_tags "$api" "$web" "$runtime"
  log "切换到 api=$api web=$web runtime=$runtime"
  compose pull
  compose up -d --remove-orphans
  wait_healthy
}

fail_and_rollback() {
  local why=$1
  log "失败原因：$why"
  if [[ -f $LAST_GOOD ]]; then
    log "自动回滚到 $(read_tags "$LAST_GOOD")"
    if apply_saved_record "$LAST_GOOD"; then
      log "已回滚。当前运行的是上一次验证过的版本，数据卷没有改动。"
    else
      log "回滚也失败了，需要人工介入：docker compose ps / logs，不要删卷"
    fi
  else
    log "没有 last-good 记录（首次部署），容器保持现状供排查；数据卷没有改动。"
  fi
  exit 1
}

cmd_rollback() {
  local target=${1:-last-good}
  preflight
  [[ $target == last-good ]] && target=$LAST_GOOD
  [[ -f $target ]] || die "找不到回滚记录：$target"

  local old=""
  [[ -f $CURRENT ]] && old=$(read_tags "$CURRENT")

  # 先把目标快照到临时文件：下面会把 last-good 覆盖成「回退前版本」，
  # 如果 target 恰好就是 last-good，不拷贝就会读到自己刚写进去的内容。
  local snapshot
  snapshot=$(mktemp)
  cp "$target" "$snapshot"

  log "回滚目标：$(read_tags "$snapshot")"
  if ! apply_saved_record "$snapshot"; then
    show_diagnostics
    rm -f "$snapshot"
    die "回滚未通过健康检查，容器保持现状"
  fi

  # 交换记录：回滚后还能回滚回来（回滚是双向的，也不需要删卷）
  if [[ -f $CURRENT ]]; then
    cp "$CURRENT" "$LAST_GOOD"
  fi
  cp "$snapshot" "$CURRENT"
  rm -f "$snapshot"
  append_history
  log "回滚完成，当前：$(read_tags "$CURRENT")"
  [[ -n $old ]] && log "回退前版本已存入 state/last-good.json：$old"
  compose ps
}

cmd_status() {
  require_docker
  log "当前记录：$(current_or_empty)"
  [[ -f $LAST_GOOD ]] && log "回滚点：$(read_tags "$LAST_GOOD")"
  if [[ -f $CURRENT ]]; then
    local api web runtime
    read -r api web runtime < <(read_tags "$CURRENT")
    export_tags "$api" "$web" "$runtime"
  fi
  compose ps
  for svc in api runtime edge; do
    printf '\n[deploy] ---- %s 最近 20 行 ----\n' "$svc"
    compose logs --tail=20 "$svc" 2>&1 || true
  done
}

usage() {
  cat <<'EOF'
用法：deploy.sh <子命令>

  check                                     只读体检：磁盘、证书、.env 权限、compose 配置、容器状态
  apply <api_tag> <web_tag> <runtime_tag>   备份 → 拉镜像 → 起容器 → 健康检查 → 记录
  rollback [last-good|<json>]               回滚到记录里的版本（不动数据卷）
  backup                                    备份 SQLite 与对话线程到 ./backups
  status                                    当前 tag、容器状态、最近日志
EOF
}

main() {
  local cmd=${1:-}
  [[ $# -gt 0 ]] && shift
  case "$cmd" in
    check)    cmd_check "$@" ;;
    apply)    cmd_apply "$@" ;;
    rollback) cmd_rollback "$@" ;;
    backup)   cmd_backup "$@" ;;
    status)   cmd_status "$@" ;;
    ""|-h|--help|help) usage ;;
    *) usage; exit 2 ;;
  esac
}

main "$@"
