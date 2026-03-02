# ADR 0004: Stage-Aware Data Retention and CORS Defaults

## Status

Accepted

## Context

SkyFlow needs fast local iteration for development while still showing production-safe defaults in
infrastructure design reviews.

Two areas were previously too permissive for production:

- DynamoDB tables were always configured with `RemovalPolicy.DESTROY`.
- API Gateway CORS allowed all origins (`*`).

## Decision

- Introduce a CDK context variable `stage` (`dev` by default).
- Use stage-aware table retention:
  - `stage=prod` -> `RemovalPolicy.RETAIN`
  - other stages -> `RemovalPolicy.DESTROY`
- Introduce a CDK context variable `allowedOrigins` (comma-separated list):
  - if provided, use those origins for API Gateway CORS
  - otherwise default to `http://localhost:3000` for local development

## Consequences

- Development remains frictionless.
- Production deployments avoid accidental data deletion and broad CORS exposure.
- Deployment commands must now explicitly include context for prod:
  `npx cdk deploy --context stage=prod --context allowedOrigins=https://your-ui.example.com`
