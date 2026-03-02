import type { APIGatewayProxyStructuredResultV2 } from 'aws-lambda';

export interface ApiErrorBody {
  errorCode: string;
  message: string;
  correlationId: string;
  details?: Record<string, unknown>;
}

export function ok(body: unknown): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode: 200,
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify(body)
  };
}

export function accepted(body: unknown): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode: 202,
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify(body)
  };
}

export function created(body: unknown): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode: 201,
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify(body)
  };
}

export function err(statusCode: number, body: ApiErrorBody): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode,
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify(body)
  };
}
