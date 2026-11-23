#!/bin/bash
# 反向通道：每 30 秒拉一次 agent/task.sh，内容变了就执行
REPO_RAW="https://raw.githubusercontent.com/dashi323232323232/mojian-novel-studio/main/agent"
export TOKEN="${TOKEN:-}"
LAST=""
echo "[poll] started $(date)" >> /mnt/workspace/agent_poll.log
while true; do
  curl -s -H "Cache-Control: no-cache" "$REPO_RAW/task.sh?t=$(date +%s)" -o /tmp/agent_task.sh
  if [ -s /tmp/agent_task.sh ] && ! grep -q "404: Not Found" /tmp/agent_task.sh; then
    NEW=$(sha1sum /tmp/agent_task.sh | cut -d' ' -f1)
    if [ "$NEW" != "$LAST" ]; then
      LAST="$NEW"
      echo "[poll] run task $NEW at $(date)" >> /mnt/workspace/agent_poll.log
      TOKEN="$TOKEN" bash /tmp/agent_task.sh >> /mnt/workspace/agent_task.log 2>&1
    fi
  fi
  sleep 30
done
