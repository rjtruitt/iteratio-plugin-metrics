/**
 * Standalone metrics collector for fine-grained instrumentation.
 * Provides counter, gauge, and histogram instruments with label support,
 * percentile computation, and point-in-time snapshot export.
 */

/** Contract for the metrics collector returned by the factory. */
export interface MetricsCollector {
  counter(name: string, labels?: Record<string, string>): CounterMetric;
  gauge(name: string, labels?: Record<string, string>): GaugeMetric;
  histogram(name: string, buckets?: number[], labels?: Record<string, string>): HistogramMetric;
  reset(): void;
  export(): MetricSnapshot[];
}

/** Monotonically increasing counter instrument. */
export interface CounterMetric {
  inc(value?: number): void;
  get(): number;
}

/** Instrument that tracks a value which can increase or decrease. */
export interface GaugeMetric {
  set(value: number): void;
  inc(value?: number): void;
  dec(value?: number): void;
  get(): number;
}

/** Distribution instrument with percentile and average queries. */
export interface HistogramMetric {
  observe(value: number): void;
  getCount(): number;
  getSum(): number;
  getAvg(): number;
  getPercentile(p: number): number;
}

/** Serializable point-in-time metric reading. */
export interface MetricSnapshot {
  name: string;
  type: 'counter' | 'gauge' | 'histogram';
  value: number;
  labels: Record<string, string>;
  timestamp: number;
}

/**
 * Creates a metrics collector that maintains counters, gauges, and histograms
 * in memory with label-based deduplication.
 */
export function createMetricsCollector(): MetricsCollector {
  const counters: Map<string, { value: number; labels: Record<string, string> }> = new Map();
  const gauges: Map<string, { value: number; labels: Record<string, string> }> = new Map();
  const histograms: Map<string, { observations: number[]; labels: Record<string, string> }> = new Map();

  function counterKey(name: string, labels?: Record<string, string>): string {
    return labels ? `${name}|${JSON.stringify(labels)}` : name;
  }

  return {
    counter(name: string, labels?: Record<string, string>): CounterMetric {
      const key = counterKey(name, labels);
      if (!counters.has(key)) {
        counters.set(key, { value: 0, labels: labels || {} });
      }
      const state = counters.get(key)!;
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
    },

    gauge(name: string, labels?: Record<string, string>): GaugeMetric {
      const key = counterKey(name, labels);
      if (!gauges.has(key)) {
        gauges.set(key, { value: 0, labels: labels || {} });
      }
      const state = gauges.get(key)!;
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
    },

    histogram(name: string, buckets?: number[], labels?: Record<string, string>): HistogramMetric {
      const key = counterKey(name, labels);
      if (!histograms.has(key)) {
        histograms.set(key, { observations: [], labels: labels || {} });
      }
      const state = histograms.get(key)!;
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
    },

    /** Reset all metric values to zero. */
    reset() {
      for (const state of counters.values()) {
        state.value = 0;
      }
      for (const state of gauges.values()) {
        state.value = 0;
      }
      for (const state of histograms.values()) {
        state.observations = [];
      }
    },

    /** Export all metrics as serializable snapshot entries. */
    export(): MetricSnapshot[] {
      const now = Date.now();
      const snapshots: MetricSnapshot[] = [];

      for (const [key, state] of counters.entries()) {
        const name = key.includes('|') ? key.split('|')[0] : key;
        snapshots.push({
          name,
          type: 'counter',
          value: state.value,
          labels: state.labels,
          timestamp: now,
        });
      }

      for (const [key, state] of gauges.entries()) {
        const name = key.includes('|') ? key.split('|')[0] : key;
        snapshots.push({
          name,
          type: 'gauge',
          value: state.value,
          labels: state.labels,
          timestamp: now,
        });
      }

      for (const [key, state] of histograms.entries()) {
        const name = key.includes('|') ? key.split('|')[0] : key;
        snapshots.push({
          name,
          type: 'histogram',
          value: state.observations.length > 0
            ? state.observations.reduce((a, b) => a + b, 0) / state.observations.length
            : 0,
          labels: state.labels,
          timestamp: now,
        });
      }

      return snapshots;
    },
  };
}
