/**
 * Telemetry — sends trace spans directly to Honeycomb Events API.
 *
 * Follows Honeycomb Agentic Timeline spec (Gen AI Semantic Conventions v1.40.0):
 *   gen_ai.conversation.id  — groups all spans in one agent conversation
 *   gen_ai.agent.name       — unique agent identifier
 *   gen_ai.operation.name   — chat | execute_tool | invoke_agent | create_agent
 *
 * Span naming convention:
 *   chat {model}            — LLM calls
 *   execute_tool {name}     — tool calls
 *   invoke_agent {name}     — when one agent calls another
 *   create_agent {name}     — root span that starts an agent
 *
 * Distributed tracing:
 *   trace.trace_id, trace.span_id, trace.parent_id, session.id
 */

const HONEYCOMB_EVENTS_API = 'https://api.honeycomb.io/1/events';

const newId = () => crypto.randomUUID().replace(/-/g, '');

export interface TraceContext {
  traceId: string;
  parentSpanId?: string;
  conversationId?: string; // gen_ai.conversation.id — groups all traces in a session
}

export interface GenAISpanAttributes {
  'gen_ai.system': string;
  'gen_ai.operation.name': string;
  'gen_ai.request.model': string;
  'gen_ai.request.max_tokens'?: number;
  'gen_ai.response.model'?: string;
  'gen_ai.usage.input_tokens'?: number;
  'gen_ai.usage.output_tokens'?: number;
  'gen_ai.agent.name'?: string;
  'gen_ai.agent.role'?: string;
  'gen_ai.tool.name'?: string;
  'gen_ai.tool.call.id'?: string;
  'gen_ai.tool.call.arguments'?: string;
  'gen_ai.tool.call.result'?: string;
  'gen_ai.response.finish_reasons'?: string;
  'error.type'?: string;
  [key: string]: string | number | boolean | undefined;
}

export interface Span {
  spanId: string;
  end: (attrs?: Partial<GenAISpanAttributes>) => void;
}

function post(event: Record<string, unknown>): void {
  const apiKey = process.env.HONEYCOMB_API_KEY;
  const dataset = process.env.HONEYCOMB_DATASET ?? 'trading-orchestrator';
  if (!apiKey) return;

  fetch(`${HONEYCOMB_EVENTS_API}/${encodeURIComponent(dataset)}`, {
    method: 'POST',
    headers: { 'X-Honeycomb-Team': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(event),
  })
    .then((res) => {
      if (!res.ok) res.text().then((b) => console.error(`[Honeycomb] ${res.status}:`, b));
    })
    .catch((err) => console.error('[Honeycomb] fetch failed:', err));
}

/**
 * Send a one-off event to Honeycomb (no duration tracking).
 * Pass a TraceContext to anchor the event in the trace hierarchy with proper
 * trace.span_id and trace.parent_id — required for Honeycomb to place it correctly.
 */
export function sendEvent(
  name: string,
  attrs: Record<string, unknown>,
  trace?: TraceContext
): void {
  const event: Record<string, unknown> = {
    name,
    ...attrs,
    timestamp: new Date().toISOString(),
    'service.name': 'trading-orchestrator',
  };

  if (trace) {
    event['trace.trace_id'] = trace.traceId;
    event['trace.span_id'] = newId();           // unique ID for this event
    if (trace.parentSpanId) event['trace.parent_id'] = trace.parentSpanId;
    if (trace.conversationId) event['gen_ai.conversation.id'] = trace.conversationId;
  }

  post(event);
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
        if (trace.conversationId) event['gen_ai.conversation.id'] = trace.conversationId;
      }

      post(event);
    },
  };
}
