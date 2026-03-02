import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';

import { ValidationError, submitDelayUpdate } from '@skyflow/application';
import { accepted, emitMetrics } from '@skyflow/shared';

import { getAuthContext } from '../auth/roles.js';
import type { ApiDependencies } from '../services/dependencies.js';
import { createApiDependencies } from '../services/dependencies.js';
import { delayUpdateSchema } from '../validation.js';
import { correlationId, mapError, parseJsonBody } from './utils.js';

export function createPostDelayUpdateHandler(deps: ApiDependencies) {
  return async function handler(
    event: APIGatewayProxyEventV2
  ): Promise<APIGatewayProxyStructuredResultV2> {
    const corrId = correlationId(event);

    try {
      getAuthContext(event);
      const payload = delayUpdateSchema.parse(parseJsonBody<unknown>(event));
      const flightId = event.pathParameters?.flightId;
      if (!flightId) {
        throw new ValidationError('Missing path parameter: flightId');
      }

      const response = await submitDelayUpdate(
        {
          airportId: payload.airport_id,
          flightId,
          newArrivalTime: payload.new_arrival_time,
          delayReason: payload.delay_reason,
          correlationId: corrId,
          requestTime: new Date().toISOString()
        },
        deps
      );

      emitMetrics(
        {
          namespace: 'SkyFlow',
          service: 'skyflow-api',
          dimensions: { Route: 'POST /v1/flights/{flightId}/delay' }
        },
        [{ name: 'delay_updates_received', unit: 'Count', value: 1 }]
      );

      return accepted(response);
    } catch (error) {
      deps.logger.error('Delay update failed', { correlationId: corrId }, { error });
      return mapError(error, corrId);
    }
  };
}

let defaultHandler: ReturnType<typeof createPostDelayUpdateHandler> | undefined;
export const handler = async (event: APIGatewayProxyEventV2) => {
  if (!defaultHandler) {
    defaultHandler = createPostDelayUpdateHandler(createApiDependencies());
  }

  return defaultHandler(event);
};
