import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { randomUUID } from 'node:crypto';

export function getCorrelationIdFromApiEvent(event: APIGatewayProxyEventV2): string {
  return (
    event.headers['x-correlation-id'] ??
    event.headers['X-Correlation-Id'] ??
    event.requestContext.requestId ??
    randomUUID()
  );
}

export function requireHeader(headers: Record<string, string | undefined>, key: string): string {
  const value = headers[key] ?? headers[key.toLowerCase()] ?? headers[key.toUpperCase()];
  if (!value) {
    throw new Error(`Missing required header: ${key}`);
  }

  return value;
}
