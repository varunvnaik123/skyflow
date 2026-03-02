import type { FlightPriority } from './types.js';

export type DomainEventType =
  | 'skyflow.flight.requested.v1'
  | 'skyflow.flight.delay-updated.v1'
  | 'skyflow.slot.assigned.v1'
  | 'skyflow.slot.reassigned.v1'
  | 'skyflow.flight.holding.v1'
  | 'skyflow.flight.failed.v1';

export interface DomainEventEnvelope<TType extends DomainEventType, TDetail> {
  eventId: string;
  correlationId: string;
  causationId?: string;
  eventType: TType;
  eventVersion: '1.0.0';
  eventTime: string;
  detail: TDetail;
}

export interface FlightRequestedDetail {
  airportId: string;
  flightId: string;
  airlineId: string;
  scheduledArrivalTime: string;
  aircraftType: string;
  priority: FlightPriority;
}

export interface DelayUpdatedDetail {
  airportId: string;
  flightId: string;
  newArrivalTime: string;
  delayReason: string;
}

export interface SlotAssignedDetail {
  airportId: string;
  flightId: string;
  airlineId: string;
  runwayId: string;
  slotStartTime: string;
  slotEndTime: string;
  isRebalance: boolean;
}

export interface HoldingDetail {
  airportId: string;
  flightId: string;
  reason: string;
  nextReattemptAt: string;
}

export interface FlightFailedDetail {
  airportId: string;
  flightId: string;
  reason: string;
}
