import { getAnthropicClient, MODEL } from '../anthropic';
import { startSpan } from '../telemetry';
import type { TraceContext } from '../telemetry';
import { formatHistory } from './utils';
import type { ConversationMessage, AgentName, TradingSignal, SendFn } from './types';

const SYSTEM = `You are ORACLE, the orchestration intelligence of Trading Orchestrator.
You are calm, authoritative, and precise. You speak in short directives — never more than 3 sentences.
You coordinate a specialist team: AXIOM (market data), VEGA (risk), and EDGE (signals).
No filler. No pleasantries. You open sessions and close them with final verdicts.`;

async function streamOracle(
  ticker: string,
  to: string,
  userContent: string,
  send: SendFn,
  trace?: TraceContext
): Promise<string> {
  const span = startSpan(`chat ${MODEL}`, {
    'gen_ai.system': 'anthropic',
    'gen_ai.operation.name': 'chat',
    'gen_ai.request.model': MODEL,
    'gen_ai.response.model': MODEL,
    'gen_ai.request.max_tokens': 150,
    'gen_ai.agent.name': 'oracle',
    'gen_ai.agent.role': 'orchestrator',
  }, trace);

  const anthropic = getAnthropicClient();
  let fullText = '';
  let inputTokens = 0;
  let outputTokens = 0;

  send({ type: 'agent_chunk', ticker, from: 'ORACLE' as AgentName, to, text: '' });

  const stream = anthropic.messages.stream({
    model: MODEL,
    max_tokens: 150,
    system: SYSTEM,
    messages: [{ role: 'user', content: userContent }],
  });

  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      fullText += event.delta.text;
      send({ type: 'agent_chunk', ticker, from: 'ORACLE' as AgentName, to, text: event.delta.text });
    }
    if (event.type === 'message_start') inputTokens = event.message.usage.input_tokens;
    if (event.type === 'message_delta') outputTokens = event.usage.output_tokens;
  }

  span.end({ 'gen_ai.usage.input_tokens': inputTokens, 'gen_ai.usage.output_tokens': outputTokens });
  send({ type: 'agent_message_done', ticker, from: 'ORACLE' as AgentName, to, content: fullText });
  return fullText;
}

export async function oracleOpen(ticker: string, send: SendFn, trace?: TraceContext): Promise<string> {
  return streamOracle(
    ticker, 'all',
    `Open the analysis session for ${ticker}. Direct AXIOM to search for current price, volume, sentiment, and breaking news. Be brief and commanding.`,
    send, trace
  );
}

export async function oracleClose(
  ticker: string,
  history: ConversationMessage[],
  signal: TradingSignal,
  send: SendFn,
  trace?: TraceContext
): Promise<string> {
  return streamOracle(
    ticker, 'all',
    `Close the analysis session for ${ticker}. Full conversation:\n\n${formatHistory(history)}\n\nEDGE's final call is ${signal.signal} (${signal.confidence} confidence, ${signal.timeframe}). Confirm and wrap up in 1-2 sentences.`,
    send, trace
  );
}

export async function oracleArbitrate(
  ticker: string,
  history: ConversationMessage[],
  send: SendFn,
  trace?: TraceContext
): Promise<string> {
  return streamOracle(
    ticker, 'all',
    `VEGA and EDGE have reached maximum debate rounds on ${ticker} without converging. Full conversation:\n\n${formatHistory(history)}\n\nArbitrate. Weigh the unresolved disagreement and make the final binding call. State your reasoning in 1 sentence, then end with exactly:\n---\nFINAL: [BUY|HOLD|WAIT]\n---`,
    send, trace
  );
}
