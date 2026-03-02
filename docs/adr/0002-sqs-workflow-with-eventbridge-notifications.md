# ADR-0002: SQS for Workflow, EventBridge for Domain Notifications

## Decision

Use SQS (+ DLQ) for command/workflow execution and EventBridge for domain event fan-out.

## Rationale

- SQS gives explicit retry/DLQ control for critical state transitions.
- EventBridge cleanly decouples downstream consumers.

## Consequences

- Two messaging services increase infrastructure footprint.
