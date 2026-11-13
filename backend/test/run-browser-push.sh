#!/bin/bash
set -e; cd "$(dirname "$0")/.."
export NODE_ENV=test JWT_SECRET='browser-test-secret-browser-test-secret' DB_PATH=/tmp/pl-e2e2.sqlite UPLOAD_DIR=/tmp/pl-e2e-up2 PORT=8123 SERVE_FRONTEND=true
rm -rf /tmp/pl-e2e2.sqlite* /tmp/pl-e2e-up2
node test/browser-server.js > /tmp/pl-e2e2.log 2>&1 & PID=$!; trap "kill $PID 2>/dev/null" EXIT
for i in $(seq 1 30); do curl -sf localhost:8123/healthz >/dev/null && break; sleep 0.3; done
python3 test/browser-push.py
