import { getAnthropicClient, MODEL } from '../anthropic';
import { startSpan } from '../telemetry';
import type { MarketData, SendFn } from './types';

export async function runMarketAgent(ticker: string, send: SendFn): Promise<MarketData> {
  send({ type: 'phase_start', agent: 'MARKET', ticker });

  const span = startSpan('market_agent.analyze', {
    'gen_ai.system': 'anthropic',
    'gen_ai.operation.name': 'chat',
    'gen_ai.request.model': MODEL,
    'gen_ai.request.max_tokens': 1500,
    'gen_ai.agent.name': 'market_agent',
  });

  const anthropic = getAnthropicClient();
  send({ type: 'agent_log', agent: 'MARKET', ticker, text: 'Searching for price data, news & sentiment...\n' });

  let inputTokens = 0;
  let outputTokens = 0;
  let rawText = '';

  try {
    // Single web_search call gets live price + news — no Yahoo Finance rate limits
    const response = await anthropic.messages.create(
      {
        model: MODEL,
        max_tokens: 1500,
        system: `You are a market intelligence agent for swing and day traders.
Use web search to find the current real-time data for the given stock ticker and respond in EXACTLY this format — no extra text:

PRICE: <current price as number, e.g. 124.56>
CHANGE: <dollar change, e.g. +2.34 or -1.20>
CHANGE_PCT: <percent change, e.g. +1.92 or -0.87>
VOLUME: <today's volume as integer, e.g. 45200000>
WEEK52_HIGH: <52-week high as number>
WEEK52_LOW: <52-week low as number>
SENTIMENT: <BULLISH|BEARISH|NEUTRAL>
NEWS:
• <news item 1 — be specific, include source if known>
• <news item 2>
• <news item 3>
• <news item 4 — only if relevant>

Search for the most recent price quote and news from the last 24–48 hours.
Focus on: earnings, analyst calls, upgrades/downgrades, M&A, macro catalysts, unusual options activity.`,
        messages: [
          {
            role: 'user',
            content: `Search for the current price, quote data, and latest news for ${ticker} stock. Today's date: ${new Date().toDateString()}.`,
          },
        ],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        tools: [{ type: 'web_search_20250305', name: 'web_search' }] as any[],
      },
      { headers: { 'anthropic-beta': 'web-search-2025-03-05' } }
    );

    for (const block of response.content) {
      if (block.type === 'text') rawText += block.text;
    }

    inputTokens = response.usage.input_tokens;
    outputTokens = response.usage.output_tokens;
  } catch (err) {
    send({ type: 'agent_log', agent: 'MARKET', ticker, text: `⚠ Web search failed: ${String(err)}\n` });
    span.end();
    return { ticker, price: 0, change: 0, changePercent: 0, volume: 0, analysis: 'Data unavailable.' };
  }

  span.end({ 'gen_ai.usage.input_tokens': inputTokens, 'gen_ai.usage.output_tokens': outputTokens });

  // ── Parse structured fields ─────────────────────────────────────────────────
  const parseNum = (key: string) => {
    const m = rawText.match(new RegExp(`${key}:\\s*([+-]?[\\d,\\.]+)`, 'i'));
    return m ? parseFloat(m[1].replace(/,/g, '')) : 0;
  };

  const price = parseNum('PRICE');
  const change = parseNum('CHANGE');
  const changePercent = parseNum('CHANGE_PCT');
  const volume = parseNum('VOLUME');
  const fiftyTwoWeekHigh = parseNum('WEEK52_HIGH') || undefined;
  const fiftyTwoWeekLow = parseNum('WEEK52_LOW') || undefined;

  // Emit price card to UI
  if (price > 0) {
    send({ type: 'price_data', ticker, price, change, changePercent, volume });
  }

  // Emit the full analysis text (sentiment + news bullets)
  const analysisStart = rawText.indexOf('SENTIMENT:');
  const analysis = analysisStart >= 0 ? rawText.slice(analysisStart) : rawText;
  send({ type: 'agent_log', agent: 'MARKET', ticker, text: '\n' + analysis });

  return { ticker, price, change, changePercent, volume, fiftyTwoWeekHigh, fiftyTwoWeekLow, analysis };
}
