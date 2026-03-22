import { getAnthropicClient } from '../anthropic';

const HAIKU = 'claude-haiku-4-5-20251001';
import { startSpan } from '../telemetry';
import type { TraceContext } from '../telemetry';
import { formatHistory } from './utils';
import type { ConversationMessage, AgentName, MarketPrice, SendFn } from './types';

const SYSTEM = `You are AXIOM, market intelligence agent for Trading Orchestrator.
You are data-obsessed, precise, and speak in facts. No fluff. No hedging. No filler.
You search the web for live price data and breaking news, then report what you find.

Structure your report EXACTLY like this — no deviations:

---
PRICE: [number only, e.g. 124.56]
CHANGE: [signed number, e.g. +2.34 or -1.20]
CHANGE_PCT: [signed number, e.g. +1.92 or -0.87]
VOLUME: [integer, e.g. 45200000]
WEEK52_HIGH: [number]
WEEK52_LOW: [number]
SENTIMENT: [BULLISH|BEARISH|NEUTRAL]
---

Then 3-4 bullet points — most important news/catalysts from the last 48 hours only.
End with one direct sentence passing findings to VEGA and EDGE.`;

export async function axiomReport(
  ticker: string,
  history: ConversationMessage[],
  send: SendFn,
  trace?: TraceContext
): Promise<{ message: string; price?: MarketPrice }> {
  const span = startSpan('axiom.report', {
    'gen_ai.system': 'anthropic',
    'gen_ai.operation.name': 'chat',
    'gen_ai.request.model': HAIKU,
    'gen_ai.request.max_tokens': 1500,
    'gen_ai.agent.name': 'axiom',
    'gen_ai.agent.role': 'market_intel',
  }, trace);

  const anthropic = getAnthropicClient();
  let rawText = '';
  let inputTokens = 0;
  let outputTokens = 0;

  send({ type: 'agent_chunk', ticker, from: 'AXIOM' as AgentName, to: 'all', text: '' });

  try {
    const response = await anthropic.messages.create(
      {
        model: HAIKU,
        max_tokens: 1500,
        system: SYSTEM,
        messages: [
          {
            role: 'user',
            content: `Context:\n${formatHistory(history)}\n\nSearch for current price, volume, 52-week range, sentiment, and latest news for ${ticker}. Today: ${new Date().toDateString()}.`,
          },
        ],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        tools: [{ type: 'web_search_20250305', name: 'web_search' }] as any[],
      },
      { headers: { 'anthropic-beta': 'web-search-2025-03-05' } }
    );

    for (const block of response.content) {
      if (block.type === 'text') {
        rawText += block.text;
      } else {
        // Handle server_tool_use (beta) blocks — SDK types don't include this variant yet
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const b = block as any;
        if (b.type === 'server_tool_use' && b.name === 'web_search' && trace) {
          const toolSpan = startSpan('tool.web_search', {
            'gen_ai.system': 'anthropic',
            'gen_ai.operation.name': 'tool_call',
            'gen_ai.request.model': HAIKU,
            'gen_ai.agent.name': 'axiom',
            'gen_ai.agent.role': 'market_intel',
            'gen_ai.tool.name': 'web_search',
            'tool.call.id': String(b.id ?? ''),
            'tool.input.query': String(b.input?.query ?? ''),
          }, { traceId: trace.traceId, parentSpanId: span.spanId });
          toolSpan.end();
        }
      }
    }
    inputTokens = response.usage.input_tokens;
    outputTokens = response.usage.output_tokens;
  } catch (err) {
    rawText = `Web search failed: ${String(err)}. Operating without live data.`;
  }

  span.end({ 'gen_ai.usage.input_tokens': inputTokens, 'gen_ai.usage.output_tokens': outputTokens });

  // Emit full message at once (web search is non-streaming)
  send({ type: 'agent_chunk', ticker, from: 'AXIOM' as AgentName, to: 'all', text: rawText });
  send({ type: 'agent_message_done', ticker, from: 'AXIOM' as AgentName, to: 'all', content: rawText });

  // Parse price data
  const parseNum = (key: string) => {
    const m = rawText.match(new RegExp(`${key}:\\s*([+-]?[\\d,\\.]+)`, 'i'));
    return m ? parseFloat(m[1].replace(/,/g, '')) : undefined;
  };

  const price = parseNum('PRICE');
  const marketPrice: MarketPrice | undefined = price
    ? {
        ticker,
        price,
        change: parseNum('CHANGE') ?? 0,
        changePercent: parseNum('CHANGE_PCT') ?? 0,
        volume: parseNum('VOLUME') ?? 0,
        week52High: parseNum('WEEK52_HIGH'),
        week52Low: parseNum('WEEK52_LOW'),
      }
    : undefined;

  return { message: rawText, price: marketPrice };
}
