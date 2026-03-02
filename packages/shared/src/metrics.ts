export type MetricUnit = 'Count' | 'Milliseconds' | 'Percent' | 'None';

export interface MetricDatum {
  name: string;
  unit: MetricUnit;
  value: number;
}

export interface MetricContext {
  namespace: string;
  service: string;
  dimensions: Record<string, string>;
}

export function emitMetrics(context: MetricContext, metrics: MetricDatum[]): void {
  const dimensions = Object.keys(context.dimensions);
  const payload: Record<string, unknown> = {
    _aws: {
      Timestamp: Date.now(),
      CloudWatchMetrics: [
        {
          Namespace: context.namespace,
          Dimensions: [dimensions],
          Metrics: metrics.map((metric) => ({ Name: metric.name, Unit: metric.unit }))
        }
      ]
    },
    service: context.service,
    ...context.dimensions
  };

  for (const metric of metrics) {
    payload[metric.name] = metric.value;
  }

  console.log(JSON.stringify(payload));
}
