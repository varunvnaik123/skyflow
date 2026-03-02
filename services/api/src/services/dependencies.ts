import type {
  CapacityRepository,
  FlightRepository,
  IdempotencyRepository,
  SlotRepository,
  WorkflowQueue
} from '@skyflow/application';
import {
  DynamoCapacityRepository,
  DynamoFlightRepository,
  DynamoIdempotencyRepository,
  DynamoSlotRepository,
  SqsWorkflowQueue,
  buildAwsClients,
  type AdapterConfig
} from '@skyflow/aws-adapters';
import { Logger } from '@skyflow/shared';

export interface ApiDependencies {
  flights: FlightRepository;
  slots: SlotRepository;
  capacity: CapacityRepository;
  idempotency: IdempotencyRepository;
  workflow: WorkflowQueue;
  logger: Logger;
}

function getEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing environment variable: ${name}`);
  }

  return value;
}

export function buildAdapterConfigFromEnv(): AdapterConfig {
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

export function createApiDependencies(): ApiDependencies {
  const config = buildAdapterConfigFromEnv();
  const clients = buildAwsClients();

  return {
    flights: new DynamoFlightRepository(clients, config),
    slots: new DynamoSlotRepository(clients, config),
    capacity: new DynamoCapacityRepository(clients, config),
    idempotency: new DynamoIdempotencyRepository(clients, config),
    workflow: new SqsWorkflowQueue(clients, config),
    logger: new Logger('skyflow-api')
  };
}
