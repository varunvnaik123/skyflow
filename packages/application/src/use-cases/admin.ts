import type { CapacityConfig } from '@skyflow/domain';

import type { CapacityRepository, SlotRepository } from '../types.js';

export async function updateCapacityConfig(
  config: CapacityConfig,
  dependencies: {
    capacity: CapacityRepository;
  }
): Promise<void> {
  await dependencies.capacity.upsertCapacity(config);
}

export async function getCongestionMetrics(
  airportId: string,
  nowIso: string,
  dependencies: {
    capacity: CapacityRepository;
    slots: SlotRepository;
  }
): Promise<{
  assignedSlots: number;
  runwayCount: number;
  slotMinutes: number;
  congestionIndex: number;
}> {
  const capacity = await dependencies.capacity.getCapacity(airportId);
  const to = new Date(
    new Date(nowIso).getTime() + capacity.holdingLookaheadMinutes * 60_000
  ).toISOString();
  const allocations = await dependencies.slots.listAllocations(airportId, nowIso, to);

  const slotsPerWindow =
    (capacity.holdingLookaheadMinutes / capacity.slotMinutes) * capacity.runwayCount;

  return {
    assignedSlots: allocations.length,
    runwayCount: capacity.runwayCount,
    slotMinutes: capacity.slotMinutes,
    congestionIndex: slotsPerWindow === 0 ? 0 : Number((allocations.length / slotsPerWindow).toFixed(2))
  };
}
