export type FlightPriority = 'NORMAL' | 'INTERNATIONAL' | 'EMERGENCY';

export type FlightStatus =
  | 'REQUESTED'
  | 'ASSIGNED'
  | 'HOLDING'
  | 'DELAYED'
  | 'FAILED'
  | 'CANCELLED';

export interface FlightConstraints {
  maxDelayMinutes?: number;
  preferredRunwayId?: string;
}

export interface FlightRequest {
  airportId: string;
  flightId: string;
  airlineId: string;
  scheduledArrivalTime: string;
  aircraftType: string;
  priority: FlightPriority;
  constraints?: FlightConstraints;
  status: FlightStatus;
  lastUpdatedAt: string;
}

export interface DelayUpdate {
  flightId: string;
  newArrivalTime: string;
  delayReason: string;
  observedAt: string;
}

export interface SlotAllocation {
  airportId?: string;
  flightId: string;
  airlineId: string;
  runwayId: string;
  slotStartTime: string;
  slotEndTime: string;
  version: number;
  isLocked?: boolean;
}

export interface CapacityConfig {
  airportId: string;
  runwayCount: number;
  slotMinutes: number;
  lookaheadMinutes: number;
  maxConsecutivePerAirline: number;
  holdingLookaheadMinutes: number;
  freezeWindowMinutes: number;
  updatedAt: string;
  updatedBy: string;
}

export interface AllocationCandidate {
  flight: FlightRequest;
  existingAllocation?: SlotAllocation;
}

export interface AllocationOutcome {
  assigned: SlotAllocation[];
  holding: FlightRequest[];
  conflicts: AllocationConflict[];
  rebalanceCount: number;
}

export interface AllocationConflict {
  runwayId: string;
  conflictingFlights: string[];
  slotStartTime: string;
  slotEndTime: string;
}

export interface AllocationEngineInput {
  airportId: string;
  now: string;
  candidates: AllocationCandidate[];
  existingAllocations: SlotAllocation[];
  capacity: CapacityConfig;
}

export interface RebalanceInput extends AllocationEngineInput {
  delayedFlightId: string;
}
