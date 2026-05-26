import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMetricsCollector, MetricsCollector } from '../MetricsCollection';

describe('MetricsCollection', () => {
  let collector: MetricsCollector;

  beforeEach(() => {
    collector = createMetricsCollector();
  });

  describe('Counter', () => {
    it('should start at zero', () => {
      const counter = collector.counter('requests_total');
      expect(counter.get()).toBe(0);
    });

    it('should increment by 1 by default', () => {
      const counter = collector.counter('requests_total');
      counter.inc();
      expect(counter.get()).toBe(1);
    });

    it('should increment by specified value', () => {
      const counter = collector.counter('tokens_total');
      counter.inc(100);
      counter.inc(50);
      expect(counter.get()).toBe(150);
    });

    it('should not allow negative increments', () => {
      const counter = collector.counter('positive_only');
      expect(() => counter.inc(-5)).toThrow(/negative|positive/i);
    });

    it('should support labels', () => {
      const c1 = collector.counter('requests_total', { method: 'GET' });
      const c2 = collector.counter('requests_total', { method: 'POST' });

      c1.inc(10);
      c2.inc(5);

      expect(c1.get()).toBe(10);
      expect(c2.get()).toBe(5);
    });
  });

  describe('Gauge', () => {
    it('should start at zero', () => {
      const gauge = collector.gauge('active_connections');
      expect(gauge.get()).toBe(0);
    });

    it('should set to specific value', () => {
      const gauge = collector.gauge('temperature');
      gauge.set(72.5);
      expect(gauge.get()).toBe(72.5);
    });

    it('should increment', () => {
      const gauge = collector.gauge('active_tasks');
      gauge.inc();
      gauge.inc();
      expect(gauge.get()).toBe(2);
    });

    it('should decrement', () => {
      const gauge = collector.gauge('active_tasks');
      gauge.set(5);
      gauge.dec();
      gauge.dec(2);
      expect(gauge.get()).toBe(2);
    });

    it('should allow negative values', () => {
      const gauge = collector.gauge('balance');
      gauge.set(-10);
      expect(gauge.get()).toBe(-10);
    });
  });

  describe('Histogram', () => {
    it('should record observations', () => {
      const hist = collector.histogram('response_time_ms');
      hist.observe(100);
      hist.observe(200);
      hist.observe(150);

      expect(hist.getCount()).toBe(3);
    });

    it('should track sum of observations', () => {
      const hist = collector.histogram('response_time_ms');
      hist.observe(100);
      hist.observe(200);
      hist.observe(300);

      expect(hist.getSum()).toBe(600);
    });

    it('should calculate average', () => {
      const hist = collector.histogram('duration_ms');
      hist.observe(100);
      hist.observe(200);
      hist.observe(300);

      expect(hist.getAvg()).toBe(200);
    });

    it('should calculate p95 percentile', () => {
      const hist = collector.histogram('latency_ms');
      // Add 100 observations: 1, 2, 3, ..., 100
      for (let i = 1; i <= 100; i++) {
        hist.observe(i);
      }

      const p95 = hist.getPercentile(95);
      expect(p95).toBeGreaterThanOrEqual(94);
      expect(p95).toBeLessThanOrEqual(96);
    });

    it('should calculate p99 percentile', () => {
      const hist = collector.histogram('latency_ms');
      for (let i = 1; i <= 100; i++) {
        hist.observe(i);
      }

      const p99 = hist.getPercentile(99);
      expect(p99).toBeGreaterThanOrEqual(98);
      expect(p99).toBeLessThanOrEqual(100);
    });

    it('should handle empty histogram gracefully', () => {
      const hist = collector.histogram('empty');

      expect(hist.getCount()).toBe(0);
      expect(hist.getSum()).toBe(0);
      expect(hist.getAvg()).toBe(0);
    });
  });

  describe('labels', () => {
    it('should attach labels to counters', () => {
      const counter = collector.counter('http_requests', { status: '200', method: 'GET' });
      counter.inc(5);

      const snapshots = collector.export();
      const metric = snapshots.find(s => s.name === 'http_requests' && s.labels.status === '200');
      expect(metric).toBeDefined();
      expect(metric!.labels.method).toBe('GET');
    });

    it('should differentiate metrics with different labels', () => {
      const ok = collector.counter('requests', { status: '200' });
      const err = collector.counter('requests', { status: '500' });

      ok.inc(100);
      err.inc(3);

      expect(ok.get()).toBe(100);
      expect(err.get()).toBe(3);
    });
  });

  describe('aggregation', () => {
    it('should export all metrics with timestamps', () => {
      collector.counter('c1').inc(10);
      collector.gauge('g1').set(42);
      collector.histogram('h1').observe(100);

      const snapshots = collector.export();
      expect(snapshots.length).toBeGreaterThanOrEqual(3);
      for (const s of snapshots) {
        expect(s.timestamp).toBeGreaterThan(0);
      }
    });
  });

  describe('reset', () => {
    it('should reset all metrics to initial values', () => {
      const counter = collector.counter('requests');
      const gauge = collector.gauge('active');

      counter.inc(50);
      gauge.set(10);

      collector.reset();

      expect(counter.get()).toBe(0);
      expect(gauge.get()).toBe(0);
    });

    it('should reset histograms', () => {
      const hist = collector.histogram('latency');
      hist.observe(100);
      hist.observe(200);

      collector.reset();

      expect(hist.getCount()).toBe(0);
      expect(hist.getSum()).toBe(0);
    });
  });
});
