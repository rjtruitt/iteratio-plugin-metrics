/** Base plugin contract shared across all iteratio plugins. */
import type { Container } from 'inversify';

/** A monotonically increasing counter metric. */
export interface CounterMetric { value: number; inc(n?: number): void; reset(): void; }
/** A point-in-time gauge metric. */
export interface GaugeMetric { value: number; set(n: number): void; inc(n?: number): void; dec(n?: number): void; }
/** A distribution histogram metric. */
export interface HistogramMetric { observe(value: number): void; }

/** Context passed to lifecycle hooks. */
export interface TurnContext {
  turnNumber: number;
  messages: Array<{ role: string; content: string }>;
  state: Record<string, unknown>;
}

export interface IPlugin {
  name: string;
  version: string;
  initialize(container: Container): Promise<void>;
  shutdown(): Promise<void>;
}

/** Configuration for the metrics plugin. */
export interface MetricsConfig {
  prefix?: string;
  labels?: Record<string, string>;
  defaultLabels?: Record<string, string>;
}

/** Monotonically increasing counter instrument. */
export interface Counter {
  inc(value?: number): void;
  get(): number;
}

/** Instrument that tracks a value which can increase or decrease. */
export interface Gauge {
  set(value: number): void;
  inc(value?: number): void;
  dec(value?: number): void;
  get(): number;
}

/** Distribution instrument with percentile and average queries. */
export interface Histogram {
  observe(value: number): void;
  getCount(): number;
  getSum(): number;
  getAvg(): number;
  getPercentile(p: number): number;
}

/** Flat representation of a single metric for export/serialization. */
export interface MetricEntry {
  name: string;
  type: string;
  value: number;
  labels?: Record<string, string>;
}

/** Provides access to all registered metric instruments. */
export interface MetricRegistry {
  getCounter(name: string): CounterMetric;
  getGauge(name: string): GaugeMetric;
  getHistogram(name: string): HistogramMetric;
  getAllMetrics(): MetricEntry[];
}

/**
 * Class-based metrics plugin that auto-records turn duration, token usage,
 * tool execution time, and errors on each agent loop turn.
 */
export class MetricsPlugin implements IPlugin {
  readonly name = 'metrics';
  readonly version = '0.1.0';

  private prefix: string;
  private defaultLabels: Record<string, string>;
  private counters: Map<string, { value: number; labels: Record<string, string>; type: 'counter' }> = new Map();
  private gauges: Map<string, { value: number; labels: Record<string, string>; type: 'gauge' }> = new Map();
  private histograms: Map<string, { count: number; sum: number; buckets: Map<number, number>; labels: Record<string, string>; type: 'histogram' }> = new Map();
  private turnStartTime: number | undefined;

  /** Create a MetricsPlugin with optional prefix and default labels. */
  constructor(config?: MetricsConfig) {
    this.prefix = config?.prefix || '';
    this.defaultLabels = config?.defaultLabels || config?.labels || {};
  }

  /** Initialize the metrics plugin with a dependency injection container. */
  async initialize(container: Container): Promise<void> {}

  /** Update the metrics plugin configuration at runtime. */
  configure(config: MetricsConfig): void {
    if (config.prefix !== undefined) this.prefix = config.prefix;
    if (config.defaultLabels) this.defaultLabels = config.defaultLabels;
    if (config.labels) this.defaultLabels = config.labels;
  }

  /** Record turn start time before processing. */
  /** Record turn start time before processing. */
  async beforeTurn(ctx: TurnContext): Promise<void> {
    this.turnStartTime = ctx.startTime ?? Date.now();
  }

  /** Record metrics after a turn completes (duration, tokens, errors, etc.). */
  /** Record metrics after a turn completes (duration, tokens, errors, etc.). */
  async afterTurn(ctx: TurnContext): Promise<void> {
    if (this.turnStartTime !== undefined) {
      const endTime = ctx.endTime ?? Date.now();
      const duration = endTime - this.turnStartTime;
      const hist = this.getOrCreateHistogram(`${this.prefix}turn_duration_ms`);
      hist.count += 1;
      hist.sum += duration;
      this.turnStartTime = undefined;
    }

    if (ctx.toolCalls) {
      const hist = this.getOrCreateHistogram(`${this.prefix}tool_execution_duration_ms`);
      for (const call of ctx.toolCalls) {
        hist.count += 1;
        hist.sum += call.duration;
      }
    }

    if (ctx.tokenUsage) {
      const inputCounter = this.getOrCreateCounter(`${this.prefix}input_tokens_total`);
      inputCounter.value += ctx.tokenUsage.inputTokens;

      const outputCounter = this.getOrCreateCounter(`${this.prefix}output_tokens_total`);
      outputCounter.value += ctx.tokenUsage.outputTokens;
    }

    if (ctx.error) {
      const errorCounter = this.getOrCreateCounter(`${this.prefix}errors_total`);
      errorCounter.value += 1;
    } else if (!this.counters.has(`${this.prefix}errors_total`)) {
      this.getOrCreateCounter(`${this.prefix}errors_total`);
    }

    if (ctx.activeTasks !== undefined) {
      const gauge = this.getOrCreateGauge(`${this.prefix}active_tasks`);
      gauge.value = ctx.activeTasks;
    }
  }

  /** Shut down the metrics plugin. */
  async shutdown(): Promise<void> {}

  /** Return the metric registry for instrument access. */
  /** Return the metric registry for instrument access. */
  getMetrics(): MetricRegistry {
    return {
      getCounter: (name: string) => this.getOrCreateCounter(name),
      getGauge: (name: string) => this.getOrCreateGauge(name),
      getHistogram: (name: string) => this.getOrCreateHistogram(name),
      getAllMetrics: () => {
        const entries: MetricEntry[] = [];
        for (const [name, c] of this.counters.entries()) {
          entries.push({ name, type: 'counter', value: c.value, labels: c.labels });
        }
        for (const [name, g] of this.gauges.entries()) {
          entries.push({ name, type: 'gauge', value: g.value, labels: g.labels });
        }
        for (const [name, h] of this.histograms.entries()) {
          entries.push({ name, type: 'histogram', value: h.sum, labels: h.labels });
        }
        return entries;
      },
    };
  }

  private getOrCreateCounter(name: string) {
    if (!this.counters.has(name)) {
      this.counters.set(name, { value: 0, labels: { ...this.defaultLabels }, type: 'counter' });
    }
    return this.counters.get(name)!;
  }

  private getOrCreateGauge(name: string) {
    if (!this.gauges.has(name)) {
      this.gauges.set(name, { value: 0, labels: { ...this.defaultLabels }, type: 'gauge' });
    }
    return this.gauges.get(name)!;
  }

  private getOrCreateHistogram(name: string) {
    if (!this.histograms.has(name)) {
      this.histograms.set(name, { count: 0, sum: 0, buckets: new Map(), labels: { ...this.defaultLabels }, type: 'histogram' });
    }
    return this.histograms.get(name)!;
  }
}

/** Convenience factory for the metrics plugin. */
export function createMetricsPlugin(config?: MetricsConfig): MetricsPlugin {
  return new MetricsPlugin(config);
}

/**
 * Standalone metrics collector for fine-grained instrumentation.
 * Provides counter, gauge, and histogram instruments with label support.
 */
export class MetricsCollector {
  private counters: Map<string, { value: number; labels: Record<string, string> }> = new Map();
  private gauges: Map<string, { value: number; labels: Record<string, string> }> = new Map();
  private histogramData: Map<string, { observations: number[]; labels: Record<string, string> }> = new Map();

  private key(name: string, labels?: Record<string, string>): string {
    return labels ? `${name}|${JSON.stringify(labels)}` : name;
  }

  counter(name: string, labels?: Record<string, string>): Counter {
    const k = this.key(name, labels);
    if (!this.counters.has(k)) {
      this.counters.set(k, { value: 0, labels: labels || {} });
    }
    const state = this.counters.get(k)!;
    return {
      inc(value?: number) {
        const v = value ?? 1;
        if (v < 0) throw new Error('Counter cannot accept negative increments');
        state.value += v;
      },
      get() {
        return state.value;
      },
    };
  }

  gauge(name: string, labels?: Record<string, string>): Gauge {
    const k = this.key(name, labels);
    if (!this.gauges.has(k)) {
      this.gauges.set(k, { value: 0, labels: labels || {} });
    }
    const state = this.gauges.get(k)!;
    return {
      set(value: number) {
        state.value = value;
      },
      inc(value?: number) {
        state.value += value ?? 1;
      },
      dec(value?: number) {
        state.value -= value ?? 1;
      },
      get() {
        return state.value;
      },
    };
  }

  histogram(name: string, buckets?: number[], labels?: Record<string, string>): Histogram {
    const k = this.key(name, labels);
    if (!this.histogramData.has(k)) {
      this.histogramData.set(k, { observations: [], labels: labels || {} });
    }
    const state = this.histogramData.get(k)!;
    return {
      observe(value: number) {
        state.observations.push(value);
      },
      getCount() {
        return state.observations.length;
      },
      getSum() {
        return state.observations.reduce((a, b) => a + b, 0);
      },
      getAvg() {
        if (state.observations.length === 0) return 0;
        return this.getSum() / this.getCount();
      },
      getPercentile(p: number) {
        if (state.observations.length === 0) return 0;
        const sorted = [...state.observations].sort((a, b) => a - b);
        const index = Math.ceil((p / 100) * sorted.length) - 1;
        return sorted[Math.max(0, index)];
      },
    };
  }

  reset(): void {
    for (const state of this.counters.values()) {
      state.value = 0;
    }
    for (const state of this.gauges.values()) {
      state.value = 0;
    }
    for (const state of this.histogramData.values()) {
      state.observations = [];
    }
  }

  export(): MetricEntry[] {
    const entries: MetricEntry[] = [];

    for (const [key, state] of this.counters.entries()) {
      const name = key.includes('|') ? key.split('|')[0] : key;
      entries.push({ name, type: 'counter', value: state.value, labels: state.labels });
    }

    for (const [key, state] of this.gauges.entries()) {
      const name = key.includes('|') ? key.split('|')[0] : key;
      entries.push({ name, type: 'gauge', value: state.value, labels: state.labels });
    }

    for (const [key, state] of this.histogramData.entries()) {
      const name = key.includes('|') ? key.split('|')[0] : key;
      entries.push({
        name,
        type: 'histogram',
        value: state.observations.length > 0
          ? state.observations.reduce((a, b) => a + b, 0) / state.observations.length
          : 0,
        labels: state.labels,
      });
    }

    return entries;
  }
}

/** Convenience factory for the standalone metrics collector. */
export function createMetricsCollector(): MetricsCollector {
  return new MetricsCollector();
}
