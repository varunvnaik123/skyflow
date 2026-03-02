#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

echo "[doctor] cwd: $ROOT_DIR"

if command -v node >/dev/null 2>&1; then
  NODE_VERSION="$(node -v)"
  echo "[doctor] node: $NODE_VERSION"
  NODE_MAJOR="$(node -v | sed 's/^v//' | cut -d. -f1)"
  if [[ "$NODE_MAJOR" -lt 20 || "$NODE_MAJOR" -gt 22 ]]; then
    echo "[doctor] FAIL: Node must be 20.x or 22.x (recommended 20.x)"
    exit 1
  fi
else
  echo "[doctor] FAIL: node not found"
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "[doctor] FAIL: npm not found"
  exit 1
fi

echo "[doctor] npm: $(npm -v)"

if ! command -v docker >/dev/null 2>&1; then
  echo "[doctor] FAIL: docker not found"
  exit 1
fi

echo "[doctor] docker: $(docker --version)"

echo "[doctor] docker compose: $(docker compose version)"

if ! docker info >/dev/null 2>&1; then
  echo "[doctor] FAIL: docker daemon not reachable"
  exit 1
fi

if ! command -v aws >/dev/null 2>&1; then
  echo "[doctor] FAIL: aws cli not found"
  exit 1
fi

echo "[doctor] aws: $(aws --version 2>&1)"

echo "[doctor] PASS: local prerequisites look good"
