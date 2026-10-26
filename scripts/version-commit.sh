#!/usr/bin/env bash
# 墨笺小说工作台 —— 双版本提交工具
# 只保留「当前版本」和「上一个版本」两个 git 提交：
#   每次提交后把更早的提交压缩进根提交（squash），
#   仓库永远只有两个提交：上一个版本 + 当前版本。
# 用法： bash scripts/version-commit.sh "提交说明"
set -euo pipefail

MSG="${1:-更新版本}"
cd "$(dirname "$0")/.."

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "当前目录不是 git 仓库" >&2
  exit 1
fi

git add -A
if git diff --cached --quiet; then
  echo "没有需要提交的改动"
  exit 0
fi

git commit -q -m "$MSG"

COUNT=$(git rev-list --count HEAD)
if [ "$COUNT" -gt 2 ]; then
  # 重建一条只有两个提交的链：上一个版本（无父提交）+ 当前版本
  PREV_TREE=$(git rev-parse 'HEAD~1^{tree}')
  HEAD_TREE=$(git rev-parse 'HEAD^{tree}')
  NEW_PREV=$(git commit-tree "$PREV_TREE" -m "上一版本快照")
  NEW_HEAD=$(git commit-tree "$HEAD_TREE" -p "$NEW_PREV" -m "$MSG")
  BRANCH=$(git rev-parse --abbrev-ref HEAD)
  git reset -q --hard "$NEW_HEAD"
  git branch -f "$BRANCH" "$NEW_HEAD"
  git reflog expire --expire=now --all
  git gc --prune=now -q
fi

echo "当前提交历史（只保留最新与上一个版本）："
git --no-pager log --oneline -n 5
