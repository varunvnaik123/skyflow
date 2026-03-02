import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';

import { updateCapacityConfig } from '@skyflow/application';
import { ok } from '@skyflow/shared';

import { getAuthContext, requireRole } from '../auth/roles.js';
import type { ApiDependencies } from '../services/dependencies.js';
import { createApiDependencies } from '../services/dependencies.js';
import { capacityUpdateSchema } from '../validation.js';
import { correlationId, mapError, parseJsonBody } from './utils.js';

export function createPutAdminCapacityHandler(deps: ApiDependencies) {
  return async function handler(
    event: APIGatewayProxyEventV2
  ): Promise<APIGatewayProxyStructuredResultV2> {
    const corrId = correlationId(event);

    try {
      const auth = getAuthContext(event);
      requireRole(auth, 'ADMIN');

      const payload = capacityUpdateSchema.parse(parseJsonBody<unknown>(event));
      const now = new Date().toISOString();

      await updateCapacityConfig(
        {
          airportId: payload.airport_id,
          runwayCount: payload.runway_count,
          slotMinutes: payload.slot_minutes,
          lookaheadMinutes: payload.lookahead_minutes,
          holdingLookaheadMinutes: payload.holding_lookahead_minutes,
          maxConsecutivePerAirline: payload.max_consecutive_per_airline,
          freezeWindowMinutes: payload.freeze_window_minutes,
          updatedAt: now,
          updatedBy: auth.subject
        },
        { capacity: deps.capacity }
      );

      return ok({ status: 'UPDATED', updated_at: now });
    } catch (error) {
      deps.logger.error('Capacity update failed', { correlationId: corrId }, { error });
      return mapError(error, corrId);
    }
  };
}

let defaultHandler: ReturnType<typeof createPutAdminCapacityHandler> | undefined;
export const handler = async (event: APIGatewayProxyEventV2) => {
  if (!defaultHandler) {
    defaultHandler = createPutAdminCapacityHandler(createApiDependencies());
  }

  return defaultHandler(event);
};
