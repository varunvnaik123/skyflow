import { describe, expect, it } from 'vitest';

import {
  allocateSlots,
  detectConflicts,
  rebalanceSlots,
  type AllocationCandidate,
  type CapacityConfig,
  type FlightRequest,
  type SlotAllocation
} from '../src/index.js';

const BASE_CAPACITY: CapacityConfig = {
  airportId: 'SFO',
  runwayCount: 1,
  slotMinutes: 5,
  lookaheadMinutes: 120,
  holdingLookaheadMinutes: 30,
  maxConsecutivePerAirline: 1,
  freezeWindowMinutes: 10,
  updatedAt: '2026-03-02T00:00:00.000Z',
  updatedBy: 'system'
};

function buildFlight(
  flightId: string,
  airlineId: string,
  scheduledArrivalTime: string,
  priority: FlightRequest['priority']
): FlightRequest {
  return {
    airportId: 'SFO',
    flightId,
    airlineId,
    scheduledArrivalTime,
    aircraftType: 'A320',
    priority,
    status: 'REQUESTED',
    lastUpdatedAt: '2026-03-02T00:00:00.000Z'
  };
}

function candidate(flight: FlightRequest): AllocationCandidate {
  return { flight };
}

describe('allocateSlots', () => {
  it('prioritizes emergency flights first', () => {
    const input = {
      airportId: 'SFO',
      now: '2026-03-02T12:00:00.000Z',
      candidates: [
        candidate(buildFlight('F-1', 'ALPHA', '2026-03-02T12:00:00.000Z', 'NORMAL')),
        candidate(buildFlight('F-2', 'BRAVO', '2026-03-02T12:00:00.000Z', 'EMERGENCY'))
      ],
      existingAllocations: [],
      capacity: BASE_CAPACITY
    };

    const outcome = allocateSlots(input);
    expect(outcome.assigned[0]?.flightId).toBe('F-2');
  });

  it('applies fairness guardrail for same-priority airlines', () => {
    const input = {
      airportId: 'SFO',
      now: '2026-03-02T12:00:00.000Z',
      candidates: [
        candidate(buildFlight('F-1', 'ALPHA', '2026-03-02T12:00:00.000Z', 'NORMAL')),
        candidate(buildFlight('F-2', 'ALPHA', '2026-03-02T12:00:00.000Z', 'NORMAL')),
        candidate(buildFlight('F-3', 'BRAVO', '2026-03-02T12:00:00.000Z', 'NORMAL'))
      ],
      existingAllocations: [],
      capacity: BASE_CAPACITY
    };

    const outcome = allocateSlots(input);
    expect(outcome.assigned[0]?.airlineId).toBe('ALPHA');
    expect(outcome.assigned[1]?.airlineId).toBe('BRAVO');
  });

  it('places flights in holding when no slot is available', () => {
    const input = {
      airportId: 'SFO',
      now: '2026-03-02T12:00:00.000Z',
      candidates: [
        candidate(buildFlight('F-1', 'ALPHA', '2026-03-02T12:00:00.000Z', 'NORMAL')),
        candidate(buildFlight('F-2', 'BRAVO', '2026-03-02T13:00:00.000Z', 'NORMAL'))
      ],
      existingAllocations: [],
      capacity: {
        ...BASE_CAPACITY,
        holdingLookaheadMinutes: 5
      }
    };

    const outcome = allocateSlots(input);
    expect(outcome.holding.map((f) => f.flightId)).toContain('F-2');
  });
});

describe('detectConflicts', () => {
  it('detects overlapping slots on the same runway', () => {
    const allocations: SlotAllocation[] = [
      {
        flightId: 'F-1',
        airlineId: 'ALPHA',
        runwayId: 'RWY-1',
        slotStartTime: '2026-03-02T12:00:00.000Z',
        slotEndTime: '2026-03-02T12:05:00.000Z',
        version: 1
      },
      {
        flightId: 'F-2',
        airlineId: 'BRAVO',
        runwayId: 'RWY-1',
        slotStartTime: '2026-03-02T12:04:00.000Z',
        slotEndTime: '2026-03-02T12:09:00.000Z',
        version: 1
      }
    ];

    const conflicts = detectConflicts(allocations);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.conflictingFlights).toEqual(['F-1', 'F-2']);
  });
});

describe('rebalanceSlots', () => {
  it('preserves locked flights and reassigns mutable flights on delay', () => {
    const candidates = [
      candidate(buildFlight('F-1', 'ALPHA', '2026-03-02T12:00:00.000Z', 'NORMAL')),
      candidate(buildFlight('F-2', 'BRAVO', '2026-03-02T12:10:00.000Z', 'NORMAL'))
    ];

    const existingAllocations: SlotAllocation[] = [
      {
        flightId: 'F-1',
        airlineId: 'ALPHA',
        runwayId: 'RWY-1',
        slotStartTime: '2026-03-02T12:05:00.000Z',
        slotEndTime: '2026-03-02T12:10:00.000Z',
        version: 1,
        isLocked: true
      }
    ];

    const outcome = rebalanceSlots({
      airportId: 'SFO',
      now: '2026-03-02T12:00:00.000Z',
      candidates,
      existingAllocations,
      delayedFlightId: 'F-2',
      capacity: BASE_CAPACITY
    });

    expect(outcome.assigned.some((a) => a.flightId === 'F-1' && a.isLocked)).toBe(true);
    expect(outcome.assigned.some((a) => a.flightId === 'F-2')).toBe(true);
    expect(outcome.rebalanceCount).toBeGreaterThan(0);
  });

  it('does not emit duplicate allocations when delayed flight was previously locked', () => {
    const delayedFlight = candidate(
      buildFlight('F-LOCKED', 'ALPHA', '2026-03-02T12:02:00.000Z', 'NORMAL')
    );
    const otherFlight = candidate(
      buildFlight('F-OTHER', 'BRAVO', '2026-03-02T12:08:00.000Z', 'NORMAL')
    );

    const existingAllocations: SlotAllocation[] = [
      {
        flightId: 'F-LOCKED',
        airlineId: 'ALPHA',
        runwayId: 'RWY-1',
        slotStartTime: '2026-03-02T12:05:00.000Z',
        slotEndTime: '2026-03-02T12:10:00.000Z',
        version: 1,
        isLocked: true
      },
      {
        flightId: 'F-OTHER',
        airlineId: 'BRAVO',
        runwayId: 'RWY-1',
        slotStartTime: '2026-03-02T12:10:00.000Z',
        slotEndTime: '2026-03-02T12:15:00.000Z',
        version: 1
      }
    ];

    const outcome = rebalanceSlots({
      airportId: 'SFO',
      now: '2026-03-02T12:00:00.000Z',
      delayedFlightId: 'F-LOCKED',
      candidates: [delayedFlight, otherFlight],
      existingAllocations,
      capacity: BASE_CAPACITY
    });

    const byFlight = new Map(
      outcome.assigned.map((allocation) => [allocation.flightId, allocation])
    );
    expect(byFlight.size).toBe(outcome.assigned.length);
    expect(byFlight.has('F-LOCKED')).toBe(true);
    expect(byFlight.has('F-OTHER')).toBe(true);
  });
});
