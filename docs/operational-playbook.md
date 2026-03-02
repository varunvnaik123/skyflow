# Operational Playbook

## Observability

Logs:

- All Lambdas emit structured JSON with `correlationId`, `eventId/requestId`, and operation context.

Metrics:

- `slot_assignment_latency`
- `rebalance_count`
- `holding_queue_depth`
- `congestion_index`
- `flight_request_accepted`
- `delay_updates_received`

Alarm:

- `WorkflowDlqAlarm` triggers when `ApproximateNumberOfMessagesVisible >= 1` on the DLQ.

## Local Verification

Run a local full workflow simulation against LocalStack:

```bash
npm run local:e2e
```

This validates:

- resource bootstrap
- idempotent request intake
- queue-driven allocation processing
- delay-triggered rebalance processing
- persistence in DynamoDB tables

## DLQ Handling

1. Inspect DLQ messages:
   - Read `eventId`, `correlationId`, and payload.
2. Trace root cause:
   - Query CloudWatch logs by `correlationId`.
3. Fix and replay:
   - Re-send message body to main workflow queue.
4. Validate dedupe behavior:
   - If event was partially processed, dedupe table prevents duplicate side effects.

## Replay Guidance

- Replays should preserve original `eventId` when intentionally verifying dedupe suppression.
- Use a new `eventId` only when manually forcing full reprocessing.

## Known Failure Modes

- Invalid JWT claims or missing role claims -> 403.
- Idempotency key re-used with different payload -> 400.
- Downstream publish failures (EventBridge) -> worker retry then DLQ.
- Burst congestion exceeding lookahead capacity -> flights move to HOLDING.

## On-Call Triage Checklist

1. Is DLQ growing?
2. Are worker retries spiking?
3. Is congestion index > 0.9 sustained?
4. Are emergency flights delayed unexpectedly?
5. Are fairness indicators skewed toward one airline?
