/**
 * Telemetry — sends events directly to Honeycomb Events API.
 * No SDK init required. Dataset is auto-created on first event.
 *
 * Gen AI semantic conventions per span:
 *   gen_ai.system            = "anthropic"
 *   gen_ai.operation.name    = "chat"
 *   gen_ai.request.model     = "claude-sonnet-4-6"
 *   gen_ai.request.max_tokens
 *   gen_ai.usage.input_tokens
 *   gen_ai.usage.output_tokens
 *   gen_ai.agent.name        = "oracle" | "axiom" | "vega" | "edge"
 *   duration_ms              = wall-clock time of the LLM call
 */

const HONEYCOMB_EVENTS_API = 'https://api.honeycomb.io/1/events';

export interface GenAISpanAttributes {
  'gen_ai.system': string;
  'gen_ai.operation.name': string;
  'gen_ai.request.model': string;
  'gen_ai.request.max_tokens'?: number;
  'gen_ai.usage.input_tokens'?: number;
  'gen_ai.usage.output_tokens'?: number;
  'gen_ai.agent.name'?: string;
  [key: string]: string | number | boolean | undefined;
}

export interface Span {
  end: (attrs?: Partial<GenAISpanAttributes>) => void;
}

export function startSpan(name: string, attrs: GenAISpanAttributes): Span {
  const startMs = Date.now();

  return {
    end: (endAttrs?: Partial<GenAISpanAttributes>) => {
      const apiKey = process.env.HONEYCOMB_API_KEY;
      const dataset = process.env.HONEYCOMB_DATASET ?? 'trading-orchestrator';
      if (!apiKey) return;

      const event = {
        name,
        ...attrs,
        ...endAttrs,
        duration_ms: Date.now() - startMs,
        timestamp: new Date(startMs).toISOString(),
        'service.name': 'trading-orchestrator',
      };

      fetch(`${HONEYCOMB_EVENTS_API}/${encodeURIComponent(dataset)}`, {
        method: 'POST',
        headers: {
          'X-Honeycomb-Team': apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(event),
      }).catch(() => {}); // fire-and-forget
    },
  };
}
