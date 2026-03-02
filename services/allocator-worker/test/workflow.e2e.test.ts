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
} from '@skyflow/application';

describe('e2e workflow', () => {
  it('queues request and assigns a landing slot via worker processing', async () => {
    const flights = new InMemoryFlightRepository();
    const slots = new InMemorySlotRepository();
    const dedupe = new InMemoryDedupeRepository();
    const events = new InMemoryEventPublisher();
    const idempotency = new InMemoryIdempotencyRepository();
    const workflow = new InMemoryWorkflowQueue();
    const capacity = new InMemoryCapacityRepository({
      airportId: 'SFO',
      runwayCount: 1,
      slotMinutes: 5,
      lookaheadMinutes: 120,
      holdingLookaheadMinutes: 45,
      maxConsecutivePerAirline: 2,
      freezeWindowMinutes: 10,
      updatedAt: '2026-03-02T00:00:00.000Z',
      updatedBy: 'system'
    });

    const accepted = await submitFlightRequest(
      {
        airportId: 'SFO',
        airlineId: 'ALPHA',
        flightId: 'SF101',
        scheduledArrivalTime: '2026-03-02T12:00:00.000Z',
        aircraftType: 'A320',
        priority: 'NORMAL',
        idempotencyKey: 'idem-101',
        correlationId: 'corr-101',
        requestTime: '2026-03-02T11:55:00.000Z'
      },
      { flights, workflow, idempotency }
    );

    expect(accepted.status).toBe('QUEUED');
    expect(workflow.messages).toHaveLength(1);

    const outcome = await processWorkflowMessage(workflow.messages[0], '2026-03-02T12:00:00.000Z', {
      flights,
      slots,
      capacity,
      dedupe,
      events
    });

    expect(outcome.assignedCount).toBe(1);
    expect(events.events.some((event) => event.eventType === 'skyflow.slot.assigned.v1')).toBe(true);
  });
});
