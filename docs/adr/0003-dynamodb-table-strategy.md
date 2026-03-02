# ADR-0003: Multi-Table DynamoDB Strategy

## Decision

Use dedicated tables for flights, slots, idempotency, dedupe, and capacity.

## Rationale

- Clear operational boundaries per concern.
- Easier to reason about TTL, retention, and access controls.

## Consequences

- More table resources than a single-table approach.
