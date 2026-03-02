# ADR-0001: Single Airport Scope in v1

## Decision

Implement v1 for a single airport domain and airport-scoped keys in all tables.

## Rationale

- Reduces complexity while validating reliability patterns.
- Keeps core scheduling logic focused and testable.

## Consequences

- Multi-airport requires additional partitioning and tenancy controls in v2.
