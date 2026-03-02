import { describe, expect, it } from 'vitest';
import type { DomainEventEnvelope, DomainEventType } from '@skyflow/domain';
import {
  InMemoryCapacityRepository,
  InMemoryDedupeRepository,
  InMemoryEventPublisher,
  InMemoryFlightRepository,
  InMemorySlotRepository,
  type DomainEventPublisher
} from '@skyflow/application';
import { Logger } from '@skyflow/shared';

import { createWorkerHandler } from '../src/worker.js';

class ConditionalFailurePublisher implements DomainEventPublisher {
  private readonly events = new InMemoryEventPublisher();

  async publish<TType extends DomainEventType, TDetail>(
    event: DomainEventEnvelope<TType, TDetail>
  ): Promise<void> {
    if (event.causationId === 'evt-fail' && event.eventType !== 'skyflow.flight.failed.v1') {
      throw new Error('simulated eventbridge failure');
    }
    await this.events.publish(event);
  }

  getPublished(): DomainEventEnvelope<DomainEventType, unknown>[] {
    return this.events.events;
  }
}

describe('worker partial batch response', () => {
  it('returns only failed message IDs when one record fails', async () => {
    const events = new ConditionalFailurePublisher();
    const deps = {
      flights: new InMemoryFlightRepository(),
      slots: new InMemorySlotRepository(),
      capacity: new InMemoryCapacityRepository({
        airportId: 'SFO',
        runwayCount: 1,
        slotMinutes: 5,
        lookaheadMinutes: 120,
        holdingLookaheadMinutes: 45,
        maxConsecutivePerAirline: 2,
        freezeWindowMinutes: 10,
        updatedAt: '2026-03-02T00:00:00.000Z',
        updatedBy: 'system'
      }),
      dedupe: new InMemoryDedupeRepository(),
      events,
      logger: new Logger('worker-test')
    };

    await deps.flights.putFlightRequest({
      airportId: 'SFO',
      flightId: 'SF100',
      airlineId: 'ALPHA',
      scheduledArrivalTime: '2026-03-02T12:00:00.000Z',
      aircraftType: 'A320',
      priority: 'NORMAL',
      status: 'REQUESTED',
      lastUpdatedAt: '2026-03-02T11:55:00.000Z'
    });

    const handler = createWorkerHandler(deps);
    const response = await handler({
      Records: [
        {
          messageId: 'msg-success',
          body: JSON.stringify({
            eventId: 'evt-success',
            correlationId: 'corr-success',
            eventType: 'FLIGHT_REQUESTED',
            airportId: 'SFO',
            flightId: 'SF100',
            eventTime: '2026-03-02T11:55:00.000Z'
          })
        },
        {
          messageId: 'msg-fail',
          body: JSON.stringify({
            eventId: 'evt-fail',
            correlationId: 'corr-fail',
            eventType: 'FLIGHT_REQUESTED',
            airportId: 'SFO',
            flightId: 'SF100',
            eventTime: '2026-03-02T11:55:00.000Z'
          })
        }
      ]
    } as never);

    expect(response.batchItemFailures).toEqual([{ itemIdentifier: 'msg-fail' }]);
    expect(
      events.getPublished().some((event) => event.eventType === 'skyflow.flight.failed.v1')
    ).toBe(true);
  });
});
