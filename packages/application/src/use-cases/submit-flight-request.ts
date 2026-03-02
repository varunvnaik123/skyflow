import { createHash, randomUUID } from 'node:crypto';

import type { FlightRequest, FlightPriority } from '@skyflow/domain';

import { ValidationError } from '../errors.js';
import type {
  FlightRepository,
  IdempotencyRepository,
  WorkflowMessage,
  WorkflowQueue
} from '../types.js';

export interface SubmitFlightRequestInput {
  airportId: string;
  airlineId: string;
  flightId: string;
  scheduledArrivalTime: string;
  aircraftType: string;
  priority: FlightPriority;
  constraints?: FlightRequest['constraints'];
  idempotencyKey: string;
  correlationId: string;
  requestTime: string;
}

export interface SubmitFlightRequestOutput {
  requestId: string;
  status: 'QUEUED';
}

function hashRequest(input: SubmitFlightRequestInput): string {
  const payload = JSON.stringify({
    flightId: input.flightId,
    airlineId: input.airlineId,
    scheduledArrivalTime: input.scheduledArrivalTime,
    aircraftType: input.aircraftType,
    priority: input.priority,
    constraints: input.constraints ?? {}
  });

  return createHash('sha256').update(payload).digest('hex');
}

export async function submitFlightRequest(
  input: SubmitFlightRequestInput,
  dependencies: {
    flights: FlightRepository;
    idempotency: IdempotencyRepository;
    workflow: WorkflowQueue;
  }
): Promise<SubmitFlightRequestOutput> {
  if (!input.flightId || !input.airlineId) {
    throw new ValidationError('flightId and airlineId are required');
  }

  const requestHash = hashRequest(input);
  const scope = `flight-request#${input.airlineId}`;
  const existing = await dependencies.idempotency.get(scope, input.idempotencyKey);
  if (existing) {
    if (existing.requestHash !== requestHash) {
      throw new ValidationError('Idempotency key re-used with different payload');
    }

    return JSON.parse(existing.responseBody) as SubmitFlightRequestOutput;
  }

  const flight: FlightRequest = {
    airportId: input.airportId,
    flightId: input.flightId,
    airlineId: input.airlineId,
    scheduledArrivalTime: input.scheduledArrivalTime,
    aircraftType: input.aircraftType,
    priority: input.priority,
    constraints: input.constraints,
    status: 'REQUESTED',
    lastUpdatedAt: input.requestTime
  };

  const requestId = randomUUID();
  await dependencies.flights.putFlightRequest(flight);

  const message: WorkflowMessage = {
    eventId: requestId,
    correlationId: input.correlationId,
    eventType: 'FLIGHT_REQUESTED',
    airportId: input.airportId,
    flightId: input.flightId,
    eventTime: input.requestTime
  };

  await dependencies.workflow.send(message);

  const response: SubmitFlightRequestOutput = {
    requestId,
    status: 'QUEUED'
  };

  try {
    await dependencies.idempotency.put({
      idempotencyKey: input.idempotencyKey,
      scope,
      requestHash,
      statusCode: 202,
      responseBody: JSON.stringify(response),
      createdAt: input.requestTime,
      expiresAt: Math.floor(new Date(input.requestTime).getTime() / 1000) + 24 * 3600
    });
  } catch {
    // If a concurrent request won the conditional write, safely return canonical response.
    const concurrentRecord = await dependencies.idempotency.get(scope, input.idempotencyKey);
    if (concurrentRecord && concurrentRecord.requestHash === requestHash) {
      return JSON.parse(concurrentRecord.responseBody) as SubmitFlightRequestOutput;
    }
    throw new ValidationError('Failed to persist idempotency record');
  }

  return response;
}
