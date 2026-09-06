#!/usr/bin/env bash
set -euo pipefail
cd /workspace/creativerush
set -a; source /workspace/creativerush/h3.env; set +a
export PATH=/workspace/node-v22.18.0-linux-x64/bin:$PATH
cd /workspace/ComfyUI
.venv/bin/python main.py --listen 127.0.0.1 --port 8188 --disable-pinned-memory --fp16-intermediates --cache-none >> /workspace/creativerush/comfy.log 2>&1 &
comfy_pid=$!
worker_pid=''
cleanup(){ kill -TERM "$comfy_pid" ${worker_pid:-} 2>/dev/null || true; wait || true; }
trap cleanup EXIT
trap 'exit 0' TERM INT
for ((i=0;i<120;i++)); do
  kill -0 "$comfy_pid" || exit 1
  if curl -fsS http://127.0.0.1:8188/system_stats >/dev/null; then break; fi
  sleep 2
done
curl -fsS http://127.0.0.1:8188/system_stats >/dev/null
node /workspace/creativerush/workers/h3-worker.mjs >> /workspace/creativerush/h3-worker.log 2>&1 &
worker_pid=$!
wait -n "$comfy_pid" "$worker_pid"
exit 1
