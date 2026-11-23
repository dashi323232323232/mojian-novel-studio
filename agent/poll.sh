#!/bin/bash
export TOKEN="${TOKEN:-}"
echo "[poll] start $(date)" >> /mnt/workspace/agent_poll.log
python3 - <<'PY'
import os, time, json, base64, hashlib, subprocess, urllib.request
TOKEN = os.environ.get('TOKEN', '')
URL = 'https://api.github.com/repos/dashi323232323232/mojian-novel-studio/contents/agent/task.sh'
last = None
while True:
    try:
        req = urllib.request.Request(URL, headers={'Authorization': 'Bearer ' + TOKEN, 'User-Agent': 'agent', 'Accept': 'application/vnd.github.raw'})
        content = urllib.request.urlopen(req, timeout=25).read().decode('utf-8')
        h = hashlib.sha1(content.encode()).hexdigest()
        if h != last:
            last = h
            open('/tmp/agent_task.sh', 'w').write(content)
            subprocess.Popen(['bash', '/tmp/agent_task.sh'], env={**os.environ, 'TOKEN': TOKEN})
            open('/mnt/workspace/agent_poll.log', 'a').write('[poll] run %s %s\n' % (h[:8], time.strftime('%m-%d %H:%M:%S')))
    except Exception as e:
        open('/mnt/workspace/agent_poll.log', 'a').write('[poll] err %s\n' % str(e)[:120])
    time.sleep(30)
PY
