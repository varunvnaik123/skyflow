import type {
  AllocationCandidate,
  AllocationConflict,
  AllocationEngineInput,
  AllocationOutcome,
  CapacityConfig,
  FlightPriority,
  RebalanceInput,
  SlotAllocation
} from './types.js';

const PRIORITY_SCORE: Record<FlightPriority, number> = {
  EMERGENCY: 300,
  INTERNATIONAL: 200,
  NORMAL: 100
};

interface TimeSlot {
  runwayId: string;
  slotStart: Date;
  slotEnd: Date;
}

function toIso(date: Date): string {
  return date.toISOString();
}

function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

function parseIso(value: string): Date {
  return new Date(value);
}

function generateSlots(
  now: Date,
  capacity: CapacityConfig,
  startAt?: Date,
  endAt?: Date
): TimeSlot[] {
  const start = startAt ?? now;
  const limit = endAt ?? addMinutes(start, capacity.lookaheadMinutes);
  const slots: TimeSlot[] = [];

  for (let t = new Date(start); t < limit; t = addMinutes(t, capacity.slotMinutes)) {
    for (let runwayIdx = 1; runwayIdx <= capacity.runwayCount; runwayIdx += 1) {
      slots.push({
        runwayId: `RWY-${runwayIdx}`,
        slotStart: new Date(t),
        slotEnd: addMinutes(t, capacity.slotMinutes)
      });
    }
  }

  return slots;
}

function compareCandidates(a: AllocationCandidate, b: AllocationCandidate): number {
  const priorityDiff = PRIORITY_SCORE[b.flight.priority] - PRIORITY_SCORE[a.flight.priority];
  if (priorityDiff !== 0) {
    return priorityDiff;
  }

  const arrivalDiff =
    parseIso(a.flight.scheduledArrivalTime).getTime() -
    parseIso(b.flight.scheduledArrivalTime).getTime();
  if (arrivalDiff !== 0) {
    return arrivalDiff;
  }

  return a.flight.flightId.localeCompare(b.flight.flightId);
}

function isCandidateAvailableForSlot(candidate: AllocationCandidate, slot: TimeSlot): boolean {
  const arrival = parseIso(candidate.flight.scheduledArrivalTime);
  return arrival <= slot.slotStart;
}

function fairnessConstrained(
  candidate: AllocationCandidate,
  sequence: string[],
  capacity: CapacityConfig,
  samePriorityAlternativesExist: boolean
): boolean {
  if (candidate.flight.priority === 'EMERGENCY') {
    return false;
  }

  const tail = sequence.slice(-capacity.maxConsecutivePerAirline);
  const atLimit =
    tail.length === capacity.maxConsecutivePerAirline &&
    tail.every((airline) => airline === candidate.flight.airlineId);

  return atLimit && samePriorityAlternativesExist;
}

function selectCandidateForSlot(
  slot: TimeSlot,
  pending: AllocationCandidate[],
  sequence: string[],
  capacity: CapacityConfig
): AllocationCandidate | undefined {
  const available = pending.filter((candidate) => isCandidateAvailableForSlot(candidate, slot));
  if (available.length === 0) {
    return undefined;
  }

  available.sort(compareCandidates);

  for (const candidate of available) {
    const alternativeExists = available.some(
      (item) =>
        item.flight.airlineId !== candidate.flight.airlineId &&
        PRIORITY_SCORE[item.flight.priority] === PRIORITY_SCORE[candidate.flight.priority]
    );

    if (!fairnessConstrained(candidate, sequence, capacity, alternativeExists)) {
      return candidate;
    }
  }

  return available[0];
}

function allocateWithCapacity(
  slots: TimeSlot[],
  pendingCandidates: AllocationCandidate[],
  capacity: CapacityConfig,
  initialSequence: string[] = [],
  startVersion = 1
): Pick<AllocationOutcome, 'assigned' | 'holding'> {
  const pending = [...pendingCandidates];
  const assigned: SlotAllocation[] = [];
  const sequence = [...initialSequence];

  for (const slot of slots) {
    const candidate = selectCandidateForSlot(slot, pending, sequence, capacity);
    if (!candidate) {
      continue;
    }

    pending.splice(
      pending.findIndex((item) => item.flight.flightId === candidate.flight.flightId),
      1
    );
    sequence.push(candidate.flight.airlineId);

    const priorVersion = candidate.existingAllocation?.version ?? 0;
    assigned.push({
      flightId: candidate.flight.flightId,
      airlineId: candidate.flight.airlineId,
      runwayId: slot.runwayId,
      slotStartTime: toIso(slot.slotStart),
      slotEndTime: toIso(slot.slotEnd),
      version: Math.max(startVersion, priorVersion + 1)
    });
  }

  return {
    assigned,
    holding: pending.map((item) => item.flight)
  };
}

export function detectConflicts(allocations: SlotAllocation[]): AllocationConflict[] {
  const conflicts: AllocationConflict[] = [];
  const groupedByRunway = new Map<string, SlotAllocation[]>();

  for (const allocation of allocations) {
    const existing = groupedByRunway.get(allocation.runwayId) ?? [];
    existing.push(allocation);
    groupedByRunway.set(allocation.runwayId, existing);
  }

  for (const [runwayId, runwayAllocations] of groupedByRunway.entries()) {
    runwayAllocations.sort(
      (a, b) => parseIso(a.slotStartTime).getTime() - parseIso(b.slotStartTime).getTime()
    );

    for (let i = 1; i < runwayAllocations.length; i += 1) {
      const previous = runwayAllocations[i - 1];
      const current = runwayAllocations[i];
      if (parseIso(previous.slotEndTime) > parseIso(current.slotStartTime)) {
        conflicts.push({
          runwayId,
          conflictingFlights: [previous.flightId, current.flightId],
          slotStartTime: current.slotStartTime,
          slotEndTime: previous.slotEndTime
        });
      }
    }
  }

  return conflicts;
}

export function allocateSlots(input: AllocationEngineInput): AllocationOutcome {
  const now = parseIso(input.now);
  const capacityWindowEnd = addMinutes(now, input.capacity.holdingLookaheadMinutes);
  const slots = generateSlots(now, input.capacity, now, capacityWindowEnd);

  const pendingCandidates = input.candidates.sort(compareCandidates);
  const result = allocateWithCapacity(slots, pendingCandidates, input.capacity);

  return {
    assigned: result.assigned,
    holding: result.holding,
    conflicts: detectConflicts(result.assigned),
    rebalanceCount: 0
  };
}

export function rebalanceSlots(input: RebalanceInput): AllocationOutcome {
  const now = parseIso(input.now);
  const freezeBoundary = addMinutes(now, input.capacity.freezeWindowMinutes);
  const slotEnd = addMinutes(now, input.capacity.holdingLookaheadMinutes);

  const locked = input.existingAllocations.filter(
    (allocation) =>
      allocation.flightId !== input.delayedFlightId &&
      (parseIso(allocation.slotStartTime) < freezeBoundary || allocation.isLocked)
  );

  const mutable = input.candidates.filter(
    (candidate) =>
      !locked.some((allocation) => allocation.flightId === candidate.flight.flightId) ||
      candidate.flight.flightId === input.delayedFlightId
  );

  const slots = generateSlots(now, input.capacity, freezeBoundary, slotEnd);
  const sortedLockedAirlineSequence = locked
    .sort((a, b) => parseIso(a.slotStartTime).getTime() - parseIso(b.slotStartTime).getTime())
    .map((item) => item.airlineId);

  const result = allocateWithCapacity(
    slots,
    mutable,
    input.capacity,
    sortedLockedAirlineSequence,
    2
  );
  const assignedByFlight = new Map<string, SlotAllocation>();
  for (const allocation of locked) {
    assignedByFlight.set(allocation.flightId, allocation);
  }
  for (const allocation of result.assigned) {
    assignedByFlight.set(allocation.flightId, allocation);
  }
  const assigned = [...assignedByFlight.values()];

  return {
    assigned,
    holding: result.holding,
    conflicts: detectConflicts(assigned),
    rebalanceCount: result.assigned.length
  };
}

export function computeCongestionIndex(capacity: CapacityConfig, assignedCount: number): number {
  const slotsPerHour = (60 / capacity.slotMinutes) * capacity.runwayCount;
  if (slotsPerHour <= 0) {
    return 0;
  }

  return Number((assignedCount / slotsPerHour).toFixed(2));
}

export function buildFairnessIndicators(allocations: SlotAllocation[]): Record<string, number> {
  const byAirline = new Map<string, number>();

  for (const allocation of allocations) {
    byAirline.set(allocation.airlineId, (byAirline.get(allocation.airlineId) ?? 0) + 1);
  }

  return Object.fromEntries(byAirline.entries());
}
