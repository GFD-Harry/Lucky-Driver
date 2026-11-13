#!/usr/bin/env bash
# Cập nhật bản mới nhất từ GitHub và chạy lại. Dùng: sudo /opt/lucky-driver/deploy/deploy.sh
set -euo pipefail
cd "$(dirname "$0")/.."
git pull --ff-only
docker compose up -d --build
docker image prune -f >/dev/null
sleep 2
docker compose ps
curl -fsS -o /dev/null -w "Health: HTTP %{http_code}\n" http://127.0.0.1:3100/api/config
