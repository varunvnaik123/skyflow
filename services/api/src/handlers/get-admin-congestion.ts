import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';

import { ValidationError, getCongestionMetrics } from '@skyflow/application';
import { ok } from '@skyflow/shared';

import { getAuthContext, requireRole } from '../auth/roles.js';
import type { ApiDependencies } from '../services/dependencies.js';
import { createApiDependencies } from '../services/dependencies.js';
import { correlationId, mapError } from './utils.js';

export function createGetAdminCongestionHandler(deps: ApiDependencies) {
  return async function handler(
    event: APIGatewayProxyEventV2
  ): Promise<APIGatewayProxyStructuredResultV2> {
    const corrId = correlationId(event);

    try {
      const auth = getAuthContext(event);
      requireRole(auth, 'ADMIN');

      const airportId = event.queryStringParameters?.airport_id;
      if (!airportId) {
        throw new ValidationError('airport_id is required');
      }

      const metrics = await getCongestionMetrics(airportId, new Date().toISOString(), {
        capacity: deps.capacity,
        slots: deps.slots
      });

      return ok({
        airport_id: airportId,
        assigned_slots: metrics.assignedSlots,
        runway_count: metrics.runwayCount,
        slot_minutes: metrics.slotMinutes,
        congestion_index: metrics.congestionIndex
      });
    } catch (error) {
      deps.logger.error('Get congestion metrics failed', { correlationId: corrId }, { error });
      return mapError(error, corrId);
    }
  };
}

let defaultHandler: ReturnType<typeof createGetAdminCongestionHandler> | undefined;
export const handler = async (event: APIGatewayProxyEventV2) => {
  if (!defaultHandler) {
    defaultHandler = createGetAdminCongestionHandler(createApiDependencies());
  }

  return defaultHandler(event);
};
