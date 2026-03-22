/**
 * Telemetry — Honeycomb via OpenTelemetry, Gen AI semantic conventions.
 *
 * Activated automatically when HONEYCOMB_API_KEY is set in .env.local.
 * The SDK is initialised in instrumentation.ts (Next.js instrumentationHook).
 *
 * Gen AI semantic conventions emitted per span:
 *   gen_ai.system            = "anthropic"
 *   gen_ai.operation.name    = "chat"
 *   gen_ai.request.model     = "claude-sonnet-4-6"
 *   gen_ai.request.max_tokens
 *   gen_ai.usage.input_tokens
 *   gen_ai.usage.output_tokens
 *   gen_ai.agent.name        = "oracle" | "axiom" | "vega" | "edge"
 */

import { trace, SpanStatusCode, type Span as OtelSpan } from '@opentelemetry/api';

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

const TRACER_NAME = 'trading-orchestrator';

export function startSpan(name: string, attrs: GenAISpanAttributes): Span {
  const tracer = trace.getTracer(TRACER_NAME);
  const span: OtelSpan = tracer.startSpan(name, {
    attributes: attrs as Record<string, string | number | boolean>,
  });

  return {
    end: (endAttrs?: Partial<GenAISpanAttributes>) => {
      if (endAttrs) {
        span.setAttributes(endAttrs as Record<string, string | number | boolean>);
      }
      span.setStatus({ code: SpanStatusCode.OK });
      span.end();
    },
  };
}
