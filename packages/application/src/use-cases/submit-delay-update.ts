import { randomUUID } from 'node:crypto';

import { NotFoundError, ValidationError } from '../errors.js';
import type { FlightRepository, WorkflowQueue } from '../types.js';

export interface SubmitDelayUpdateInput {
  airportId: string;
  flightId: string;
  newArrivalTime: string;
  delayReason: string;
  correlationId: string;
  requestTime: string;
}

export interface SubmitDelayUpdateOutput {
  requestId: string;
  status: 'QUEUED';
}

export async function submitDelayUpdate(
  input: SubmitDelayUpdateInput,
  dependencies: {
    flights: FlightRepository;
    workflow: WorkflowQueue;
  }
): Promise<SubmitDelayUpdateOutput> {
  if (!input.delayReason.trim()) {
    throw new ValidationError('delayReason is required');
  }

  const flight = await dependencies.flights.getFlight(input.airportId, input.flightId);
  if (!flight) {
    throw new NotFoundError(`Flight not found: ${input.flightId}`);
  }

  await dependencies.flights.updateDelay(
    input.airportId,
    input.flightId,
    input.newArrivalTime,
    input.requestTime,
    input.delayReason
  );

  const requestId = randomUUID();
  await dependencies.workflow.send({
    eventId: requestId,
    correlationId: input.correlationId,
    eventType: 'DELAY_UPDATED',
    airportId: input.airportId,
    flightId: input.flightId,
    eventTime: input.requestTime
  });

  return {
    requestId,
    status: 'QUEUED'
  };
}
