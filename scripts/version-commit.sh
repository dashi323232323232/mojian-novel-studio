#!/usr/bin/env bash
# 大师小说工作台 —— 版本提交工具
#
# 规则（按用户要求）：
#   1. 本地 Git 只保留「当前版本」和「上一个版本」两个提交，历史更早的提交会被压缩；
#   2. GitHub 上保留全部版本：每次提交时把该版本快照推成一个独立分支
#      release/<版本号> 并打同名标签，GitHub 侧永久保留；
#   3. 推送时只推送 main 与新增的版本分支/标签，不改变本地历史长度。
#
# 用法：
#   bash scripts/version-commit.sh "提交说明" [版本号，例如 v1.0.0]
set -euo pipefail

MSG="${1:-更新版本}"
VERSION="${2:-}"
cd "$(dirname "$0")/.."

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "当前目录不是 git 仓库" >&2
  exit 1
fi

if [ -z "$VERSION" ]; then
  BASE=$(node -p "require('./package.json').version" 2>/dev/null || echo "1.0.0")
  N=$(git tag --list "v${BASE}-*" | wc -l | tr -d ' ')
  VERSION="v${BASE}-$((N + 1))"
fi

git add -A
if git diff --cached --quiet; then
  echo "没有需要提交的改动"
  exit 0
fi

git commit -q -m "$MSG"

# ---- 1) 归档到 GitHub：每个版本一个分支 + 标签 ----
SNAPSHOT=$(git rev-parse HEAD)
ARCHIVE_BRANCH="release/${VERSION}"
git branch -f "$ARCHIVE_BRANCH" "$SNAPSHOT"
git tag -f "$VERSION" "$SNAPSHOT" >/dev/null 2>&1 || true

# ---- 2) 本地只保留两个提交：把 HEAD~1 之外的旧历史压缩掉 ----
COUNT=$(git rev-list --count HEAD)
if [ "$COUNT" -gt 2 ]; then
  PREV_TREE=$(git rev-parse 'HEAD~1^{tree}')
  HEAD_TREE=$(git rev-parse 'HEAD^{tree}')
  NEW_PREV=$(git commit-tree "$PREV_TREE" -m "上一版本快照")
  NEW_HEAD=$(git commit-tree "$HEAD_TREE" -p "$NEW_PREV" -m "$MSG")
  # git reset --hard 会同时移动当前分支指针，无需再 branch -f
  git reset -q --hard "$NEW_HEAD"
  git reflog expire --expire=now --all
fi

# ---- 3) 推送到 GitHub：先推送归档分支/标签，再清理本地归档引用 ----
# 注意：本地分支在 git reset 后可能已不存在，因此推送前重新创建归档引用。
REMOTE_URL=$(git remote get-url origin 2>/dev/null || true)
# 网络环境可能需要在「直连」与「本地代理」之间切换，自动探测一次
PUSH_OPTS=""
if command -v curl >/dev/null 2>&1; then
  if ! curl -s -o /dev/null --max-time 8 https://github.com/ 2>/dev/null; then
    if curl -s -o /dev/null --max-time 5 -x http://127.0.0.1:7897 https://github.com/ 2>/dev/null; then
      echo "直连不可用，改用本地代理 127.0.0.1:7897"
      PUSH_OPTS="-c http.proxy=http://127.0.0.1:7897 -c https.proxy=http://127.0.0.1:7897"
    fi
  fi
fi

if [ -n "$REMOTE_URL" ]; then
  echo "正在推送 main 与归档分支 ${ARCHIVE_BRANCH} …"
  git $PUSH_OPTS push -f origin "HEAD:refs/heads/main" 2>&1 | tail -2 || echo "推送 main 失败（可稍后手动重试）"
  git branch -f "$ARCHIVE_BRANCH" "$SNAPSHOT" 2>/dev/null || true
  git tag -f "$VERSION" "$SNAPSHOT" >/dev/null 2>&1 || true
  git $PUSH_OPTS push -f origin "refs/heads/${ARCHIVE_BRANCH}:refs/heads/${ARCHIVE_BRANCH}" 2>&1 | tail -2 || echo "推送归档分支失败"
  git $PUSH_OPTS push -f origin "refs/tags/${VERSION}" 2>&1 | tail -2 || echo "推送标签失败"

  # GitHub 已保存完整版本，本地删除归档分支与标签，保证本地只有两个提交
  git branch -D "$ARCHIVE_BRANCH" >/dev/null 2>&1 || true
  git tag -d "$VERSION" >/dev/null 2>&1 || true
  git gc --prune=now -q 2>/dev/null || true
fi

echo
echo "本地提交历史（只保留最新与上一个版本）："
git --no-pager log --oneline -n 5
echo
echo "GitHub 归档版本（全部保留，可用 git ls-remote --tags origin 查看）："
git $PUSH_OPTS ls-remote --tags origin 2>/dev/null | sed 's#.*refs/tags/#  #' | sort -V | tail -20 || true
