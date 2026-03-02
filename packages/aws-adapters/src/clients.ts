import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { EventBridgeClient } from '@aws-sdk/client-eventbridge';
import { SQSClient } from '@aws-sdk/client-sqs';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

export interface AwsAdapterClients {
  ddb: DynamoDBDocumentClient;
  sqs: SQSClient;
  eventBridge: EventBridgeClient;
}

function endpointConfig() {
  const endpoint = process.env.AWS_ENDPOINT_URL;
  if (!endpoint) {
    return {};
  }

  return {
    endpoint,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? 'test',
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? 'test'
    },
    region: process.env.AWS_REGION ?? 'us-west-2'
  };
}

export function buildAwsClients(): AwsAdapterClients {
  const config = endpointConfig();
  return {
    ddb: DynamoDBDocumentClient.from(new DynamoDBClient(config)),
    sqs: new SQSClient(config),
    eventBridge: new EventBridgeClient(config)
  };
}
