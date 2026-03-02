import type { SQSBatchItemFailure, SQSBatchResponse, SQSEvent } from 'aws-lambda';

import { processWorkflowMessage, type WorkflowMessage } from '@skyflow/application';
import type { DomainEventEnvelope } from '@skyflow/domain';
import { emitMetrics } from '@skyflow/shared';

import type { WorkerDependencies } from './dependencies.js';
import { createWorkerDependencies } from './dependencies.js';

export function createWorkerHandler(
  deps: WorkerDependencies
): (event: SQSEvent) => Promise<SQSBatchResponse> {
  return async (event: SQSEvent): Promise<SQSBatchResponse> => {
    const batchItemFailures: SQSBatchItemFailure[] = [];

    for (const record of event.Records) {
      const now = new Date().toISOString();
      let message: WorkflowMessage | undefined;

      try {
        message = JSON.parse(record.body) as WorkflowMessage;
        const start = Date.now();
        const outcome = await processWorkflowMessage(message, now, deps);
        const latency = Date.now() - start;

        emitMetrics(
          {
            namespace: 'SkyFlow',
            service: 'skyflow-allocator-worker',
            dimensions: { Queue: 'allocation-workflow' }
          },
          [
            { name: 'slot_assignment_latency', unit: 'Milliseconds', value: latency },
            { name: 'rebalance_count', unit: 'Count', value: outcome.rebalanceCount },
            { name: 'holding_queue_depth', unit: 'Count', value: outcome.holdingCount },
            { name: 'allocation_conflicts', unit: 'Count', value: outcome.conflictCount },
            { name: 'congestion_index', unit: 'None', value: outcome.congestionIndex }
          ]
        );

        for (const [airlineId, allocationCount] of Object.entries(outcome.fairnessIndicators)) {
          emitMetrics(
            {
              namespace: 'SkyFlow',
              service: 'skyflow-allocator-worker',
              dimensions: { Queue: 'allocation-workflow', AirlineId: airlineId }
            },
            [{ name: 'fairness_allocation_count', unit: 'Count', value: allocationCount }]
          );
        }

        deps.logger.info(
          'Workflow message processed',
          {
            correlationId: message.correlationId,
            eventId: message.eventId
          },
          {
            assignedCount: outcome.assignedCount,
            holdingCount: outcome.holdingCount
          }
        );
      } catch (error) {
        if (message) {
          const failedEvent: DomainEventEnvelope<
            'skyflow.flight.failed.v1',
            Record<string, string>
          > = {
            eventId: `${message.eventId}#failed`,
            correlationId: message.correlationId,
            causationId: message.eventId,
            eventType: 'skyflow.flight.failed.v1',
            eventVersion: '1.0.0',
            eventTime: new Date().toISOString(),
            detail: {
              airportId: message.airportId,
              flightId: message.flightId,
              reason: 'Workflow processing failed; message will retry or move to DLQ'
            }
          };

          try {
            await deps.events.publish(failedEvent);
          } catch {
            // Preserve primary failure path; DLQ remains authoritative fallback.
          }
        }

        deps.logger.error(
          'Workflow message failed',
          {
            correlationId: message?.correlationId ?? 'unknown',
            eventId: message?.eventId ?? record.messageId
          },
          { error }
        );

        batchItemFailures.push({ itemIdentifier: record.messageId });
      }
    }

    return { batchItemFailures };
  };
}

let defaultHandler: ReturnType<typeof createWorkerHandler> | undefined;
export const handler = async (event: SQSEvent): Promise<SQSBatchResponse> => {
  if (!defaultHandler) {
    defaultHandler = createWorkerHandler(createWorkerDependencies());
  }

  return defaultHandler(event);
};
