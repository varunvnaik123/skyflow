# API Contracts (v1)

Base path: `/v1`

Machine-readable source of truth:

- `docs/openapi.json` (OpenAPI 3.1)
- Generated typed client: `packages/sdk/src/generated/client.ts` via `npm run sdk:generate`

Auth:

- JWT required for all endpoints.
- Roles: `AIRLINE`, `ADMIN`.

## POST `/flights/requests`

Headers:

- `Authorization: Bearer <jwt>`
- `Idempotency-Key: <opaque-string>`
- Optional: `X-Correlation-Id: <uuid>`

Request:

```json
{
  "airport_id": "SFO",
  "flight_id": "UA123",
  "airline_id": "UA",
  "scheduled_arrival_time": "2026-03-02T12:35:00.000Z",
  "aircraft_type": "A320",
  "priority": "NORMAL",
  "constraints": {
    "maxDelayMinutes": 30,
    "preferredRunwayId": "RWY-1"
  }
}
```

Response `202`:

```json
{
  "requestId": "uuid",
  "status": "QUEUED"
}
```

## POST `/flights/{flightId}/delay`

Request:

```json
{
  "airport_id": "SFO",
  "new_arrival_time": "2026-03-02T12:55:00.000Z",
  "delay_reason": "WEATHER"
}
```

Response `202`:

```json
{
  "requestId": "uuid",
  "status": "QUEUED"
}
```

## GET `/flights/{flightId}?airport_id=SFO`

Response `200`:

```json
{
  "flight_id": "UA123",
  "airline_id": "UA",
  "airport_id": "SFO",
  "status": "ASSIGNED",
  "scheduled_arrival_time": "2026-03-02T12:35:00.000Z",
  "priority": "NORMAL",
  "last_updated_at": "2026-03-02T12:05:00.000Z"
}
```

## PUT `/admin/capacity`

ADMIN only.

Request:

```json
{
  "airport_id": "SFO",
  "runway_count": 2,
  "slot_minutes": 5,
  "lookahead_minutes": 180,
  "holding_lookahead_minutes": 45,
  "max_consecutive_per_airline": 2,
  "freeze_window_minutes": 10
}
```

Response `200`:

```json
{
  "status": "UPDATED",
  "updated_at": "2026-03-02T12:05:00.000Z"
}
```

## GET `/admin/congestion?airport_id=SFO`

ADMIN only.

Response `200`:

```json
{
  "airport_id": "SFO",
  "assigned_slots": 8,
  "runway_count": 2,
  "slot_minutes": 5,
  "congestion_index": 0.67
}
```

## Error Contract

All failures:

```json
{
  "errorCode": "VALIDATION_ERROR",
  "message": "...",
  "correlationId": "uuid"
}
```

Common status codes:

- `400` validation
- `403` forbidden/role violation
- `404` not found
- `500` internal error
