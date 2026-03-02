# SkyFlow Architecture

## Problem Statement

SkyFlow allocates and rebalances airport landing windows under congestion by combining request-driven APIs and asynchronous workflow processing, ensuring high-priority handling, fairness across airlines, and operational stability through idempotency, retries, DLQ isolation, and observability.

## Components

- API Gateway HTTP API: authenticated HTTP ingress.
- API Lambdas: validate requests, enforce role-based access, persist intent, enqueue workflow messages.
- SQS Workflow Queue + DLQ: decoupled processing and failure isolation.
- Allocator Worker Lambda: deterministic allocation/rebalance engine execution.
- DynamoDB tables: flights, slot allocations, idempotency records, dedupe/event log, capacity config.
- EventBridge Bus: domain event fan-out for downstream systems.
- CloudWatch: logs, metrics, alarm on DLQ buildup.

## Diagram

```mermaid
sequenceDiagram
    participant Client as Airline/Admin Client
    participant API as API Gateway + Lambda
    participant DDB as DynamoDB
    participant Q as SQS Queue
    participant W as Allocator Worker
    participant EB as EventBridge

    Client->>API: POST /v1/flights/requests (JWT + Idempotency-Key)
    API->>DDB: Put flight intent + idempotency record
    API->>Q: Send workflow message
    API-->>Client: 202 Accepted

    Q->>W: Deliver message
    W->>DDB: Conditional write dedupe token
    W->>DDB: Read active flights + existing slots + capacity
    W->>W: Allocate/rebalance slots
    W->>DDB: Upsert slot assignments + status updates
    W->>EB: Publish assigned/reassigned/holding events
    W-->>Q: Ack (or fail -> retry -> DLQ)
```
