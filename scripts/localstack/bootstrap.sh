#!/usr/bin/env bash
set -euo pipefail

AWS_ENDPOINT_URL="${AWS_ENDPOINT_URL:-http://localhost:4566}"
AWS_REGION="${AWS_REGION:-us-west-2}"
AWS_ACCESS_KEY_ID="${AWS_ACCESS_KEY_ID:-test}"
AWS_SECRET_ACCESS_KEY="${AWS_SECRET_ACCESS_KEY:-test}"

export AWS_ENDPOINT_URL AWS_REGION AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

require_cmd aws

aws_local() {
  aws --endpoint-url "$AWS_ENDPOINT_URL" --region "$AWS_REGION" "$@"
}

wait_for_table_active() {
  local table_name="$1"
  for _ in {1..60}; do
    local status
    status="$(aws_local dynamodb describe-table --table-name "$table_name" --query 'Table.TableStatus' --output text 2>/dev/null || true)"
    if [[ "$status" == "ACTIVE" ]]; then
      return 0
    fi
    sleep 1
  done

  echo "[bootstrap] table did not become ACTIVE in time: $table_name" >&2
  return 1
}

create_table_if_missing() {
  local table_name="$1"
  local create_payload="$2"

  if aws_local dynamodb describe-table --table-name "$table_name" >/dev/null 2>&1; then
    echo "[bootstrap] table exists: $table_name"
  else
    echo "[bootstrap] creating table: $table_name"
    aws_local dynamodb create-table --cli-input-json "$create_payload" >/dev/null
  fi

  wait_for_table_active "$table_name"
}

FLIGHTS_TABLE_NAME="skyflow-flights"
SLOTS_TABLE_NAME="skyflow-slots"
IDEMPOTENCY_TABLE_NAME="skyflow-idempotency"
DEDUPE_TABLE_NAME="skyflow-dedupe"
CAPACITY_TABLE_NAME="skyflow-capacity"
WORKFLOW_QUEUE_NAME="skyflow-workflow-queue"
WORKFLOW_DLQ_NAME="skyflow-workflow-dlq"
EVENT_BUS_NAME="skyflow-domain-events"

create_table_if_missing "$FLIGHTS_TABLE_NAME" '{
  "TableName": "skyflow-flights",
  "AttributeDefinitions": [
    {"AttributeName": "PK", "AttributeType": "S"},
    {"AttributeName": "SK", "AttributeType": "S"},
    {"AttributeName": "GSI1PK", "AttributeType": "S"},
    {"AttributeName": "GSI1SK", "AttributeType": "S"}
  ],
  "KeySchema": [
    {"AttributeName": "PK", "KeyType": "HASH"},
    {"AttributeName": "SK", "KeyType": "RANGE"}
  ],
  "GlobalSecondaryIndexes": [
    {
      "IndexName": "GSI1",
      "KeySchema": [
        {"AttributeName": "GSI1PK", "KeyType": "HASH"},
        {"AttributeName": "GSI1SK", "KeyType": "RANGE"}
      ],
      "Projection": {"ProjectionType": "ALL"}
    }
  ],
  "BillingMode": "PAY_PER_REQUEST"
}'

create_table_if_missing "$SLOTS_TABLE_NAME" '{
  "TableName": "skyflow-slots",
  "AttributeDefinitions": [
    {"AttributeName": "PK", "AttributeType": "S"},
    {"AttributeName": "SK", "AttributeType": "S"},
    {"AttributeName": "GSI1PK", "AttributeType": "S"},
    {"AttributeName": "GSI1SK", "AttributeType": "S"}
  ],
  "KeySchema": [
    {"AttributeName": "PK", "KeyType": "HASH"},
    {"AttributeName": "SK", "KeyType": "RANGE"}
  ],
  "GlobalSecondaryIndexes": [
    {
      "IndexName": "GSI1",
      "KeySchema": [
        {"AttributeName": "GSI1PK", "KeyType": "HASH"},
        {"AttributeName": "GSI1SK", "KeyType": "RANGE"}
      ],
      "Projection": {"ProjectionType": "ALL"}
    }
  ],
  "BillingMode": "PAY_PER_REQUEST"
}'

create_table_if_missing "$IDEMPOTENCY_TABLE_NAME" '{
  "TableName": "skyflow-idempotency",
  "AttributeDefinitions": [
    {"AttributeName": "PK", "AttributeType": "S"},
    {"AttributeName": "SK", "AttributeType": "S"}
  ],
  "KeySchema": [
    {"AttributeName": "PK", "KeyType": "HASH"},
    {"AttributeName": "SK", "KeyType": "RANGE"}
  ],
  "BillingMode": "PAY_PER_REQUEST"
}'

create_table_if_missing "$DEDUPE_TABLE_NAME" '{
  "TableName": "skyflow-dedupe",
  "AttributeDefinitions": [
    {"AttributeName": "PK", "AttributeType": "S"}
  ],
  "KeySchema": [
    {"AttributeName": "PK", "KeyType": "HASH"}
  ],
  "BillingMode": "PAY_PER_REQUEST"
}'

create_table_if_missing "$CAPACITY_TABLE_NAME" '{
  "TableName": "skyflow-capacity",
  "AttributeDefinitions": [
    {"AttributeName": "PK", "AttributeType": "S"},
    {"AttributeName": "SK", "AttributeType": "S"}
  ],
  "KeySchema": [
    {"AttributeName": "PK", "KeyType": "HASH"},
    {"AttributeName": "SK", "KeyType": "RANGE"}
  ],
  "BillingMode": "PAY_PER_REQUEST"
}'

aws_local dynamodb update-time-to-live \
  --table-name "$IDEMPOTENCY_TABLE_NAME" \
  --time-to-live-specification "Enabled=true,AttributeName=ttl" >/dev/null || true

aws_local dynamodb update-time-to-live \
  --table-name "$DEDUPE_TABLE_NAME" \
  --time-to-live-specification "Enabled=true,AttributeName=ttl" >/dev/null || true

WORKFLOW_DLQ_URL="$(aws_local sqs get-queue-url --queue-name "$WORKFLOW_DLQ_NAME" --query QueueUrl --output text 2>/dev/null || true)"
if [[ -z "$WORKFLOW_DLQ_URL" || "$WORKFLOW_DLQ_URL" == "None" ]]; then
  WORKFLOW_DLQ_URL="$(aws_local sqs create-queue --queue-name "$WORKFLOW_DLQ_NAME" --query QueueUrl --output text)"
fi

WORKFLOW_QUEUE_URL="$(aws_local sqs get-queue-url --queue-name "$WORKFLOW_QUEUE_NAME" --query QueueUrl --output text 2>/dev/null || true)"
if [[ -z "$WORKFLOW_QUEUE_URL" || "$WORKFLOW_QUEUE_URL" == "None" ]]; then
  WORKFLOW_QUEUE_URL="$(aws_local sqs create-queue --queue-name "$WORKFLOW_QUEUE_NAME" --attributes VisibilityTimeout=60 --query QueueUrl --output text)"
fi

WORKFLOW_DLQ_ARN="$(aws_local sqs get-queue-attributes --queue-url "$WORKFLOW_DLQ_URL" --attribute-names QueueArn --query 'Attributes.QueueArn' --output text)"

REDRIVE_FILE="$(mktemp)"
cat > "$REDRIVE_FILE" <<EOF
{
  "RedrivePolicy": "{\"deadLetterTargetArn\":\"$WORKFLOW_DLQ_ARN\",\"maxReceiveCount\":\"5\"}"
}
EOF

aws_local sqs set-queue-attributes \
  --queue-url "$WORKFLOW_QUEUE_URL" \
  --attributes "file://$REDRIVE_FILE" >/dev/null

rm -f "$REDRIVE_FILE"

aws_local sqs purge-queue --queue-url "$WORKFLOW_QUEUE_URL" >/dev/null 2>&1 || true
aws_local sqs purge-queue --queue-url "$WORKFLOW_DLQ_URL" >/dev/null 2>&1 || true

aws_local events create-event-bus --name "$EVENT_BUS_NAME" >/dev/null 2>&1 || true

aws_local dynamodb put-item \
  --table-name "$CAPACITY_TABLE_NAME" \
  --item '{
    "PK": {"S": "AIRPORT#SFO"},
    "SK": {"S": "CONFIG#CAPACITY"},
    "airportId": {"S": "SFO"},
    "runwayCount": {"N": "2"},
    "slotMinutes": {"N": "5"},
    "lookaheadMinutes": {"N": "180"},
    "holdingLookaheadMinutes": {"N": "45"},
    "maxConsecutivePerAirline": {"N": "2"},
    "freezeWindowMinutes": {"N": "10"},
    "updatedAt": {"S": "2026-03-02T00:00:00.000Z"},
    "updatedBy": {"S": "localstack-bootstrap"}
  }' >/dev/null

ENV_FILE="$(dirname "$0")/.env.localstack"
cat > "$ENV_FILE" <<EOT
export AWS_ENDPOINT_URL=$AWS_ENDPOINT_URL
export AWS_REGION=$AWS_REGION
export AWS_ACCESS_KEY_ID=$AWS_ACCESS_KEY_ID
export AWS_SECRET_ACCESS_KEY=$AWS_SECRET_ACCESS_KEY
export FLIGHTS_TABLE_NAME=$FLIGHTS_TABLE_NAME
export SLOTS_TABLE_NAME=$SLOTS_TABLE_NAME
export IDEMPOTENCY_TABLE_NAME=$IDEMPOTENCY_TABLE_NAME
export DEDUPE_TABLE_NAME=$DEDUPE_TABLE_NAME
export CAPACITY_TABLE_NAME=$CAPACITY_TABLE_NAME
export WORKFLOW_QUEUE_URL=$WORKFLOW_QUEUE_URL
export EVENT_BUS_NAME=$EVENT_BUS_NAME
EOT

echo "[bootstrap] complete. env file: $ENV_FILE"
