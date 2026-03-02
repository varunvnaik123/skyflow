import type {
  CapacityRepository,
  DomainEventPublisher,
  EventDedupeRepository,
  FlightRepository,
  SlotRepository
} from '@skyflow/application';
import {
  DynamoCapacityRepository,
  DynamoDedupeRepository,
  DynamoFlightRepository,
  DynamoSlotRepository,
  EventBridgeDomainEventPublisher,
  buildAwsClients,
  type AdapterConfig
} from '@skyflow/aws-adapters';
import { Logger } from '@skyflow/shared';

export interface WorkerDependencies {
  flights: FlightRepository;
  slots: SlotRepository;
  capacity: CapacityRepository;
  dedupe: EventDedupeRepository;
  events: DomainEventPublisher;
  logger: Logger;
}

function getEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing environment variable: ${name}`);
  }

  return value;
}

function buildConfig(): AdapterConfig {
  return {
    flightsTableName: getEnv('FLIGHTS_TABLE_NAME'),
    slotsTableName: getEnv('SLOTS_TABLE_NAME'),
    idempotencyTableName: getEnv('IDEMPOTENCY_TABLE_NAME'),
    dedupeTableName: getEnv('DEDUPE_TABLE_NAME'),
    capacityTableName: getEnv('CAPACITY_TABLE_NAME'),
    workflowQueueUrl: getEnv('WORKFLOW_QUEUE_URL'),
    eventBusName: getEnv('EVENT_BUS_NAME')
  };
}

export function createWorkerDependencies(): WorkerDependencies {
  const config = buildConfig();
  const clients = buildAwsClients();

  return {
    flights: new DynamoFlightRepository(clients, config),
    slots: new DynamoSlotRepository(clients, config),
    capacity: new DynamoCapacityRepository(clients, config),
    dedupe: new DynamoDedupeRepository(clients, config),
    events: new EventBridgeDomainEventPublisher(clients, config),
    logger: new Logger('skyflow-allocator-worker')
  };
}
