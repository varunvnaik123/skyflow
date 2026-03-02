import { describe, expect, it } from 'vitest';

import {
  InMemoryCapacityRepository,
  InMemoryDedupeRepository,
  InMemoryEventPublisher,
  InMemoryFlightRepository,
  InMemoryIdempotencyRepository,
  InMemorySlotRepository,
  InMemoryWorkflowQueue,
  processWorkflowMessage,
  submitFlightRequest
} from '../src/index.js';

describe('submitFlightRequest', () => {
  it('returns same response for same idempotency key and payload', async () => {
    const flights = new InMemoryFlightRepository();
    const idempotency = new InMemoryIdempotencyRepository();
    const workflow = new InMemoryWorkflowQueue();

    const input = {
      airportId: 'SFO',
      airlineId: 'ALPHA',
      flightId: 'F-1',
      scheduledArrivalTime: '2026-03-02T12:00:00.000Z',
      aircraftType: 'A320',
      priority: 'NORMAL' as const,
      idempotencyKey: 'idem-123',
      correlationId: 'corr-1',
      requestTime: '2026-03-02T11:00:00.000Z'
    };

    const first = await submitFlightRequest(input, { flights, idempotency, workflow });
    const second = await submitFlightRequest(input, { flights, idempotency, workflow });

    expect(second.requestId).toBe(first.requestId);
    expect(workflow.messages).toHaveLength(1);
  });
});

describe('processWorkflowMessage', () => {
  it('processes workflow message effectively once and emits events', async () => {
    const flights = new InMemoryFlightRepository();
    const slots = new InMemorySlotRepository();
    const dedupe = new InMemoryDedupeRepository();
    const events = new InMemoryEventPublisher();
    const capacity = new InMemoryCapacityRepository({
      airportId: 'SFO',
      runwayCount: 1,
      slotMinutes: 5,
      lookaheadMinutes: 60,
      holdingLookaheadMinutes: 30,
      maxConsecutivePerAirline: 2,
      freezeWindowMinutes: 10,
      updatedAt: '2026-03-02T00:00:00.000Z',
      updatedBy: 'system'
    });

    await flights.putFlightRequest({
      airportId: 'SFO',
      flightId: 'F-1',
      airlineId: 'ALPHA',
      scheduledArrivalTime: '2026-03-02T12:00:00.000Z',
      aircraftType: 'A320',
      priority: 'NORMAL',
      status: 'REQUESTED',
      lastUpdatedAt: '2026-03-02T11:00:00.000Z'
    });

    const message = {
      eventId: 'evt-1',
      correlationId: 'corr-1',
      eventType: 'FLIGHT_REQUESTED' as const,
      airportId: 'SFO',
      flightId: 'F-1',
      eventTime: '2026-03-02T11:00:00.000Z'
    };

    const first = await processWorkflowMessage(message, '2026-03-02T12:00:00.000Z', {
      flights,
      slots,
      capacity,
      dedupe,
      events
    });

    const second = await processWorkflowMessage(message, '2026-03-02T12:00:00.000Z', {
      flights,
      slots,
      capacity,
      dedupe,
      events
    });

    expect(first.assignedCount).toBe(1);
    expect(second.assignedCount).toBe(0);
    expect(events.events.length).toBeGreaterThan(0);
  });
});
