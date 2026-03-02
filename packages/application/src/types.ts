import type {
  CapacityConfig,
  FlightRequest,
  SlotAllocation,
  DomainEventEnvelope,
  DomainEventType
} from '@skyflow/domain';

export type WorkflowEventType = 'FLIGHT_REQUESTED' | 'DELAY_UPDATED' | 'HOLDING_RETRY';

export interface WorkflowMessage {
  eventId: string;
  correlationId: string;
  eventType: WorkflowEventType;
  airportId: string;
  flightId: string;
  eventTime: string;
}

export interface RequestRecord {
  idempotencyKey: string;
  scope: string;
  requestHash: string;
  statusCode: number;
  responseBody: string;
  createdAt: string;
  expiresAt: number;
}

export interface FlightRepository {
  putFlightRequest(request: FlightRequest): Promise<void>;
  updateDelay(
    airportId: string,
    flightId: string,
    newArrivalTime: string,
    now: string,
    reason: string
  ): Promise<void>;
  getFlight(airportId: string, flightId: string): Promise<FlightRequest | undefined>;
  listActiveFlights(airportId: string): Promise<FlightRequest[]>;
  updateFlightStatuses(
    airportId: string,
    assignedFlightIds: string[],
    holdingFlightIds: string[],
    now: string
  ): Promise<void>;
}

export interface SlotRepository {
  listAllocations(airportId: string, fromIso: string, toIso: string): Promise<SlotAllocation[]>;
  upsertAllocations(airportId: string, allocations: SlotAllocation[], now: string): Promise<void>;
}

export interface CapacityRepository {
  getCapacity(airportId: string): Promise<CapacityConfig>;
  upsertCapacity(config: CapacityConfig): Promise<void>;
}

export interface IdempotencyRepository {
  get(scope: string, idempotencyKey: string): Promise<RequestRecord | undefined>;
  put(record: RequestRecord): Promise<void>;
}

export interface EventDedupeRepository {
  acquire(eventId: string, expiresAt: number): Promise<boolean>;
}

export interface WorkflowQueue {
  send(message: WorkflowMessage): Promise<void>;
}

export interface DomainEventPublisher {
  publish<TType extends DomainEventType, TDetail>(
    event: DomainEventEnvelope<TType, TDetail>
  ): Promise<void>;
}
