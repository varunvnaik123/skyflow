import {
  BatchWriteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand
} from '@aws-sdk/lib-dynamodb';
import { PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { SendMessageCommand } from '@aws-sdk/client-sqs';
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
} from '@skyflow/application';
import type {
  CapacityConfig,
  DomainEventEnvelope,
  DomainEventType,
  FlightRequest,
  SlotAllocation
} from '@skyflow/domain';
import { retryWithBackoff } from '@skyflow/shared';

import type { AwsAdapterClients } from './clients.js';

export interface AdapterConfig {
  flightsTableName: string;
  slotsTableName: string;
  idempotencyTableName: string;
  dedupeTableName: string;
  capacityTableName: string;
  workflowQueueUrl: string;
  eventBusName: string;
}

function activeKey(status: FlightRequest['status'], airportId: string): string {
  if (['FAILED', 'CANCELLED'].includes(status)) {
    return `TERMINAL#${airportId}`;
  }

  return `ACTIVE#${airportId}`;
}

export class DynamoFlightRepository implements FlightRepository {
  constructor(
    private readonly clients: AwsAdapterClients,
    private readonly config: AdapterConfig
  ) {}

  async putFlightRequest(request: FlightRequest): Promise<void> {
    await this.clients.ddb.send(
      new PutCommand({
        TableName: this.config.flightsTableName,
        Item: {
          PK: `AIRPORT#${request.airportId}`,
          SK: `FLIGHT#${request.flightId}`,
          GSI1PK: activeKey(request.status, request.airportId),
          GSI1SK: request.scheduledArrivalTime,
          ...request
        }
      })
    );
  }

  async updateDelay(
    airportId: string,
    flightId: string,
    newArrivalTime: string,
    now: string,
    reason: string
  ): Promise<void> {
    await this.clients.ddb.send(
      new UpdateCommand({
        TableName: this.config.flightsTableName,
        Key: {
          PK: `AIRPORT#${airportId}`,
          SK: `FLIGHT#${flightId}`
        },
        UpdateExpression:
          'SET scheduledArrivalTime = :arrival, #status = :status, delayReason = :reason, lastUpdatedAt = :now, GSI1PK = :gsi1pk, GSI1SK = :gsi1sk',
        ExpressionAttributeNames: {
          '#status': 'status'
        },
        ExpressionAttributeValues: {
          ':arrival': newArrivalTime,
          ':status': 'DELAYED',
          ':reason': reason,
          ':now': now,
          ':gsi1pk': activeKey('DELAYED', airportId),
          ':gsi1sk': newArrivalTime
        }
      })
    );
  }

  async getFlight(airportId: string, flightId: string): Promise<FlightRequest | undefined> {
    const response = await this.clients.ddb.send(
      new GetCommand({
        TableName: this.config.flightsTableName,
        Key: {
          PK: `AIRPORT#${airportId}`,
          SK: `FLIGHT#${flightId}`
        }
      })
    );

    if (!response.Item) {
      return undefined;
    }

    const item = { ...response.Item } as Record<string, unknown>;
    delete item.PK;
    delete item.SK;
    delete item.GSI1PK;
    delete item.GSI1SK;
    return item as unknown as FlightRequest;
  }

  async listActiveFlights(airportId: string): Promise<FlightRequest[]> {
    const response = await this.clients.ddb.send(
      new QueryCommand({
        TableName: this.config.flightsTableName,
        IndexName: 'GSI1',
        KeyConditionExpression: 'GSI1PK = :gsi1pk',
        ExpressionAttributeValues: {
          ':gsi1pk': `ACTIVE#${airportId}`
        }
      })
    );

    return (response.Items ?? []).map((item) => {
      const normalized = { ...item } as Record<string, unknown>;
      delete normalized.PK;
      delete normalized.SK;
      delete normalized.GSI1PK;
      delete normalized.GSI1SK;
      return normalized as unknown as FlightRequest;
    });
  }

  async updateFlightStatuses(
    airportId: string,
    assignedFlightIds: string[],
    holdingFlightIds: string[],
    now: string
  ): Promise<void> {
    for (const flightId of assignedFlightIds) {
      await this.clients.ddb.send(
        new UpdateCommand({
          TableName: this.config.flightsTableName,
          Key: {
            PK: `AIRPORT#${airportId}`,
            SK: `FLIGHT#${flightId}`
          },
          UpdateExpression:
            'SET #status = :status, lastUpdatedAt = :now, GSI1PK = :gsi1pk, GSI1SK = scheduledArrivalTime',
          ExpressionAttributeNames: {
            '#status': 'status'
          },
          ExpressionAttributeValues: {
            ':status': 'ASSIGNED',
            ':now': now,
            ':gsi1pk': `ACTIVE#${airportId}`
          }
        })
      );
    }

    for (const flightId of holdingFlightIds) {
      await this.clients.ddb.send(
        new UpdateCommand({
          TableName: this.config.flightsTableName,
          Key: {
            PK: `AIRPORT#${airportId}`,
            SK: `FLIGHT#${flightId}`
          },
          UpdateExpression:
            'SET #status = :status, lastUpdatedAt = :now, GSI1PK = :gsi1pk, GSI1SK = scheduledArrivalTime',
          ExpressionAttributeNames: {
            '#status': 'status'
          },
          ExpressionAttributeValues: {
            ':status': 'HOLDING',
            ':now': now,
            ':gsi1pk': `ACTIVE#${airportId}`
          }
        })
      );
    }
  }
}

export class DynamoSlotRepository implements SlotRepository {
  constructor(
    private readonly clients: AwsAdapterClients,
    private readonly config: AdapterConfig
  ) {}

  async listAllocations(
    airportId: string,
    fromIso: string,
    toIso: string
  ): Promise<SlotAllocation[]> {
    const response = await this.clients.ddb.send(
      new QueryCommand({
        TableName: this.config.slotsTableName,
        IndexName: 'GSI1',
        KeyConditionExpression: 'GSI1PK = :gsi1pk AND GSI1SK BETWEEN :from AND :to',
        ExpressionAttributeValues: {
          ':gsi1pk': `AIRPORT#${airportId}`,
          ':from': `SLOT#${fromIso}`,
          ':to': `SLOT#${toIso}~`
        }
      })
    );

    return (response.Items ?? []).map((item) => {
      const normalized = { ...item } as Record<string, unknown>;
      delete normalized.PK;
      delete normalized.SK;
      delete normalized.GSI1PK;
      delete normalized.GSI1SK;
      return normalized as unknown as SlotAllocation;
    });
  }

  async upsertAllocations(
    airportId: string,
    allocations: SlotAllocation[],
    now: string
  ): Promise<void> {
    void now;
    if (allocations.length === 0) {
      return;
    }

    // Deduplicate by flight ID to avoid duplicate keys in a single BatchWrite request.
    const uniqueAllocations = [
      ...new Map(allocations.map((item) => [item.flightId, item])).values()
    ];

    const requests = uniqueAllocations.map((allocation) => ({
      PutRequest: {
        Item: {
          PK: `AIRPORT#${airportId}`,
          SK: `FLIGHT#${allocation.flightId}`,
          GSI1PK: `AIRPORT#${airportId}`,
          GSI1SK: `SLOT#${allocation.slotStartTime}#RUNWAY#${allocation.runwayId}`,
          ...allocation,
          airportId
        }
      }
    }));

    await this.clients.ddb.send(
      new BatchWriteCommand({
        RequestItems: {
          [this.config.slotsTableName]: requests
        }
      })
    );
  }
}

export class DynamoIdempotencyRepository implements IdempotencyRepository {
  constructor(
    private readonly clients: AwsAdapterClients,
    private readonly config: AdapterConfig
  ) {}

  async get(scope: string, idempotencyKey: string): Promise<RequestRecord | undefined> {
    const response = await this.clients.ddb.send(
      new GetCommand({
        TableName: this.config.idempotencyTableName,
        Key: {
          PK: scope,
          SK: idempotencyKey
        }
      })
    );

    if (!response.Item) {
      return undefined;
    }

    const item = { ...response.Item } as Record<string, unknown>;
    delete item.PK;
    delete item.SK;
    return item as unknown as RequestRecord;
  }

  async put(record: RequestRecord): Promise<void> {
    await this.clients.ddb.send(
      new PutCommand({
        TableName: this.config.idempotencyTableName,
        Item: {
          PK: record.scope,
          SK: record.idempotencyKey,
          ...record,
          ttl: record.expiresAt
        },
        ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)'
      })
    );
  }
}

export class DynamoDedupeRepository implements EventDedupeRepository {
  constructor(
    private readonly clients: AwsAdapterClients,
    private readonly config: AdapterConfig
  ) {}

  async acquire(eventId: string, expiresAt: number): Promise<boolean> {
    try {
      await this.clients.ddb.send(
        new PutCommand({
          TableName: this.config.dedupeTableName,
          Item: {
            PK: eventId,
            createdAt: new Date().toISOString(),
            ttl: expiresAt
          },
          ConditionExpression: 'attribute_not_exists(PK)'
        })
      );

      return true;
    } catch {
      return false;
    }
  }
}

export class DynamoCapacityRepository implements CapacityRepository {
  constructor(
    private readonly clients: AwsAdapterClients,
    private readonly config: AdapterConfig
  ) {}

  async getCapacity(airportId: string): Promise<CapacityConfig> {
    const response = await this.clients.ddb.send(
      new GetCommand({
        TableName: this.config.capacityTableName,
        Key: {
          PK: `AIRPORT#${airportId}`,
          SK: 'CONFIG#CAPACITY'
        }
      })
    );

    if (!response.Item) {
      return {
        airportId,
        runwayCount: 2,
        slotMinutes: 5,
        lookaheadMinutes: 180,
        holdingLookaheadMinutes: 45,
        maxConsecutivePerAirline: 2,
        freezeWindowMinutes: 10,
        updatedAt: new Date().toISOString(),
        updatedBy: 'system-default'
      };
    }

    const item = { ...response.Item } as Record<string, unknown>;
    delete item.PK;
    delete item.SK;
    return item as unknown as CapacityConfig;
  }

  async upsertCapacity(config: CapacityConfig): Promise<void> {
    await this.clients.ddb.send(
      new PutCommand({
        TableName: this.config.capacityTableName,
        Item: {
          PK: `AIRPORT#${config.airportId}`,
          SK: 'CONFIG#CAPACITY',
          ...config
        }
      })
    );
  }
}

export class SqsWorkflowQueue implements WorkflowQueue {
  constructor(
    private readonly clients: AwsAdapterClients,
    private readonly config: AdapterConfig
  ) {}

  async send(message: WorkflowMessage): Promise<void> {
    await retryWithBackoff(
      async () =>
        this.clients.sqs.send(
          new SendMessageCommand({
            QueueUrl: this.config.workflowQueueUrl,
            MessageBody: JSON.stringify(message)
          })
        ),
      {
        maxAttempts: 3,
        baseDelayMs: 100,
        maxDelayMs: 1_000
      }
    );
  }
}

export class EventBridgeDomainEventPublisher implements DomainEventPublisher {
  constructor(
    private readonly clients: AwsAdapterClients,
    private readonly config: AdapterConfig
  ) {}

  async publish<TType extends DomainEventType, TDetail>(
    event: DomainEventEnvelope<TType, TDetail>
  ): Promise<void> {
    await retryWithBackoff(
      async () =>
        this.clients.eventBridge.send(
          new PutEventsCommand({
            Entries: [
              {
                EventBusName: this.config.eventBusName,
                Source: 'skyflow.allocation',
                DetailType: event.eventType,
                Time: new Date(event.eventTime),
                Detail: JSON.stringify(event)
              }
            ]
          })
        ),
      {
        maxAttempts: 3,
        baseDelayMs: 100,
        maxDelayMs: 1_000
      }
    );
  }
}
