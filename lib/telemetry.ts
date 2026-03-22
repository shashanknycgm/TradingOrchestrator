/**
 * Telemetry — sends trace spans directly to Honeycomb Events API.
 *
 * Each agent call becomes a child span within a per-ticker trace:
 *   trace.trace_id   — one per ticker analysis run
 *   trace.span_id    — one per agent call
 *   trace.parent_id  — links child spans to the root ticker.analysis span
 *
 * Gen AI semantic conventions also emitted:
 *   gen_ai.system, gen_ai.operation.name, gen_ai.request.model,
 *   gen_ai.request.max_tokens, gen_ai.usage.input_tokens,
 *   gen_ai.usage.output_tokens, gen_ai.agent.name, duration_ms
 */

const HONEYCOMB_EVENTS_API = 'https://api.honeycomb.io/1/events';

const newId = () => crypto.randomUUID().replace(/-/g, '');

export interface TraceContext {
  traceId: string;
  parentSpanId?: string;
}

export interface GenAISpanAttributes {
  'gen_ai.system': string;
  'gen_ai.operation.name': string;
  'gen_ai.request.model': string;
  'gen_ai.request.max_tokens'?: number;
  'gen_ai.usage.input_tokens'?: number;
  'gen_ai.usage.output_tokens'?: number;
  'gen_ai.agent.name'?: string;
  'gen_ai.agent.role'?: string;
  [key: string]: string | number | boolean | undefined;
}

export interface Span {
  spanId: string;
  end: (attrs?: Partial<GenAISpanAttributes>) => void;
}

export function startSpan(
  name: string,
  attrs: GenAISpanAttributes,
  trace?: TraceContext
): Span {
  const startMs = Date.now();
  const spanId = newId();

  return {
    spanId,
    end: (endAttrs?: Partial<GenAISpanAttributes>) => {
      const apiKey = process.env.HONEYCOMB_API_KEY;
      const dataset = process.env.HONEYCOMB_DATASET ?? 'trading-orchestrator';
      if (!apiKey) return;

      const event: Record<string, unknown> = {
        name,
        ...attrs,
        ...endAttrs,
        duration_ms: Date.now() - startMs,
        timestamp: new Date(startMs).toISOString(),
        'service.name': 'trading-orchestrator',
      };

      if (trace) {
        event['trace.trace_id'] = trace.traceId;
        event['trace.span_id'] = spanId;
        if (trace.parentSpanId) event['trace.parent_id'] = trace.parentSpanId;
      }

      fetch(`${HONEYCOMB_EVENTS_API}/${encodeURIComponent(dataset)}`, {
        method: 'POST',
        headers: {
          'X-Honeycomb-Team': apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(event),
      }).then((res) => {
        if (!res.ok) res.text().then((b) => console.error(`[Honeycomb] ${res.status}:`, b));
      }).catch((err) => console.error('[Honeycomb] fetch failed:', err));
    },
  };
}
