import { describe, expect, it } from 'vitest';

import {
  InMemoryCapacityRepository,
  InMemoryFlightRepository,
  InMemoryIdempotencyRepository,
  InMemorySlotRepository,
  InMemoryWorkflowQueue
} from '@skyflow/application';
import { Logger } from '@skyflow/shared';

import { createGetAdminCongestionHandler } from '../src/handlers/get-admin-congestion.js';
import { createPostFlightRequestHandler } from '../src/handlers/post-flight-request.js';

function buildJwtClaims(role: 'AIRLINE' | 'ADMIN', airlineId?: string) {
  return {
    sub: 'user-1',
    'custom:role': role,
    'custom:airline_id': airlineId
  };
}

function eventFor(
  path: string,
  method: string,
  body?: unknown,
  claims?: Record<string, string | undefined>
) {
  return {
    version: '2.0',
    routeKey: `${method} ${path}`,
    rawPath: path,
    rawQueryString: '',
    headers: {
      'content-type': 'application/json',
      'idempotency-key': 'idem-1'
    },
    requestContext: {
      requestId: 'req-1',
      http: {
        method,
        path,
        protocol: 'HTTP/1.1',
        sourceIp: '127.0.0.1',
        userAgent: 'vitest'
      },
      authorizer: claims ? { jwt: { claims, scopes: [] } } : undefined
    },
    body: body ? JSON.stringify(body) : undefined,
    isBase64Encoded: false,
    pathParameters: {},
    queryStringParameters: {}
  };
}

describe('POST /v1/flights/requests', () => {
  it('supports idempotent request replay', async () => {
    const deps = {
      flights: new InMemoryFlightRepository(),
      slots: new InMemorySlotRepository(),
      capacity: new InMemoryCapacityRepository({
        airportId: 'SFO',
        runwayCount: 1,
        slotMinutes: 5,
        lookaheadMinutes: 60,
        holdingLookaheadMinutes: 30,
        maxConsecutivePerAirline: 2,
        freezeWindowMinutes: 10,
        updatedAt: '2026-03-02T00:00:00.000Z',
        updatedBy: 'system'
      }),
      idempotency: new InMemoryIdempotencyRepository(),
      workflow: new InMemoryWorkflowQueue(),
      logger: new Logger('test')
    };

    const handler = createPostFlightRequestHandler(deps);

    const payload = {
      airport_id: 'SFO',
      flight_id: 'F-101',
      airline_id: 'ALPHA',
      scheduled_arrival_time: '2026-03-02T12:00:00.000Z',
      aircraft_type: 'A320',
      priority: 'NORMAL'
    };

    const event = eventFor(
      '/v1/flights/requests',
      'POST',
      payload,
      buildJwtClaims('AIRLINE', 'ALPHA')
    );
    const first = await handler(event as never);
    const second = await handler(event as never);

    expect(first.statusCode).toBe(202);
    expect(second.statusCode).toBe(202);
    expect(deps.workflow.messages).toHaveLength(1);
  });
});

describe('GET /v1/admin/congestion', () => {
  it('rejects non-admin users', async () => {
    const deps = {
      flights: new InMemoryFlightRepository(),
      slots: new InMemorySlotRepository(),
      capacity: new InMemoryCapacityRepository({
        airportId: 'SFO',
        runwayCount: 1,
        slotMinutes: 5,
        lookaheadMinutes: 60,
        holdingLookaheadMinutes: 30,
        maxConsecutivePerAirline: 2,
        freezeWindowMinutes: 10,
        updatedAt: '2026-03-02T00:00:00.000Z',
        updatedBy: 'system'
      }),
      idempotency: new InMemoryIdempotencyRepository(),
      workflow: new InMemoryWorkflowQueue(),
      logger: new Logger('test')
    };

    const handler = createGetAdminCongestionHandler(deps);
    const event = eventFor(
      '/v1/admin/congestion',
      'GET',
      undefined,
      buildJwtClaims('AIRLINE', 'ALPHA')
    );
    event.queryStringParameters = { airport_id: 'SFO' };

    const response = await handler(event as never);
    expect(response.statusCode).toBe(403);
  });
});
