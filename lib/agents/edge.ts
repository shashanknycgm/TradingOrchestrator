import { getAnthropicClient, MODEL } from '../anthropic';
import { startSpan } from '../telemetry';
import type { TraceContext } from '../telemetry';
import { formatHistory } from './utils';
import type { ConversationMessage, AgentName, SendFn } from './types';

const SYSTEM = `You are EDGE, signal generation agent for Trading Orchestrator.
You are decisive, confident, and cut through noise. You commit to a call and defend it.
You synthesize everything the team has said and make the final trading decision.

For the 'decide' phase — end your message with exactly:
---
SIGNAL: [BUY|HOLD|WAIT]
CONFIDENCE: [LOW|MEDIUM|HIGH]
TIMEFRAME: [DAY|SWING]
ENTRY: [price range, e.g. $122–125, or N/A]
STOP: [price, e.g. $118, or N/A]
TARGET: [price, e.g. $140, or N/A]
---

For the 'respond' phase — respond to VEGA's challenge. Either defend your call or adjust it.
If you change your signal, include the structured block again with the updated values.

Rules you never break:
- EXTREME risk → always WAIT
- HIGH risk → require HIGH confidence to call BUY
Keep it direct: 2-3 sentences + structured block.`;

async function streamEdge(
  phase: 'decide' | 'respond',
  ticker: string,
  history: ConversationMessage[],
  send: SendFn,
  trace?: TraceContext
): Promise<string> {
  const to = phase === 'respond' ? 'VEGA' : 'all';
  const span = startSpan(`edge.${phase}`, {
    'gen_ai.system': 'anthropic',
    'gen_ai.operation.name': 'chat',
    'gen_ai.request.model': MODEL,
    'gen_ai.request.max_tokens': 350,
    'gen_ai.agent.name': 'edge',
    'gen_ai.agent.role': 'signal_generator',
  }, trace);

  const anthropic = getAnthropicClient();
  let fullText = '';
  let inputTokens = 0;
  let outputTokens = 0;

  const userContent =
    phase === 'decide'
      ? `Conversation:\n\n${formatHistory(history)}\n\nGenerate the trading signal for ${ticker}. Commit.`
      : `Conversation:\n\n${formatHistory(history)}\n\nRespond to VEGA's challenge. Defend or adjust your call.`;

  send({ type: 'agent_chunk', ticker, from: 'EDGE' as AgentName, to, text: '' });

  const stream = anthropic.messages.stream({
    model: MODEL,
    max_tokens: 350,
    system: SYSTEM,
    messages: [{ role: 'user', content: userContent }],
  });

  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      fullText += event.delta.text;
      send({ type: 'agent_chunk', ticker, from: 'EDGE' as AgentName, to, text: event.delta.text });
    }
    if (event.type === 'message_start') inputTokens = event.message.usage.input_tokens;
    if (event.type === 'message_delta') outputTokens = event.usage.output_tokens;
  }

  span.end({ 'gen_ai.usage.input_tokens': inputTokens, 'gen_ai.usage.output_tokens': outputTokens });
  send({ type: 'agent_message_done', ticker, from: 'EDGE' as AgentName, to, content: fullText });
  return fullText;
}

export const edgeDecide = (ticker: string, history: ConversationMessage[], send: SendFn, trace?: TraceContext) =>
  streamEdge('decide', ticker, history, send, trace);

export const edgeRespond = (ticker: string, history: ConversationMessage[], send: SendFn, trace?: TraceContext) =>
  streamEdge('respond', ticker, history, send, trace);
