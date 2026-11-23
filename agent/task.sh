#!/bin/bash
cc=""
cd /mnt/workspace || exit 1
{
  echo "=== $(date) ==="
  grep -E 'step [0-9]+/' stage2.log | tail -2
  nvidia-smi --query-gpu=memory.used,utilization.gpu --format=csv,noheader
  ls -la lora_out3/lora_last.pt 2>/dev/null | awk '{print $5, $6, $7, $8}'
} > agent_status.txt 2>&1
if [ -n "$TOKEN" ]; then
  B64=$(base64 -w0 agent_status.txt)
  curl -s -X PUT -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d "{\"message\":\"status\",\"content\":\"$B64\"}" \
    "https://api.github.com/repos/dashi323232323232/mojian-novel-studio/contents/status/agent_status.b64" > /dev/null
  echo "uploaded"
else
  echo "no token"
fi
