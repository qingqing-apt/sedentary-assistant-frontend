#!/usr/bin/env bash
#
# 轮询 ACR 上最新的 vX.Y.Z 标签，和当前线上版本比对，有变化就调用 deploy.sh apply。
# 由 sedentary-autodeploy.timer 每 2 分钟拉起；也可以手工执行一次做验证。
#
# 为什么只认 v* 而不是 sha-*：
#   sha- 是构建副产物，每次提交都会产生；v 才是「我要发布」的意图。
#
# 为什么三个镜像分别取各自的最新 v：
#   api 与前端是两个仓库、两条版本线。前端发 v0.2.1 时后端可能还是 v0.1.0，
#   强行要求三者同号会让后端跟着空跑一次构建。
#
# 安全边界：本脚本只做「发现 + 调用 deploy.sh」，备份、健康检查、失败回滚
# 全部沿用 deploy.sh 的实现，不在这里另写一套。

set -euo pipefail

ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
ENV_FILE="$ROOT/.env"
CURRENT="$ROOT/state/current.json"
FAILED="$ROOT/state/autodeploy-failed.json"
RETRY_COOLDOWN=1800

log() { printf '[autodeploy] %s\n' "$*"; }

# 和 deploy.sh 用同一把锁：自动部署和人工 apply 不会同时跑
exec 9>"${LOCK_FILE:-/run/sedentary-deploy.lock}"
flock -n 9 || { log "另一个部署正在进行，跳过本轮"; exit 0; }

[[ -f $ENV_FILE ]] || { log ".env 不存在，退出"; exit 1; }

ACR=$(sed -n 's/^ACR=//p' "$ENV_FILE" | tail -1 | tr -d '\r')
[[ -n $ACR ]] || { log ".env 缺少 ACR"; exit 1; }
[[ $ACR == */* ]] || { log "ACR 需要写成 主机名/命名空间"; exit 1; }
REGISTRY=${ACR%%/*}
NAMESPACE=${ACR#*/}

# 复用 docker login 留下的凭证，不在服务器上再存一份密码。
# 用了 credential helper 的机器这里会拿不到，需要改回默认的 config 存储。
CRED=$(python3 - "$REGISTRY" <<'PY'
import base64, json, sys
try:
    cfg = json.load(open("/root/.docker/config.json", encoding="utf-8"))
except Exception:
    sys.exit(0)
entry = (cfg.get("auths") or {}).get(sys.argv[1]) or {}
auth = entry.get("auth")
if auth:
    print(base64.b64decode(auth).decode("utf-8", "replace"))
PY
)
[[ -n $CRED ]] || { log "找不到 $REGISTRY 的 docker 凭证，先执行 docker login"; exit 1; }

# ACR 个人版是 Bearer token 认证：先拿 docker 凭证换 token，再查标签。
# token 的 realm / service 每次从 401 响应里读，避免把地域相关的地址写死。
# 输出三个仓库各自最新的 vX.Y.Z，没有就输出 "-"。
TAGS=$(printf '%s\n' "$CRED" | python3 - "$REGISTRY" "$NAMESPACE" <<'PY'
import base64
import json
import re
import sys
import urllib.error
import urllib.parse
import urllib.request

registry, namespace = sys.argv[1], sys.argv[2]
cred = sys.stdin.readline().strip()
basic = "Basic " + base64.b64encode(cred.encode()).decode()


def fetch(url, headers):
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=20) as resp:
        return resp.read()


def auth_header(repo):
    scope = f"repository:{namespace}/{repo}:pull"
    url = f"https://{registry}/v2/{namespace}/{repo}/tags/list?n=1"
    try:
        fetch(url, {"Authorization": basic})
        return basic  # 某些实现直接接受 Basic
    except urllib.error.HTTPError as exc:
        challenge = exc.headers.get("Www-Authenticate", "")

    realm = re.search(r'realm="([^"]+)"', challenge)
    service = re.search(r'service="([^"]+)"', challenge)
    if not realm:
        raise RuntimeError(f"无法解析认证挑战：{challenge!r}")

    query = []
    if service:
        # ACR 的认证服务不接受 %3A / %2F 编码过的 service 和 scope（会返回 400），
        # 所以这里保留 : 和 / 原样。标准客户端也是这么发才被接受。
        query.append("service=" + urllib.parse.quote(service.group(1), safe=":/"))
    query.append("scope=" + urllib.parse.quote(scope, safe=":/"))
    data = json.loads(fetch(realm.group(1) + "?" + "&".join(query), {"Authorization": basic}))
    # ACR 返回的是 access_token；标准 registry 返回 token，两个都认
    token = data.get("token") or data.get("access_token")
    if not token:
        raise RuntimeError(f"认证服务没有返回 token：{sorted(data)}")
    return "Bearer " + token


def latest(repo):
    try:
        data = json.loads(
            fetch(
                f"https://{registry}/v2/{namespace}/{repo}/tags/list?n=200",
                {"Authorization": auth_header(repo)},
            )
        )
    except Exception as exc:  # noqa: BLE001
        print(f"[autodeploy] 读取 {repo} 标签失败：{exc}", file=sys.stderr)
        return "-"

    tags = [t for t in (data.get("tags") or []) if re.fullmatch(r"v\d+\.\d+\.\d+", t)]
    tags.sort(key=lambda t: tuple(int(x) for x in t[1:].split(".")))
    return tags[-1] if tags else "-"


print(" ".join(latest(r) for r in ("sedentary-api", "sedentary-web", "sedentary-runtime")))
PY
)

read -r api web runtime <<<"$TAGS"
api=${api/-/}
web=${web/-/}
runtime=${runtime/-/}

if [[ -z $api || -z $web || -z $runtime ]]; then
  log "有仓库还没有 v* 标签（api='$api' web='$web' runtime='$runtime'），跳过"
  exit 0
fi

# web 和 runtime 出自同一个 workflow。版本不一致说明那次构建只推成功了一半，
# 这时候上线会得到一个「新前端 + 旧 runtime」的组合，等下一轮再看。
if [[ $web != "$runtime" ]]; then
  log "web=$web 与 runtime=$runtime 不一致（疑似发布进行中），本轮跳过"
  exit 0
fi

if [[ -f $CURRENT ]]; then
  read -r cur_api cur_web cur_runtime < <(python3 - "$CURRENT" <<'PY'
import json, sys
d = json.load(open(sys.argv[1], encoding="utf-8"))
print(d["api"], d["web"], d["runtime"])
PY
)
  if [[ $api == "$cur_api" && $web == "$cur_web" && $runtime == "$cur_runtime" ]]; then
    exit 0
  fi
  log "发现新版本：api $cur_api → $api，web $cur_web → $web，runtime $cur_runtime → $runtime"
else
  log "首次自动部署：api=$api web=$web runtime=$runtime"
fi

# 同一组版本刚失败过就别每 2 分钟重试一次，否则日志会被刷满、容器反复重启。
if [[ -f $FAILED ]] && python3 - "$FAILED" "$api" "$web" "$runtime" "$RETRY_COOLDOWN" <<'PY'
import json, sys, time
try:
    d = json.load(open(sys.argv[1], encoding="utf-8"))
except Exception:
    sys.exit(1)
same = [d.get("api"), d.get("web"), d.get("runtime")] == sys.argv[2:5]
recent = time.time() - float(d.get("failed_at", 0)) < float(sys.argv[5])
sys.exit(0 if same and recent else 1)
PY
then
  log "这组版本最近部署失败过，冷却中，跳过"
  exit 0
fi

if SEDENTARY_LOCK_HELD=1 "$ROOT/deploy.sh" apply "$api" "$web" "$runtime"; then
  rm -f "$FAILED"
  log "自动部署完成：api=$api web=$web runtime=$runtime"
else
  python3 - "$FAILED" "$api" "$web" "$runtime" <<'PY'
import json, sys, time
json.dump(
    {"api": sys.argv[2], "web": sys.argv[3], "runtime": sys.argv[4], "failed_at": time.time()},
    open(sys.argv[1], "w", encoding="utf-8"),
)
PY
  log "自动部署失败（deploy.sh 已尝试回滚），$((RETRY_COOLDOWN / 60)) 分钟内不再重试这组版本"
  exit 1
fi
