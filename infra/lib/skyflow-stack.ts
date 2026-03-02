import { Duration, RemovalPolicy, Stack, CfnOutput } from 'aws-cdk-lib';
import { Runtime, Tracing } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import {
  AttributeType,
  BillingMode,
  ProjectionType,
  Table
} from 'aws-cdk-lib/aws-dynamodb';
import { Queue } from 'aws-cdk-lib/aws-sqs';
import { HttpApi, HttpMethod, CorsHttpMethod } from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpJwtAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { UserPool, UserPoolClient } from 'aws-cdk-lib/aws-cognito';
import { Effect, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { EventBus } from 'aws-cdk-lib/aws-events';
import { Alarm, ComparisonOperator, Metric } from 'aws-cdk-lib/aws-cloudwatch';
import type { StackProps } from 'aws-cdk-lib';
import type { Construct } from 'constructs';

export class SkyFlowStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const flightsTable = new Table(this, 'FlightsTable', {
      billingMode: BillingMode.PAY_PER_REQUEST,
      partitionKey: { name: 'PK', type: AttributeType.STRING },
      sortKey: { name: 'SK', type: AttributeType.STRING },
      removalPolicy: RemovalPolicy.DESTROY
    });
    flightsTable.addGlobalSecondaryIndex({
      indexName: 'GSI1',
      partitionKey: { name: 'GSI1PK', type: AttributeType.STRING },
      sortKey: { name: 'GSI1SK', type: AttributeType.STRING },
      projectionType: ProjectionType.ALL
    });

    const slotsTable = new Table(this, 'SlotsTable', {
      billingMode: BillingMode.PAY_PER_REQUEST,
      partitionKey: { name: 'PK', type: AttributeType.STRING },
      sortKey: { name: 'SK', type: AttributeType.STRING },
      removalPolicy: RemovalPolicy.DESTROY
    });
    slotsTable.addGlobalSecondaryIndex({
      indexName: 'GSI1',
      partitionKey: { name: 'GSI1PK', type: AttributeType.STRING },
      sortKey: { name: 'GSI1SK', type: AttributeType.STRING },
      projectionType: ProjectionType.ALL
    });

    const idempotencyTable = new Table(this, 'IdempotencyTable', {
      billingMode: BillingMode.PAY_PER_REQUEST,
      partitionKey: { name: 'PK', type: AttributeType.STRING },
      sortKey: { name: 'SK', type: AttributeType.STRING },
      timeToLiveAttribute: 'ttl',
      removalPolicy: RemovalPolicy.DESTROY
    });

    const dedupeTable = new Table(this, 'DedupeTable', {
      billingMode: BillingMode.PAY_PER_REQUEST,
      partitionKey: { name: 'PK', type: AttributeType.STRING },
      timeToLiveAttribute: 'ttl',
      removalPolicy: RemovalPolicy.DESTROY
    });

    const capacityTable = new Table(this, 'CapacityTable', {
      billingMode: BillingMode.PAY_PER_REQUEST,
      partitionKey: { name: 'PK', type: AttributeType.STRING },
      sortKey: { name: 'SK', type: AttributeType.STRING },
      removalPolicy: RemovalPolicy.DESTROY
    });

    const workflowDlq = new Queue(this, 'WorkflowDLQ', {
      retentionPeriod: Duration.days(14)
    });

    const workflowQueue = new Queue(this, 'WorkflowQueue', {
      visibilityTimeout: Duration.seconds(60),
      deadLetterQueue: {
        queue: workflowDlq,
        maxReceiveCount: 5
      }
    });

    const eventBus = new EventBus(this, 'SkyFlowEventBus', {
      eventBusName: 'skyflow-domain-events'
    });

    const userPool = new UserPool(this, 'SkyFlowUserPool', {
      selfSignUpEnabled: false,
      signInAliases: {
        email: true
      }
    });

    const userPoolClient = new UserPoolClient(this, 'SkyFlowUserPoolClient', {
      userPool,
      generateSecret: false,
      authFlows: {
        userPassword: true,
        adminUserPassword: true
      }
    });

    const commonEnv = {
      FLIGHTS_TABLE_NAME: flightsTable.tableName,
      SLOTS_TABLE_NAME: slotsTable.tableName,
      IDEMPOTENCY_TABLE_NAME: idempotencyTable.tableName,
      DEDUPE_TABLE_NAME: dedupeTable.tableName,
      CAPACITY_TABLE_NAME: capacityTable.tableName,
      WORKFLOW_QUEUE_URL: workflowQueue.queueUrl,
      EVENT_BUS_NAME: eventBus.eventBusName
    };

    const lambdaDefaults = {
      runtime: Runtime.NODEJS_20_X,
      tracing: Tracing.ACTIVE,
      memorySize: 256,
      timeout: Duration.seconds(15),
      bundling: {
        minify: true,
        sourceMap: true,
        externalModules: []
      },
      environment: commonEnv
    };

    const postFlightRequestFn = new NodejsFunction(this, 'PostFlightRequestFn', {
      ...lambdaDefaults,
      entry: '../services/api/src/handlers/post-flight-request.ts',
      handler: 'handler'
    });

    const postDelayUpdateFn = new NodejsFunction(this, 'PostDelayUpdateFn', {
      ...lambdaDefaults,
      entry: '../services/api/src/handlers/post-delay-update.ts',
      handler: 'handler'
    });

    const getFlightStatusFn = new NodejsFunction(this, 'GetFlightStatusFn', {
      ...lambdaDefaults,
      entry: '../services/api/src/handlers/get-flight-status.ts',
      handler: 'handler'
    });

    const putAdminCapacityFn = new NodejsFunction(this, 'PutAdminCapacityFn', {
      ...lambdaDefaults,
      entry: '../services/api/src/handlers/put-admin-capacity.ts',
      handler: 'handler'
    });

    const getAdminCongestionFn = new NodejsFunction(this, 'GetAdminCongestionFn', {
      ...lambdaDefaults,
      entry: '../services/api/src/handlers/get-admin-congestion.ts',
      handler: 'handler'
    });

    const allocatorWorkerFn = new NodejsFunction(this, 'AllocatorWorkerFn', {
      ...lambdaDefaults,
      timeout: Duration.seconds(30),
      entry: '../services/allocator-worker/src/worker.ts',
      handler: 'handler'
    });

    allocatorWorkerFn.addEventSource(
      new SqsEventSource(workflowQueue, {
        batchSize: 5,
        reportBatchItemFailures: true
      })
    );

    const jwtAuthorizer = new HttpJwtAuthorizer(
      'SkyFlowJwtAuthorizer',
      `https://cognito-idp.${this.region}.amazonaws.com/${userPool.userPoolId}`,
      {
        jwtAudience: [userPoolClient.userPoolClientId]
      }
    );

    const httpApi = new HttpApi(this, 'SkyFlowApi', {
      corsPreflight: {
        allowHeaders: ['authorization', 'content-type', 'idempotency-key', 'x-correlation-id'],
        allowMethods: [
          CorsHttpMethod.GET,
          CorsHttpMethod.POST,
          CorsHttpMethod.PUT,
          CorsHttpMethod.OPTIONS
        ],
        allowOrigins: ['*']
      }
    });

    httpApi.addRoutes({
      path: '/v1/flights/requests',
      methods: [HttpMethod.POST],
      integration: new HttpLambdaIntegration('PostFlightRequestIntegration', postFlightRequestFn),
      authorizer: jwtAuthorizer
    });

    httpApi.addRoutes({
      path: '/v1/flights/{flightId}/delay',
      methods: [HttpMethod.POST],
      integration: new HttpLambdaIntegration('PostDelayUpdateIntegration', postDelayUpdateFn),
      authorizer: jwtAuthorizer
    });

    httpApi.addRoutes({
      path: '/v1/flights/{flightId}',
      methods: [HttpMethod.GET],
      integration: new HttpLambdaIntegration('GetFlightStatusIntegration', getFlightStatusFn),
      authorizer: jwtAuthorizer
    });

    httpApi.addRoutes({
      path: '/v1/admin/capacity',
      methods: [HttpMethod.PUT],
      integration: new HttpLambdaIntegration('PutAdminCapacityIntegration', putAdminCapacityFn),
      authorizer: jwtAuthorizer
    });

    httpApi.addRoutes({
      path: '/v1/admin/congestion',
      methods: [HttpMethod.GET],
      integration: new HttpLambdaIntegration('GetAdminCongestionIntegration', getAdminCongestionFn),
      authorizer: jwtAuthorizer
    });

    const flightsTableArn = flightsTable.tableArn;
    const flightsGsiArn = `${flightsTable.tableArn}/index/GSI1`;
    const slotsTableArn = slotsTable.tableArn;
    const slotsGsiArn = `${slotsTable.tableArn}/index/GSI1`;
    const idempotencyTableArn = idempotencyTable.tableArn;
    const dedupeTableArn = dedupeTable.tableArn;
    const capacityTableArn = capacityTable.tableArn;

    postFlightRequestFn.addToRolePolicy(
      new PolicyStatement({
        actions: ['dynamodb:PutItem'],
        resources: [flightsTableArn]
      })
    );
    postFlightRequestFn.addToRolePolicy(
      new PolicyStatement({
        actions: ['dynamodb:GetItem', 'dynamodb:PutItem'],
        resources: [idempotencyTableArn]
      })
    );
    postFlightRequestFn.addToRolePolicy(
      new PolicyStatement({
        actions: ['sqs:SendMessage'],
        resources: [workflowQueue.queueArn]
      })
    );

    postDelayUpdateFn.addToRolePolicy(
      new PolicyStatement({
        actions: ['dynamodb:GetItem', 'dynamodb:UpdateItem'],
        resources: [flightsTableArn]
      })
    );
    postDelayUpdateFn.addToRolePolicy(
      new PolicyStatement({
        actions: ['sqs:SendMessage'],
        resources: [workflowQueue.queueArn]
      })
    );

    getFlightStatusFn.addToRolePolicy(
      new PolicyStatement({
        actions: ['dynamodb:GetItem'],
        resources: [flightsTableArn]
      })
    );

    putAdminCapacityFn.addToRolePolicy(
      new PolicyStatement({
        actions: ['dynamodb:PutItem'],
        resources: [capacityTableArn]
      })
    );

    getAdminCongestionFn.addToRolePolicy(
      new PolicyStatement({
        actions: ['dynamodb:GetItem'],
        resources: [capacityTableArn]
      })
    );
    getAdminCongestionFn.addToRolePolicy(
      new PolicyStatement({
        actions: ['dynamodb:Query'],
        resources: [slotsTableArn, slotsGsiArn]
      })
    );

    allocatorWorkerFn.addToRolePolicy(
      new PolicyStatement({
        actions: ['dynamodb:PutItem'],
        resources: [dedupeTableArn]
      })
    );
    allocatorWorkerFn.addToRolePolicy(
      new PolicyStatement({
        actions: ['dynamodb:GetItem'],
        resources: [capacityTableArn]
      })
    );
    allocatorWorkerFn.addToRolePolicy(
      new PolicyStatement({
        actions: ['dynamodb:Query', 'dynamodb:UpdateItem'],
        resources: [flightsTableArn, flightsGsiArn]
      })
    );
    allocatorWorkerFn.addToRolePolicy(
      new PolicyStatement({
        actions: ['dynamodb:Query'],
        resources: [slotsTableArn, slotsGsiArn]
      })
    );
    allocatorWorkerFn.addToRolePolicy(
      new PolicyStatement({
        actions: ['dynamodb:BatchWriteItem'],
        resources: [slotsTableArn]
      })
    );
    allocatorWorkerFn.addToRolePolicy(
      new PolicyStatement({
        actions: ['events:PutEvents'],
        resources: [eventBus.eventBusArn]
      })
    );
    allocatorWorkerFn.addToRolePolicy(
      new PolicyStatement({
        actions: [
          'sqs:ReceiveMessage',
          'sqs:DeleteMessage',
          'sqs:ChangeMessageVisibility',
          'sqs:GetQueueAttributes',
          'sqs:GetQueueUrl'
        ],
        resources: [workflowQueue.queueArn]
      })
    );

    const dlqCountMetric = new Metric({
      namespace: 'AWS/SQS',
      metricName: 'ApproximateNumberOfMessagesVisible',
      dimensionsMap: {
        QueueName: workflowDlq.queueName
      },
      statistic: 'Maximum',
      period: Duration.minutes(5)
    });

    new Alarm(this, 'WorkflowDlqAlarm', {
      metric: dlqCountMetric,
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD
    });

    postFlightRequestFn.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.DENY,
        actions: ['secretsmanager:GetSecretValue'],
        resources: ['*']
      })
    );

    new CfnOutput(this, 'ApiEndpoint', {
      value: httpApi.url ?? 'n/a'
    });

    new CfnOutput(this, 'WorkflowQueueUrl', {
      value: workflowQueue.queueUrl
    });

    new CfnOutput(this, 'EventBusName', {
      value: eventBus.eventBusName
    });

    new CfnOutput(this, 'UserPoolId', {
      value: userPool.userPoolId
    });

    new CfnOutput(this, 'UserPoolClientId', {
      value: userPoolClient.userPoolClientId
    });
  }
}
