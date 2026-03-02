import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { ReceiveMessageCommand, DeleteMessageCommand } from '@aws-sdk/client-sqs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function resolveFirstExisting(...relativePaths) {
  for (const relativePath of relativePaths) {
    const absolutePath = path.resolve(__dirname, relativePath);
    if (fs.existsSync(absolutePath)) {
      return absolutePath;
    }
  }

  throw new Error(`Could not resolve module from candidates: ${relativePaths.join(', ')}`);
}

const applicationModulePath = resolveFirstExisting(
  '../packages/application/dist/index.js',
  '../packages/application/dist/src/index.js'
);
const awsAdaptersModulePath = resolveFirstExisting(
  '../packages/aws-adapters/dist/index.js',
  '../packages/aws-adapters/dist/src/index.js'
);

const applicationModule = await import(pathToFileURL(applicationModulePath).href);
const awsAdaptersModule = await import(pathToFileURL(awsAdaptersModulePath).href);

const { submitFlightRequest, submitDelayUpdate, processWorkflowMessage } = applicationModule;
const {
  buildAwsClients,
  DynamoFlightRepository,
  DynamoSlotRepository,
  DynamoCapacityRepository,
  DynamoIdempotencyRepository,
  DynamoDedupeRepository,
  SqsWorkflowQueue,
  EventBridgeDomainEventPublisher
} = awsAdaptersModule;

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing env: ${name}`);
  }
  return value;
}

function addMinutes(isoString, minutes) {
  return new Date(new Date(isoString).getTime() + minutes * 60_000).toISOString();
}

const config = {
  flightsTableName: requiredEnv('FLIGHTS_TABLE_NAME'),
  slotsTableName: requiredEnv('SLOTS_TABLE_NAME'),
  idempotencyTableName: requiredEnv('IDEMPOTENCY_TABLE_NAME'),
  dedupeTableName: requiredEnv('DEDUPE_TABLE_NAME'),
  capacityTableName: requiredEnv('CAPACITY_TABLE_NAME'),
  workflowQueueUrl: requiredEnv('WORKFLOW_QUEUE_URL'),
  eventBusName: requiredEnv('EVENT_BUS_NAME')
};

const clients = buildAwsClients();

const flights = new DynamoFlightRepository(clients, config);
const slots = new DynamoSlotRepository(clients, config);
const capacity = new DynamoCapacityRepository(clients, config);
const idempotency = new DynamoIdempotencyRepository(clients, config);
const dedupe = new DynamoDedupeRepository(clients, config);
const workflow = new SqsWorkflowQueue(clients, config);
const events = new EventBridgeDomainEventPublisher(clients, config);

async function drainQueue() {
  let processed = 0;
  for (;;) {
    const response = await clients.sqs.send(
      new ReceiveMessageCommand({
        QueueUrl: config.workflowQueueUrl,
        MaxNumberOfMessages: 10,
        WaitTimeSeconds: 1
      })
    );

    const messages = response.Messages ?? [];
    if (messages.length === 0) {
      break;
    }

    for (const message of messages) {
      const body = JSON.parse(message.Body ?? '{}');
      await processWorkflowMessage(body, new Date().toISOString(), {
        flights,
        slots,
        capacity,
        dedupe,
        events
      });

      if (message.ReceiptHandle) {
        await clients.sqs.send(
          new DeleteMessageCommand({
            QueueUrl: config.workflowQueueUrl,
            ReceiptHandle: message.ReceiptHandle
          })
        );
      }
      processed += 1;
    }
  }

  return processed;
}

async function main() {
  const runId = Date.now().toString();
  const baseNow = new Date().toISOString();
  const flightOneId = `SF100-${runId}`;
  const flightTwoId = `SF200-${runId}`;

  await submitFlightRequest(
    {
      airportId: 'SFO',
      airlineId: 'ALPHA',
      flightId: flightOneId,
      scheduledArrivalTime: addMinutes(baseNow, 5),
      aircraftType: 'A320',
      priority: 'NORMAL',
      idempotencyKey: `idem-sf100-${runId}`,
      correlationId: `corr-sf100-${runId}`,
      requestTime: baseNow
    },
    { flights, idempotency, workflow }
  );

  await submitFlightRequest(
    {
      airportId: 'SFO',
      airlineId: 'BRAVO',
      flightId: flightTwoId,
      scheduledArrivalTime: addMinutes(baseNow, 10),
      aircraftType: 'B737',
      priority: 'INTERNATIONAL',
      idempotencyKey: `idem-sf200-${runId}`,
      correlationId: `corr-sf200-${runId}`,
      requestTime: baseNow
    },
    { flights, idempotency, workflow }
  );

  const initialProcessed = await drainQueue();
  assert(initialProcessed >= 2, 'expected initial workflow messages to be processed');

  await submitDelayUpdate(
    {
      airportId: 'SFO',
      flightId: flightOneId,
      newArrivalTime: addMinutes(baseNow, 25),
      delayReason: 'WEATHER',
      correlationId: `corr-delay-sf100-${runId}`,
      requestTime: new Date().toISOString()
    },
    { flights, workflow }
  );

  const delayProcessed = await drainQueue();
  assert(delayProcessed >= 1, 'expected delay workflow message to be processed');

  const sf100 = await flights.getFlight('SFO', flightOneId);
  const sf200 = await flights.getFlight('SFO', flightTwoId);
  assert(sf100, `${flightOneId} should exist`);
  assert(sf200, `${flightTwoId} should exist`);

  const allocations = await slots.listAllocations(
    'SFO',
    addMinutes(baseNow, -30),
    addMinutes(baseNow, 180)
  );

  if (!allocations.some((allocation) => allocation.flightId === flightOneId)) {
    console.error('[local-e2e] allocations snapshot:', JSON.stringify(allocations, null, 2));
    throw new Error(`Expected allocation for ${flightOneId}`);
  }

  if (!allocations.some((allocation) => allocation.flightId === flightTwoId)) {
    console.error('[local-e2e] allocations snapshot:', JSON.stringify(allocations, null, 2));
    throw new Error(`Expected allocation for ${flightTwoId}`);
  }

  console.log(
    JSON.stringify(
      {
        status: 'PASS',
        processed: {
          initial: initialProcessed,
          delay: delayProcessed
        },
        flightStatuses: {
          [flightOneId]: sf100.status,
          [flightTwoId]: sf200.status
        },
        allocationCount: allocations.length
      },
      null,
      2
    )
  );
}

await main();
