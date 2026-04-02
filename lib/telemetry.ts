/**
 * Honeycomb telemetry — direct Events API, no SDK.
 *
 * Follows OTel Gen AI Semantic Conventions v1.40.0 for the Agentic Timeline:
 *   gen_ai.conversation.id  — one per "Run Agents" click (groups all tickers + all traces)
 *   gen_ai.agent.name       — unique per agent (oracle, axiom, vega, edge)
 *   gen_ai.operation.name   — create_agent | invoke_agent | chat | execute_tool
 *
 * Span naming:
 *   create_agent {agent}    — root span when ORACLE starts
 *   invoke_agent {agent}    — ORACLE calling a sub-agent
 *   chat {model}            — every LLM call
 *   execute_tool {name}     — every tool call (AXIOM web_search)
 *
 * Distributed tracing:
 *   trace.trace_id          — one per ticker analysis
 *   trace.span_id           — one per span
 *   trace.parent_id         — links child → parent
 */

const HONEYCOMB_EVENTS_API = 'https://api.honeycomb.io/1/events';
const newId = () => crypto.randomUUID().replace(/-/g, '');

export interface TraceContext {
  traceId: string;
  parentSpanId?: string;
  conversationId: string;
}

export interface Span {
  spanId: string;
  end: (attrs?: Record<string, unknown>) => void;
}

function post(payload: Record<string, unknown>): void {
  const apiKey = process.env.HONEYCOMB_API_KEY;
  const dataset = process.env.HONEYCOMB_DATASET ?? 'trading-orchestrator';
  if (!apiKey) return;

  fetch(`${HONEYCOMB_EVENTS_API}/${encodeURIComponent(dataset)}`, {
    method: 'POST',
    headers: { 'X-Honeycomb-Team': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
    .then((res) => { if (!res.ok) res.text().then((b) => console.error(`[Honeycomb] ${res.status}:`, b)); })
    .catch((err) => console.error('[Honeycomb] fetch failed:', err));
}

export function startSpan(
  name: string,
  attrs: Record<string, unknown>,
  trace: TraceContext,
): Span {
  const startMs = Date.now();
  const spanId = newId();

  return {
    spanId,
    end: (endAttrs?: Record<string, unknown>) => {
      post({
        name,
        ...attrs,
        ...endAttrs,
        'gen_ai.conversation.id': trace.conversationId,
        'trace.trace_id': trace.traceId,
        'trace.span_id': spanId,
        ...(trace.parentSpanId ? { 'trace.parent_id': trace.parentSpanId } : {}),
        duration_ms: Date.now() - startMs,
        timestamp: new Date(startMs).toISOString(),
        'service.name': 'trading-orchestrator',
      });
    },
  };
}
