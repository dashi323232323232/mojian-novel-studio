#!/bin/bash
cd /mnt/workspace || exit 1
{
  echo "=== $(date) ==="
  grep -E 'step [0-9]+/' stage2.log | tail -2
  nvidia-smi --query-gpu=memory.used,utilization.gpu --format=csv,noheader
  ls -la lora_out3/lora_last.pt 2>/dev/null | awk '{print $5, $6, $7, $8}'
} > agent_status.txt 2>&1
if [ -n "$TOKEN" ]; then
  python3 - <<'PY'
import base64, json, os, urllib.request
tok = os.environ.get('TOKEN', '')
data = open('/mnt/workspace/agent_status.txt', 'rb').read()
body = json.dumps({'message': 'status', 'content': base64.b64encode(data).decode()}).encode()
url = 'https://api.github.com/repos/dashi323232323232/mojian-novel-studio/contents/status/agent_status.b64'
req = urllib.request.Request(url, data=body, method='PUT', headers={'Authorization': 'Bearer ' + tok, 'User-Agent': 'agent', 'Content-Type': 'application/json'})
try:
    urllib.request.urlopen(req, timeout=25)
    print('uploaded')
except Exception as e:
    print('upload failed', str(e)[:120])
PY
fi
