#!/bin/bash
# Fresh seeded DB -> start harness -> run Playwright scenario -> stop.
set -e; cd "$(dirname "$0")/.."
export NODE_ENV=test JWT_SECRET='browser-test-secret-browser-test-secret' DB_PATH=/tmp/pl-e2e.sqlite UPLOAD_DIR=/tmp/pl-e2e-up PORT=8123 SERVE_FRONTEND=true
rm -rf /tmp/pl-e2e.sqlite* /tmp/pl-e2e-up
DEMO_PASSWORD='demo-pass-12345' node scripts/seed-demo.js >/dev/null
ADMIN_PHONE=+919000000000 ADMIN_NAME=Owner ADMIN_PASSWORD='admin-pass-123456' node scripts/create-admin.js >/dev/null
node test/browser-server.js > /tmp/pl-e2e.log 2>&1 & PID=$!
trap "kill $PID 2>/dev/null" EXIT
for i in $(seq 1 30); do curl -sf localhost:8123/healthz >/dev/null && break; sleep 0.3; done
python3 test/browser.py
