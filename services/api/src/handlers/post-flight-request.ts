import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';

import { UnauthorizedError, ValidationError } from '@skyflow/application';
import { submitFlightRequest } from '@skyflow/application';
import { accepted, emitMetrics } from '@skyflow/shared';

import { getAuthContext } from '../auth/roles.js';
import type { ApiDependencies } from '../services/dependencies.js';
import { createApiDependencies } from '../services/dependencies.js';
import { submitFlightRequestSchema } from '../validation.js';
import { correlationId, mapError, parseJsonBody } from './utils.js';

export function createPostFlightRequestHandler(deps: ApiDependencies) {
  return async function handler(
    event: APIGatewayProxyEventV2
  ): Promise<APIGatewayProxyStructuredResultV2> {
    const corrId = correlationId(event);

    try {
      const auth = getAuthContext(event);
      const payload = submitFlightRequestSchema.parse(parseJsonBody<unknown>(event));
      const idempotencyKey =
        event.headers['idempotency-key'] ?? event.headers['Idempotency-Key'];
      if (!idempotencyKey) {
        throw new ValidationError('Missing required header: Idempotency-Key');
      }

      if (auth.role === 'AIRLINE' && auth.airlineId && auth.airlineId !== payload.airline_id) {
        throw new UnauthorizedError('Token airline does not match payload airline');
      }

      const response = await submitFlightRequest(
        {
          airportId: payload.airport_id,
          airlineId: payload.airline_id,
          flightId: payload.flight_id,
          scheduledArrivalTime: payload.scheduled_arrival_time,
          aircraftType: payload.aircraft_type,
          priority: payload.priority,
          constraints: payload.constraints,
          idempotencyKey,
          correlationId: corrId,
          requestTime: new Date().toISOString()
        },
        deps
      );

      emitMetrics(
        {
          namespace: 'SkyFlow',
          service: 'skyflow-api',
          dimensions: { Route: 'POST /v1/flights/requests' }
        },
        [{ name: 'flight_request_accepted', unit: 'Count', value: 1 }]
      );

      deps.logger.info('Flight request accepted', { correlationId: corrId, requestId: response.requestId });
      return accepted(response);
    } catch (error) {
      deps.logger.error('Flight request rejected', { correlationId: corrId }, { error });
      return mapError(error, corrId);
    }
  };
}

let defaultHandler: ReturnType<typeof createPostFlightRequestHandler> | undefined;
export const handler = async (event: APIGatewayProxyEventV2) => {
  if (!defaultHandler) {
    defaultHandler = createPostFlightRequestHandler(createApiDependencies());
  }

  return defaultHandler(event);
};
