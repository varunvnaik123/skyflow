import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { ZodError } from 'zod';

import {
  NotFoundError,
  UnauthorizedError,
  ValidationError
} from '@skyflow/application';
import { err, getCorrelationIdFromApiEvent } from '@skyflow/shared';

export function parseJsonBody<T>(event: APIGatewayProxyEventV2): T {
  if (!event.body) {
    throw new ValidationError('Request body is required');
  }

  try {
    return JSON.parse(event.body) as T;
  } catch {
    throw new ValidationError('Invalid JSON body');
  }
}

export function mapError(error: unknown, correlationId: string) {
  if (error instanceof ValidationError || error instanceof ZodError) {
    return err(400, {
      errorCode: 'VALIDATION_ERROR',
      message: error.message,
      correlationId
    });
  }

  if (error instanceof UnauthorizedError) {
    return err(403, {
      errorCode: 'FORBIDDEN',
      message: error.message,
      correlationId
    });
  }

  if (error instanceof NotFoundError) {
    return err(404, {
      errorCode: 'NOT_FOUND',
      message: error.message,
      correlationId
    });
  }

  return err(500, {
    errorCode: 'INTERNAL_ERROR',
    message: 'Internal server error',
    correlationId
  });
}

export function correlationId(event: APIGatewayProxyEventV2): string {
  return getCorrelationIdFromApiEvent(event);
}
