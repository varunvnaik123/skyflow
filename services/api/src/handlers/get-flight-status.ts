import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';

import { NotFoundError, UnauthorizedError, ValidationError } from '@skyflow/application';
import { ok } from '@skyflow/shared';

import { getAuthContext } from '../auth/roles.js';
import type { ApiDependencies } from '../services/dependencies.js';
import { createApiDependencies } from '../services/dependencies.js';
import { correlationId, mapError } from './utils.js';

export function createGetFlightStatusHandler(deps: ApiDependencies) {
  return async function handler(
    event: APIGatewayProxyEventV2
  ): Promise<APIGatewayProxyStructuredResultV2> {
    const corrId = correlationId(event);

    try {
      const auth = getAuthContext(event);
      const airportId = event.queryStringParameters?.airport_id;
      const flightId = event.pathParameters?.flightId;
      if (!airportId || !flightId) {
        throw new ValidationError('airport_id query parameter and flightId path parameter are required');
      }

      const flight = await deps.flights.getFlight(airportId, flightId);
      if (!flight) {
        throw new NotFoundError(`Flight not found: ${flightId}`);
      }

      if (auth.role === 'AIRLINE' && auth.airlineId && auth.airlineId !== flight.airlineId) {
        throw new UnauthorizedError('AIRLINE user cannot access another airline flight');
      }

      return ok({
        flight_id: flight.flightId,
        airline_id: flight.airlineId,
        airport_id: flight.airportId,
        status: flight.status,
        scheduled_arrival_time: flight.scheduledArrivalTime,
        priority: flight.priority,
        last_updated_at: flight.lastUpdatedAt
      });
    } catch (error) {
      deps.logger.error('Get flight status failed', { correlationId: corrId }, { error });
      return mapError(error, corrId);
    }
  };
}

let defaultHandler: ReturnType<typeof createGetFlightStatusHandler> | undefined;
export const handler = async (event: APIGatewayProxyEventV2) => {
  if (!defaultHandler) {
    defaultHandler = createGetFlightStatusHandler(createApiDependencies());
  }

  return defaultHandler(event);
};
