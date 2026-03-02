import type { SQSHandler } from 'aws-lambda';

import { processWorkflowMessage, type WorkflowMessage } from '@skyflow/application';
import type { DomainEventEnvelope } from '@skyflow/domain';
import { emitMetrics } from '@skyflow/shared';

import type { WorkerDependencies } from './dependencies.js';
import { createWorkerDependencies } from './dependencies.js';

export function createWorkerHandler(deps: WorkerDependencies): SQSHandler {
  return async (event) => {
    for (const record of event.Records) {
      const now = new Date().toISOString();
      const message = JSON.parse(record.body) as WorkflowMessage;
      const start = Date.now();

      try {
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

        deps.logger.info('Workflow message processed', {
          correlationId: message.correlationId,
          eventId: message.eventId
        }, {
          assignedCount: outcome.assignedCount,
          holdingCount: outcome.holdingCount
        });
      } catch (error) {
        const failedEvent: DomainEventEnvelope<'skyflow.flight.failed.v1', Record<string, string>> = {
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

        deps.logger.error(
          'Workflow message failed',
          {
            correlationId: message.correlationId,
            eventId: message.eventId
          },
          { error }
        );

        // Throw to trigger SQS redrive policy and DLQ routing.
        throw error;
      }
    }
  };
}

export const handler = createWorkerHandler(createWorkerDependencies());
