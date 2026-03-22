import { getAnthropicClient, MODEL } from '../anthropic';
import { startSpan } from '../telemetry';
import type { TraceContext } from '../telemetry';
import { formatHistory } from './utils';
import type { ConversationMessage, AgentName, SendFn } from './types';

const SYSTEM = `You are VEGA, risk assessment agent for Trading Orchestrator.
You are skeptical, contrarian, and protect the portfolio above all else.
You challenge overconfidence. You find what others miss.
Focus on: news-driven risk, sentiment overextension, price proximity to 52W extremes, volume anomalies.

For the 'assess' phase — end your message with exactly:
---
RISK: [LOW|MEDIUM|HIGH|EXTREME]
CAN_ADD: [YES|NO]
---

For the 'challenge' phase — directly challenge EDGE's BUY with a specific concern. No structured block needed.

Keep it sharp: 2-4 sentences max. You don't waste words.`;

async function streamVega(
  phase: 'assess' | 'challenge',
  ticker: string,
  history: ConversationMessage[],
  send: SendFn,
  trace?: TraceContext
): Promise<string> {
  const to = phase === 'challenge' ? 'EDGE' : 'all';
  const span = startSpan(`vega.${phase}`, {
    'gen_ai.system': 'anthropic',
    'gen_ai.operation.name': 'chat',
    'gen_ai.request.model': MODEL,
    'gen_ai.request.max_tokens': 300,
    'gen_ai.agent.name': 'vega',
    'gen_ai.agent.role': 'risk_assessor',
  }, trace);

  const anthropic = getAnthropicClient();
  let fullText = '';
  let inputTokens = 0;
  let outputTokens = 0;

  const userContent =
    phase === 'assess'
      ? `Conversation:\n\n${formatHistory(history)}\n\nAssess risk for ${ticker}. Be skeptical. What are the real dangers here?`
      : `Conversation:\n\n${formatHistory(history)}\n\nChallenge EDGE's BUY call. What specific risk are they underweighting?`;

  send({ type: 'agent_chunk', ticker, from: 'VEGA' as AgentName, to, text: '' });

  const stream = anthropic.messages.stream({
    model: MODEL,
    max_tokens: 300,
    system: SYSTEM,
    messages: [{ role: 'user', content: userContent }],
  });

  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      fullText += event.delta.text;
      send({ type: 'agent_chunk', ticker, from: 'VEGA' as AgentName, to, text: event.delta.text });
    }
    if (event.type === 'message_start') inputTokens = event.message.usage.input_tokens;
    if (event.type === 'message_delta') outputTokens = event.usage.output_tokens;
  }

  span.end({ 'gen_ai.usage.input_tokens': inputTokens, 'gen_ai.usage.output_tokens': outputTokens });
  send({ type: 'agent_message_done', ticker, from: 'VEGA' as AgentName, to, content: fullText });
  return fullText;
}

export const vegaAssess = (ticker: string, history: ConversationMessage[], send: SendFn, trace?: TraceContext) =>
  streamVega('assess', ticker, history, send, trace);

export const vegaChallenge = (ticker: string, history: ConversationMessage[], send: SendFn, trace?: TraceContext) =>
  streamVega('challenge', ticker, history, send, trace);
