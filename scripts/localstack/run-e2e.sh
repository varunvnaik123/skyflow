#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT_DIR"

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

require_cmd node
require_cmd npm
require_cmd docker
require_cmd aws

NODE_MAJOR="$(node -v | sed 's/^v//' | cut -d. -f1)"
if [[ "$NODE_MAJOR" -lt 20 || "$NODE_MAJOR" -gt 22 ]]; then
  echo "Unsupported Node version: $(node -v)." >&2
  echo "Use Node 20.x or 22.x (recommended: 20.x). Run: nvm use 20" >&2
  exit 1
fi

if [[ "${SKYFLOW_LOCAL_E2E_CLEAN:-1}" == "1" ]]; then
  echo "[local-e2e] cleaning previous LocalStack state..."
  docker compose down -v >/dev/null 2>&1 || true
fi

./scripts/localstack/start.sh
./scripts/localstack/bootstrap.sh

npm run sdk:generate
npm run build --workspace @skyflow/shared
npm run build --workspace @skyflow/domain
npm run build --workspace @skyflow/application
npm run build --workspace @skyflow/aws-adapters

# shellcheck disable=SC1091
source ./scripts/localstack/.env.localstack

node ./scripts/local-e2e.mjs
