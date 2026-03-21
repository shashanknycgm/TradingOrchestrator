import { getAnthropicClient, MODEL } from '../anthropic';
import { startSpan } from '../telemetry';
import type { MarketData, SendFn } from './types';

export async function runMarketAgent(ticker: string, send: SendFn): Promise<MarketData> {
  send({ type: 'phase_start', agent: 'MARKET', ticker });

  // ── 1. Fetch price data from Yahoo Finance ─────────────────────────────────
  let priceData: Partial<MarketData> = { ticker, price: 0, change: 0, changePercent: 0, volume: 0 };

  try {
    // yahoo-finance2 default export is the class constructor; instantiate it
    const yf = await import('yahoo-finance2');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const yfi = new (yf.default as any)();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const quote: any = await yfi.quote(ticker);
    priceData = {
      ticker,
      price: quote.regularMarketPrice ?? 0,
      change: quote.regularMarketChange ?? 0,
      changePercent: quote.regularMarketChangePercent ?? 0,
      volume: quote.regularMarketVolume ?? 0,
      marketCap: quote.marketCap,
      fiftyTwoWeekHigh: quote.fiftyTwoWeekHigh,
      fiftyTwoWeekLow: quote.fiftyTwoWeekLow,
      avgVolume: quote.averageDailyVolume3Month,
      peRatio: quote.trailingPE,
    };

    send({
      type: 'price_data',
      ticker,
      price: priceData.price!,
      change: priceData.change!,
      changePercent: priceData.changePercent!,
      volume: priceData.volume!,
    });
  } catch (err) {
    send({
      type: 'agent_log',
      agent: 'MARKET',
      ticker,
      text: `⚠ Could not fetch price data: ${String(err)}\n`,
    });
  }

  // ── 2. Claude + web_search for news & sentiment ────────────────────────────
  const span = startSpan('market_agent.analyze', {
    'gen_ai.system': 'anthropic',
    'gen_ai.operation.name': 'chat',
    'gen_ai.request.model': MODEL,
    'gen_ai.request.max_tokens': 1200,
    'gen_ai.agent.name': 'market_agent',
  });

  const anthropic = getAnthropicClient();

  send({ type: 'agent_log', agent: 'MARKET', ticker, text: '\nSearching web for news & sentiment...\n' });

  let analysis = '';
  let inputTokens = 0;
  let outputTokens = 0;

  try {
    // web_search_20250305 is a built-in Anthropic server-side tool (no client execution needed)
    // Cast tools to any[] to satisfy strict SDK types while using beta tool type
    const response = await anthropic.messages.create(
      {
        model: MODEL,
        max_tokens: 1200,
        system: `You are a market intelligence agent focused on swing and day trading.
For the given stock ticker, search for and synthesize:
1. Sentiment (BULLISH / BEARISH / NEUTRAL) — state it on the first line
2. Key news items from the last 24–48 hours (bullet points, max 4)
3. Any breaking events: earnings, FDA decisions, M&A, analyst upgrades/downgrades, macro catalysts
4. Volume anomalies or unusual options activity if found

Be concise. Format:
SENTIMENT: <BULLISH|BEARISH|NEUTRAL>
• <news item 1>
• <news item 2>
...`,
        messages: [
          {
            role: 'user',
            content: `Analyze ${ticker}. Current price: $${priceData.price?.toFixed(2) ?? 'unknown'}, change: ${priceData.changePercent?.toFixed(2) ?? '?'}% today. Search for the latest news and sentiment relevant to swing/day traders.`,
          },
        ],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        tools: [{ type: 'web_search_20250305', name: 'web_search' }] as any[],
      },
      { headers: { 'anthropic-beta': 'web-search-2025-03-05' } }
    );

    for (const block of response.content) {
      if (block.type === 'text') {
        analysis += block.text;
      }
    }

    inputTokens = response.usage.input_tokens;
    outputTokens = response.usage.output_tokens;

    send({ type: 'agent_log', agent: 'MARKET', ticker, text: analysis });
  } catch (err) {
    analysis = `Web search unavailable. Price-only analysis for ${ticker}.`;
    send({ type: 'agent_log', agent: 'MARKET', ticker, text: `⚠ ${analysis}\n` });
  }

  span.end({
    'gen_ai.usage.input_tokens': inputTokens,
    'gen_ai.usage.output_tokens': outputTokens,
  });

  return { ...(priceData as MarketData), analysis };
}
