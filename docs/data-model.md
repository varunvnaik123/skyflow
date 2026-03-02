# DynamoDB Data Model and Access Patterns

## Table 1: `FlightsTable`

Keys:
- `PK` = `AIRPORT#{airportId}`
- `SK` = `FLIGHT#{flightId}`

Attributes:
- `airportId`, `flightId`, `airlineId`, `scheduledArrivalTime`, `priority`, `status`, `aircraftType`, `constraints`, `lastUpdatedAt`, optional `delayReason`
- `GSI1PK` = `ACTIVE#{airportId}` or `TERMINAL#{airportId}`
- `GSI1SK` = `scheduledArrivalTime`

Access patterns:
- Get flight by ID: `GetItem(PK, SK)`
- List active flights for allocator: `Query GSI1 where GSI1PK=ACTIVE#{airportId}`
- Update status/delay: `UpdateItem(PK, SK)`

## Table 2: `SlotsTable`

Keys:
- `PK` = `AIRPORT#{airportId}`
- `SK` = `FLIGHT#{flightId}`

Attributes:
- `flightId`, `airlineId`, `runwayId`, `slotStartTime`, `slotEndTime`, `version`, `isLocked`
- `GSI1PK` = `AIRPORT#{airportId}`
- `GSI1SK` = `SLOT#{slotStartTime}#RUNWAY#{runwayId}`

Access patterns:
- Upsert latest assignment per flight: `PutItem(PK, SK)`
- List allocations in window: `Query GSI1 BETWEEN SLOT#from AND SLOT#to~`

## Table 3: `IdempotencyTable`

Keys:
- `PK` = request scope (`flight-request#{airlineId}`)
- `SK` = `idempotencyKey`

Attributes:
- `requestHash`, `statusCode`, `responseBody`, `createdAt`, `expiresAt`, `ttl`

Access patterns:
- Read existing idempotent result: `GetItem(PK, SK)`
- First-write wins: `PutItem` with conditional expression

## Table 4: `DedupeTable`

Keys:
- `PK` = `eventId`

Attributes:
- `createdAt`, `ttl`

Access patterns:
- Acquire processing lock for event: conditional `PutItem(attribute_not_exists(PK))`
- Duplicate message short-circuit when condition fails

## Table 5: `CapacityTable`

Keys:
- `PK` = `AIRPORT#{airportId}`
- `SK` = `CONFIG#CAPACITY`

Attributes:
- `runwayCount`, `slotMinutes`, `lookaheadMinutes`, `holdingLookaheadMinutes`, `maxConsecutivePerAirline`, `freezeWindowMinutes`, `updatedAt`, `updatedBy`

Access patterns:
- Read allocation parameters: `GetItem(PK, SK)`
- Admin update: `PutItem(PK, SK)`
