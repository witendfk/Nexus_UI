#!/usr/bin/env bash
# 从本地 Nexus_UI 参考仓打包 @nexus-ui/core、@nexus-ui/react、@nexus-ui/server tarball。
# 用法：pnpm pack:nexus   （默认假定 Nexus_UI 位于本仓同级目录，可用 NEXUS_UI_DIR 覆盖）
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NEXUS_UI_DIR="${NEXUS_UI_DIR:-"$(dirname "$REPO_ROOT")/Nexus_UI"}"
OUT_DIR="$REPO_ROOT/tarballs"

if [ ! -d "$NEXUS_UI_DIR" ]; then
  echo "找不到 Nexus_UI 仓库：$NEXUS_UI_DIR（可用 NEXUS_UI_DIR=... 覆盖）" >&2
  exit 1
fi

mkdir -p "$OUT_DIR"
rm -f "$OUT_DIR"/*.tgz

pack() {
  local dir="$1"
  echo ">> packing $dir"
  (cd "$dir" && pnpm pack --pack-destination "$OUT_DIR")
}

pack "$NEXUS_UI_DIR/packages/nexus-core"
pack "$NEXUS_UI_DIR/packages/nexus-react"
pack "$NEXUS_UI_DIR/server/nexus-playground-server"

echo ">> done:"
ls -1 "$OUT_DIR"
