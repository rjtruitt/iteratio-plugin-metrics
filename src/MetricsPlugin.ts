/**
 * Functional implementation of the metrics plugin.
 * Auto-records turn duration, token usage, tool execution time, and errors.
 */

/** Contract for the metrics plugin returned by the factory. */
export interface MetricsPlugin {
  name: string;
  version: string;
  initialize(container: any): Promise<void>;
  beforeTurn(ctx: any): Promise<void>;
  afterTurn(ctx: any): Promise<void>;
  getMetrics(): MetricRegistry;
  shutdown(): Promise<void>;
}

/** Provides access to all registered metric instruments. */
export interface MetricRegistry {
  getCounter(name: string): Counter;
  getGauge(name: string): Gauge;
  getHistogram(name: string): Histogram;
  getAllMetrics(): MetricEntry[];
}

/** Monotonically increasing counter metric. */
export interface Counter {
  value: number;
  labels: Record<string, string>;
  type: 'counter';
}

/** Point-in-time gauge metric (can go up or down). */
export interface Gauge {
  value: number;
  labels: Record<string, string>;
  type: 'gauge';
}

/** Distribution metric tracking count, sum, and bucket boundaries. */
export interface Histogram {
  count: number;
  sum: number;
  buckets: Map<number, number>;
  labels: Record<string, string>;
  type: 'histogram';
}

/** Flat representation of a single metric for export/serialization. */
export interface MetricEntry {
  name: string;
  type: 'counter' | 'gauge' | 'histogram';
  value: number;
  labels: Record<string, string>;
}

/**
 * Factory that creates a metrics plugin which automatically instruments
 * turn duration, tool calls, token usage, and error counts.
 */
export function createMetricsPlugin(config?: any): MetricsPlugin {
  const prefix = config?.prefix || '';
  const defaultLabels: Record<string, string> = config?.defaultLabels || {};

  const counters: Map<string, { value: number; labels: Record<string, string>; type: 'counter' }> = new Map();
  const gauges: Map<string, { value: number; labels: Record<string, string>; type: 'gauge' }> = new Map();
  const histograms: Map<string, { count: number; sum: number; buckets: Map<number, number>; labels: Record<string, string>; type: 'histogram' }> = new Map();

  let turnStartTime: number | undefined;

  function getOrCreateCounter(name: string): Counter {
    if (!counters.has(name)) {
      counters.set(name, { value: 0, labels: { ...defaultLabels }, type: 'counter' });
    }
    return counters.get(name)!;
  }

  function getOrCreateGauge(name: string): Gauge {
    if (!gauges.has(name)) {
      gauges.set(name, { value: 0, labels: { ...defaultLabels }, type: 'gauge' });
    }
    return gauges.get(name)!;
  }

  function getOrCreateHistogram(name: string): Histogram {
    if (!histograms.has(name)) {
      histograms.set(name, { count: 0, sum: 0, buckets: new Map(), labels: { ...defaultLabels }, type: 'histogram' });
    }
    return histograms.get(name)!;
  }

  const registry: MetricRegistry = {
    getCounter(name: string): Counter {
      return getOrCreateCounter(name);
    },
    getGauge(name: string): Gauge {
      return getOrCreateGauge(name);
    },
    getHistogram(name: string): Histogram {
      return getOrCreateHistogram(name);
    },
    getAllMetrics(): MetricEntry[] {
      const entries: MetricEntry[] = [];
      for (const [name, c] of counters.entries()) {
        entries.push({ name, type: 'counter', value: c.value, labels: c.labels });
      }
      for (const [name, g] of gauges.entries()) {
        entries.push({ name, type: 'gauge', value: g.value, labels: g.labels });
      }
      for (const [name, h] of histograms.entries()) {
        entries.push({ name, type: 'histogram', value: h.sum, labels: h.labels });
      }
      return entries;
    },
  };

  return {
    name: 'metrics',
    version: '0.1.0',

    /** Initialize the metrics plugin. */
    async initialize(container: any): Promise<void> {},

    /** Record turn start time before processing. */
    async beforeTurn(ctx: any): Promise<void> {
      turnStartTime = ctx.startTime ?? Date.now();
    },

    /** Record turn metrics including duration, tokens, tool calls, and errors. */
    async afterTurn(ctx: any): Promise<void> {
      if (turnStartTime !== undefined) {
        const endTime = ctx.endTime ?? Date.now();
        const duration = endTime - turnStartTime;
        const hist = getOrCreateHistogram(`${prefix}turn_duration_ms`);
        hist.count += 1;
        hist.sum += duration;
        turnStartTime = undefined;
      }

      if (ctx.toolCalls) {
        const hist = getOrCreateHistogram(`${prefix}tool_execution_duration_ms`);
        for (const call of ctx.toolCalls) {
          hist.count += 1;
          hist.sum += call.duration;
        }
      }

      if (ctx.tokenUsage) {
        const inputCounter = getOrCreateCounter(`${prefix}input_tokens_total`);
        inputCounter.value += ctx.tokenUsage.inputTokens;

        const outputCounter = getOrCreateCounter(`${prefix}output_tokens_total`);
        outputCounter.value += ctx.tokenUsage.outputTokens;
      }

      if (ctx.error) {
        const errorCounter = getOrCreateCounter(`${prefix}errors_total`);
        errorCounter.value += 1;
      } else if (!counters.has(`${prefix}errors_total`)) {
        getOrCreateCounter(`${prefix}errors_total`);
      }

      if (ctx.activeTasks !== undefined) {
        const gauge = getOrCreateGauge(`${prefix}active_tasks`);
        gauge.value = ctx.activeTasks;
      }
    },

    /** Return the metric registry for instrument access. */
    getMetrics(): MetricRegistry {
      return registry;
    },

    /** Shut down the metrics plugin. */
    async shutdown(): Promise<void> {},
  };
}
