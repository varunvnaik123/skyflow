# Domain Event Schemas (Versioned)

Envelope (all events):

```json
{
  "eventId": "uuid",
  "correlationId": "uuid",
  "causationId": "uuid",
  "eventType": "skyflow.slot.assigned.v1",
  "eventVersion": "1.0.0",
  "eventTime": "2026-03-02T12:05:00.000Z",
  "detail": {}
}
```

## `skyflow.flight.requested.v1`

```json
{
  "airportId": "SFO",
  "flightId": "UA123",
  "airlineId": "UA",
  "scheduledArrivalTime": "2026-03-02T12:35:00.000Z",
  "aircraftType": "A320",
  "priority": "NORMAL"
}
```

## `skyflow.flight.delay-updated.v1`

```json
{
  "airportId": "SFO",
  "flightId": "UA123",
  "newArrivalTime": "2026-03-02T12:55:00.000Z",
  "delayReason": "WEATHER"
}
```

## `skyflow.slot.assigned.v1` / `skyflow.slot.reassigned.v1`

```json
{
  "airportId": "SFO",
  "flightId": "UA123",
  "airlineId": "UA",
  "runwayId": "RWY-1",
  "slotStartTime": "2026-03-02T12:40:00.000Z",
  "slotEndTime": "2026-03-02T12:45:00.000Z",
  "isRebalance": false
}
```

## `skyflow.flight.holding.v1`

```json
{
  "airportId": "SFO",
  "flightId": "UA123",
  "reason": "No available slot in current lookahead window",
  "nextReattemptAt": "2026-03-02T12:10:00.000Z"
}
```

## `skyflow.flight.failed.v1`

```json
{
  "airportId": "SFO",
  "flightId": "UA123",
  "reason": "Terminal allocation failure"
}
```
