/**
 * Telemetry stub — wired for Honeycomb via OpenTelemetry.
 * Add HONEYCOMB_API_KEY + HONEYCOMB_DATASET to .env.local to activate.
 *
 * Gen AI semantic conventions used:
 *   gen_ai.system, gen_ai.request.model, gen_ai.operation.name,
 *   gen_ai.usage.input_tokens, gen_ai.usage.output_tokens,
 *   gen_ai.request.max_tokens, gen_ai.agent.name
 */

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

/**
 * Start a telemetry span for a Gen AI operation.
 * Currently logs to console; swap body for @honeycombio/opentelemetry-node
 * once HONEYCOMB_API_KEY is provided.
 */
export function startSpan(name: string, attrs: GenAISpanAttributes): Span {
  const honeycombKey = process.env.HONEYCOMB_API_KEY;
  const start = Date.now();

  if (honeycombKey) {
    // TODO: replace with real Honeycomb OTel span when key is provided
    // const { trace } = require('@opentelemetry/api');
    // const tracer = trace.getTracer('trading-orchestrator');
    // const span = tracer.startSpan(name, { attributes: attrs });
    // return { end: (endAttrs) => { span.setAttributes(endAttrs ?? {}); span.end(); } };
  }

  // Console fallback (dev / no Honeycomb key)
  if (process.env.NODE_ENV !== 'production') {
    console.log(`[SPAN:START] ${name}`, attrs);
  }

  return {
    end: (endAttrs?: Partial<GenAISpanAttributes>) => {
      const duration = Date.now() - start;
      if (process.env.NODE_ENV !== 'production') {
        console.log(`[SPAN:END] ${name} +${duration}ms`, endAttrs ?? {});
      }
    },
  };
}
