import type { APIGatewayProxyEventV2 } from 'aws-lambda';

import { UnauthorizedError } from '@skyflow/application';

export type UserRole = 'AIRLINE' | 'ADMIN';

export interface AuthContext {
  role: UserRole;
  airlineId?: string;
  subject: string;
}

function parseGroups(claims: Record<string, string | undefined>): string[] {
  const raw = claims['cognito:groups'];
  if (!raw) {
    return [];
  }

  return raw
    .replaceAll('[', '')
    .replaceAll(']', '')
    .replaceAll('"', '')
    .split(',')
    .map((item) => item.trim());
}

export function getAuthContext(event: APIGatewayProxyEventV2): AuthContext {
  const claimsContainer = event.requestContext as {
    authorizer?: {
      jwt?: {
        claims?: Record<string, string | undefined>;
      };
    };
  };
  const claims = claimsContainer.authorizer?.jwt?.claims ?? {};

  const groups = parseGroups(claims);
  const role =
    claims['custom:role'] === 'ADMIN' || groups.includes('admin')
      ? ('ADMIN' as const)
      : ('AIRLINE' as const);

  const subject = claims.sub;
  if (!subject) {
    throw new UnauthorizedError('Missing JWT subject');
  }

  return {
    role,
    airlineId: claims['custom:airline_id'] ?? claims['airline_id'],
    subject
  };
}

export function requireRole(auth: AuthContext, expected: UserRole): void {
  if (auth.role !== expected) {
    throw new UnauthorizedError(`Expected role ${expected}`);
  }
}
