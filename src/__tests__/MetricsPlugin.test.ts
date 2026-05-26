import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMetricsPlugin, MetricsPlugin } from '../MetricsPlugin';

describe('MetricsPlugin', () => {
  let plugin: MetricsPlugin;

  beforeEach(() => {
    plugin = createMetricsPlugin({
      prefix: 'iteratio_',
      defaultLabels: { agent: 'test-agent', model: 'claude-sonnet' },
    });
  });

  describe('turn duration metric', () => {
    it('should emit turn_duration_ms histogram on afterTurn', async () => {
      await plugin.beforeTurn({ turnNumber: 1, startTime: Date.now() - 1500 });
      await plugin.afterTurn({ turnNumber: 1, endTime: Date.now() });

      const registry = plugin.getMetrics();
      const histogram = registry.getHistogram('iteratio_turn_duration_ms');
      expect(histogram).toBeDefined();
      expect(histogram.type).toBe('histogram');
      expect(histogram.count).toBeGreaterThanOrEqual(1);
    });
  });

  describe('tool execution duration', () => {
    it('should emit tool_execution_duration_ms histogram per tool call', async () => {
      await plugin.afterTurn({
        turnNumber: 1,
        toolCalls: [
          { name: 'web_search', duration: 250 },
          { name: 'file_read', duration: 50 },
        ],
      });

      const registry = plugin.getMetrics();
      const histogram = registry.getHistogram('iteratio_tool_execution_duration_ms');
      expect(histogram).toBeDefined();
      expect(histogram.count).toBe(2);
    });
  });

  describe('token usage counters', () => {
    it('should emit input_tokens counter', async () => {
      await plugin.afterTurn({
        turnNumber: 1,
        tokenUsage: { inputTokens: 500, outputTokens: 200 },
      });

      const registry = plugin.getMetrics();
      const counter = registry.getCounter('iteratio_input_tokens_total');
      expect(counter).toBeDefined();
      expect(counter.type).toBe('counter');
      expect(counter.value).toBe(500);
    });

    it('should emit output_tokens counter', async () => {
      await plugin.afterTurn({
        turnNumber: 1,
        tokenUsage: { inputTokens: 500, outputTokens: 200 },
      });

      const registry = plugin.getMetrics();
      const counter = registry.getCounter('iteratio_output_tokens_total');
      expect(counter.value).toBe(200);
    });

    it('should accumulate tokens across turns', async () => {
      await plugin.afterTurn({ turnNumber: 1, tokenUsage: { inputTokens: 100, outputTokens: 50 } });
      await plugin.afterTurn({ turnNumber: 2, tokenUsage: { inputTokens: 200, outputTokens: 100 } });

      const registry = plugin.getMetrics();
      expect(registry.getCounter('iteratio_input_tokens_total').value).toBe(300);
      expect(registry.getCounter('iteratio_output_tokens_total').value).toBe(150);
    });
  });

  describe('error rate', () => {
    it('should emit error counter on turn failure', async () => {
      await plugin.afterTurn({ turnNumber: 1, error: new Error('LLM timeout') });

      const registry = plugin.getMetrics();
      const counter = registry.getCounter('iteratio_errors_total');
      expect(counter.value).toBe(1);
    });

    it('should not increment error counter on success', async () => {
      await plugin.afterTurn({ turnNumber: 1, error: null });

      const registry = plugin.getMetrics();
      const counter = registry.getCounter('iteratio_errors_total');
      expect(counter.value).toBe(0);
    });
  });

  describe('labels', () => {
    it('should attach agent label to all metrics', async () => {
      await plugin.afterTurn({ turnNumber: 1, tokenUsage: { inputTokens: 10, outputTokens: 5 } });

      const registry = plugin.getMetrics();
      const counter = registry.getCounter('iteratio_input_tokens_total');
      expect(counter.labels.agent).toBe('test-agent');
    });

    it('should attach model label to all metrics', async () => {
      await plugin.afterTurn({ turnNumber: 1, tokenUsage: { inputTokens: 10, outputTokens: 5 } });

      const registry = plugin.getMetrics();
      const counter = registry.getCounter('iteratio_input_tokens_total');
      expect(counter.labels.model).toBe('claude-sonnet');
    });
  });

  describe('metric types', () => {
    it('should use counter for monotonically increasing values', async () => {
      await plugin.afterTurn({ turnNumber: 1, tokenUsage: { inputTokens: 10, outputTokens: 5 } });

      const registry = plugin.getMetrics();
      expect(registry.getCounter('iteratio_input_tokens_total').type).toBe('counter');
    });

    it('should use gauge for current-value metrics', async () => {
      await plugin.afterTurn({ turnNumber: 3, activeTasks: 5 });

      const registry = plugin.getMetrics();
      const gauge = registry.getGauge('iteratio_active_tasks');
      expect(gauge.type).toBe('gauge');
      expect(gauge.value).toBe(5);
    });

    it('should use histogram for duration/distribution metrics', async () => {
      await plugin.afterTurn({
        turnNumber: 1,
        toolCalls: [{ name: 'search', duration: 100 }],
      });

      const registry = plugin.getMetrics();
      expect(registry.getHistogram('iteratio_tool_execution_duration_ms').type).toBe('histogram');
    });
  });
});
