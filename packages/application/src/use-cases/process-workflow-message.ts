import {
  allocateSlots,
  buildFairnessIndicators,
  computeCongestionIndex,
  rebalanceSlots,
  type AllocationCandidate,
  type DomainEventEnvelope,
  type DomainEventType,
  type FlightRequest,
  type SlotAllocation
} from '@skyflow/domain';

import type {
  CapacityRepository,
  DomainEventPublisher,
  EventDedupeRepository,
  FlightRepository,
  SlotRepository,
  WorkflowMessage
} from '../types.js';

export interface ProcessWorkflowOutput {
  assignedCount: number;
  holdingCount: number;
  rebalanceCount: number;
  conflictCount: number;
  congestionIndex: number;
  fairnessIndicators: Record<string, number>;
}

function toCandidate(
  flights: FlightRequest[],
  existingAllocations: SlotAllocation[]
): AllocationCandidate[] {
  return flights.map((flight) => ({
    flight,
    existingAllocation: existingAllocations.find((allocation) => allocation.flightId === flight.flightId)
  }));
}

async function publishAssignmentEvents(
  publisher: DomainEventPublisher,
  message: WorkflowMessage,
  allocations: SlotAllocation[],
  existingAllocations: SlotAllocation[]
): Promise<void> {
  for (const allocation of allocations) {
    const isReassigned = existingAllocations.some(
      (existing) =>
        existing.flightId === allocation.flightId &&
        existing.slotStartTime !== allocation.slotStartTime
    );

    const eventType: DomainEventType = isReassigned
      ? 'skyflow.slot.reassigned.v1'
      : 'skyflow.slot.assigned.v1';

    const event: DomainEventEnvelope<typeof eventType, Record<string, unknown>> = {
      eventId: `${message.eventId}#${allocation.flightId}`,
      correlationId: message.correlationId,
      causationId: message.eventId,
      eventType,
      eventVersion: '1.0.0',
      eventTime: new Date().toISOString(),
      detail: {
        airportId: message.airportId,
        flightId: allocation.flightId,
        airlineId: allocation.airlineId,
        runwayId: allocation.runwayId,
        slotStartTime: allocation.slotStartTime,
        slotEndTime: allocation.slotEndTime,
        isRebalance: isReassigned
      }
    };

    await publisher.publish(event);
  }
}

async function publishHoldingEvents(
  publisher: DomainEventPublisher,
  message: WorkflowMessage,
  holdingFlights: FlightRequest[]
): Promise<void> {
  for (const flight of holdingFlights) {
    const event: DomainEventEnvelope<'skyflow.flight.holding.v1', Record<string, unknown>> = {
      eventId: `${message.eventId}#holding#${flight.flightId}`,
      correlationId: message.correlationId,
      causationId: message.eventId,
      eventType: 'skyflow.flight.holding.v1',
      eventVersion: '1.0.0',
      eventTime: new Date().toISOString(),
      detail: {
        airportId: message.airportId,
        flightId: flight.flightId,
        reason: 'No available slot in current lookahead window',
        nextReattemptAt: new Date(Date.now() + 5 * 60_000).toISOString()
      }
    };

    await publisher.publish(event);
  }
}

export async function processWorkflowMessage(
  message: WorkflowMessage,
  now: string,
  dependencies: {
    flights: FlightRepository;
    slots: SlotRepository;
    capacity: CapacityRepository;
    dedupe: EventDedupeRepository;
    events: DomainEventPublisher;
  }
): Promise<ProcessWorkflowOutput> {
  const acquired = await dependencies.dedupe.acquire(
    message.eventId,
    Math.floor(new Date(now).getTime() / 1000) + 7 * 24 * 3600
  );
  if (!acquired) {
    return {
      assignedCount: 0,
      holdingCount: 0,
      rebalanceCount: 0,
      conflictCount: 0,
      congestionIndex: 0,
      fairnessIndicators: {}
    };
  }

  const capacity = await dependencies.capacity.getCapacity(message.airportId);
  const activeFlights = await dependencies.flights.listActiveFlights(message.airportId);
  const from = now;
  const to = new Date(
    new Date(now).getTime() + capacity.holdingLookaheadMinutes * 60_000
  ).toISOString();

  const existingAllocations = await dependencies.slots.listAllocations(message.airportId, from, to);
  const candidates = toCandidate(activeFlights, existingAllocations);

  const outcome =
    message.eventType === 'DELAY_UPDATED'
      ? rebalanceSlots({
          airportId: message.airportId,
          now,
          delayedFlightId: message.flightId,
          candidates,
          existingAllocations,
          capacity
        })
      : allocateSlots({
          airportId: message.airportId,
          now,
          candidates,
          existingAllocations,
          capacity
        });

  await dependencies.slots.upsertAllocations(message.airportId, outcome.assigned, now);
  await dependencies.flights.updateFlightStatuses(
    message.airportId,
    outcome.assigned.map((allocation) => allocation.flightId),
    outcome.holding.map((flight) => flight.flightId),
    now
  );

  await publishAssignmentEvents(dependencies.events, message, outcome.assigned, existingAllocations);
  await publishHoldingEvents(dependencies.events, message, outcome.holding);

  return {
    assignedCount: outcome.assigned.length,
    holdingCount: outcome.holding.length,
    rebalanceCount: outcome.rebalanceCount,
    conflictCount: outcome.conflicts.length,
    congestionIndex: computeCongestionIndex(capacity, outcome.assigned.length),
    fairnessIndicators: buildFairnessIndicators(outcome.assigned)
  };
}
