import type {
  CapacityConfig,
  DomainEventEnvelope,
  DomainEventType,
  FlightRequest,
  SlotAllocation
} from '@skyflow/domain';

import type {
  CapacityRepository,
  DomainEventPublisher,
  EventDedupeRepository,
  FlightRepository,
  IdempotencyRepository,
  RequestRecord,
  SlotRepository,
  WorkflowMessage,
  WorkflowQueue
} from '../types.js';

export class InMemoryFlightRepository implements FlightRepository {
  private readonly flights = new Map<string, FlightRequest>();

  async putFlightRequest(request: FlightRequest): Promise<void> {
    this.flights.set(`${request.airportId}#${request.flightId}`, request);
  }

  async updateDelay(
    airportId: string,
    flightId: string,
    newArrivalTime: string,
    now: string,
    reason: string
  ): Promise<void> {
    void reason;
    for (const [key, flight] of this.flights.entries()) {
      if (flight.flightId === flightId && flight.airportId === airportId) {
        this.flights.set(key, {
          ...flight,
          scheduledArrivalTime: newArrivalTime,
          status: 'DELAYED',
          lastUpdatedAt: now
        });
      }
    }
  }

  async getFlight(airportId: string, flightId: string): Promise<FlightRequest | undefined> {
    for (const flight of this.flights.values()) {
      if (flight.flightId === flightId && flight.airportId === airportId) {
        return flight;
      }
    }

    return undefined;
  }

  async listActiveFlights(airportId: string): Promise<FlightRequest[]> {
    return [...this.flights.values()].filter(
      (flight) => flight.airportId === airportId && !['CANCELLED', 'FAILED'].includes(flight.status)
    );
  }

  async updateFlightStatuses(
    _airportId: string,
    assignedFlightIds: string[],
    holdingFlightIds: string[],
    now: string
  ): Promise<void> {
    for (const [key, flight] of this.flights.entries()) {
      if (assignedFlightIds.includes(flight.flightId)) {
        this.flights.set(key, { ...flight, status: 'ASSIGNED', lastUpdatedAt: now });
      }

      if (holdingFlightIds.includes(flight.flightId)) {
        this.flights.set(key, { ...flight, status: 'HOLDING', lastUpdatedAt: now });
      }
    }
  }
}

export class InMemorySlotRepository implements SlotRepository {
  private allocations: SlotAllocation[] = [];

  async listAllocations(
    _airportId: string,
    fromIso: string,
    toIso: string
  ): Promise<SlotAllocation[]> {
    const from = new Date(fromIso);
    const to = new Date(toIso);
    return this.allocations.filter((allocation) => {
      const start = new Date(allocation.slotStartTime);
      return start >= from && start <= to;
    });
  }

  async upsertAllocations(
    _airportId: string,
    allocations: SlotAllocation[],
    _now: string
  ): Promise<void> {
    void _airportId;
    void _now;
    const byFlight = new Map(
      this.allocations.map((allocation) => [allocation.flightId, allocation])
    );
    for (const allocation of allocations) {
      byFlight.set(allocation.flightId, allocation);
    }

    this.allocations = [...byFlight.values()];
  }
}

export class InMemoryCapacityRepository implements CapacityRepository {
  constructor(private config: CapacityConfig) {}

  async getCapacity(_airportId: string): Promise<CapacityConfig> {
    void _airportId;
    return this.config;
  }

  async upsertCapacity(config: CapacityConfig): Promise<void> {
    this.config = config;
  }
}

export class InMemoryIdempotencyRepository implements IdempotencyRepository {
  private readonly records = new Map<string, RequestRecord>();

  async get(scope: string, idempotencyKey: string): Promise<RequestRecord | undefined> {
    return this.records.get(`${scope}#${idempotencyKey}`);
  }

  async put(record: RequestRecord): Promise<void> {
    this.records.set(`${record.scope}#${record.idempotencyKey}`, record);
  }
}

export class InMemoryDedupeRepository implements EventDedupeRepository {
  private readonly ids = new Set<string>();

  async acquire(eventId: string, _expiresAt: number): Promise<boolean> {
    void _expiresAt;
    if (this.ids.has(eventId)) {
      return false;
    }

    this.ids.add(eventId);
    return true;
  }
}

export class InMemoryWorkflowQueue implements WorkflowQueue {
  public readonly messages: WorkflowMessage[] = [];

  async send(message: WorkflowMessage): Promise<void> {
    this.messages.push(message);
  }
}

export class InMemoryEventPublisher implements DomainEventPublisher {
  public readonly events: DomainEventEnvelope<DomainEventType, unknown>[] = [];

  async publish<TType extends DomainEventType, TDetail>(
    event: DomainEventEnvelope<TType, TDetail>
  ): Promise<void> {
    this.events.push(event as DomainEventEnvelope<DomainEventType, unknown>);
  }
}
