# iteratio-plugin-metrics

Metrics collection plugin for iteratio.

## Install

```
npm install iteratio-plugin-metrics
```

## What It Does

Tracks token usage, latency, cost, and error rates for agent execution. Collects per-turn and per-tool statistics so you can monitor how your agents perform and how much they cost.

## Usage

```typescript
import { AgentLoop } from 'iteratio';
import { MetricsPlugin } from 'iteratio-plugin-metrics';

const metrics = new MetricsPlugin();

const loop = AgentLoop.builder()
  .withLLM(llm)
  .withPlugin(metrics)
  .build();

await loop.run({ messages });

const stats = metrics.getStats();
// { totalTokens, totalCost, avgLatency, errorRate, ... }
```

## License

MIT
