#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."

echo "[localstack] starting container..."
docker compose up -d localstack

echo "[localstack] waiting for health endpoint..."
for _ in {1..120}; do
  # Bypass proxy settings for localhost checks.
  health_json="$(curl --noproxy '*' -s http://localhost:4566/_localstack/health || true)"
  if echo "$health_json" | grep -Eq '"initialized"[[:space:]]*:[[:space:]]*true|"running"|"available"'; then
    echo "[localstack] ready"
    exit 0
  fi
  sleep 2
done

echo "[localstack] failed to become ready in time" >&2
echo "[localstack] docker compose status:" >&2
docker compose ps >&2 || true
echo "[localstack] recent logs:" >&2
docker compose logs --tail 120 localstack >&2 || true
exit 1
