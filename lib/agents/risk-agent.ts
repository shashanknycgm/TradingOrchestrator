import { getAnthropicClient, MODEL } from '../anthropic';
import { startSpan } from '../telemetry';
import type { MarketData, RiskAssessment, SendFn } from './types';

const MAX_POSITIONS = 7;

export async function runRiskAgent(
  ticker: string,
  market: MarketData,
  currentPositions: number,
  send: SendFn
): Promise<RiskAssessment> {
  send({ type: 'phase_start', agent: 'RISK', ticker });

  const span = startSpan('risk_agent.assess', {
    'gen_ai.system': 'anthropic',
    'gen_ai.operation.name': 'chat',
    'gen_ai.request.model': MODEL,
    'gen_ai.request.max_tokens': 700,
    'gen_ai.agent.name': 'risk_agent',
  });

  const anthropic = getAnthropicClient();

  const priceVs52High = market.fiftyTwoWeekHigh
    ? ((market.price / market.fiftyTwoWeekHigh) * 100).toFixed(1)
    : 'unknown';
  const priceVs52Low = market.fiftyTwoWeekLow
    ? ((market.price / market.fiftyTwoWeekLow) * 100).toFixed(1)
    : 'unknown';
  const volumeRatio =
    market.avgVolume && market.volume
      ? (market.volume / market.avgVolume).toFixed(2)
      : 'unknown';

  const stream = anthropic.messages.stream({
    model: MODEL,
    max_tokens: 700,
    system: `You are a trading risk assessment agent for a swing/day trader.
Portfolio rules:
- Maximum ${MAX_POSITIONS} open positions at any time
- Focus: swing trades (3–10 days) and intraday day trades
- Never recommend adding a position if max is reached

Evaluate:
1. Portfolio capacity risk (positions used vs max)
2. News-driven risk from the market analysis (earnings, FDA, macro, etc.)
3. Price risk (proximity to 52-week high/low, volatility)
4. Volume anomalies (unusual volume spikes)
5. Overall risk rating: LOW / MEDIUM / HIGH / EXTREME

Respond in this exact format:
RISK: <LOW|MEDIUM|HIGH|EXTREME>
CAN_ADD: <YES|NO>
REASONING: <2-3 sentences covering the key risk factors>`,
    messages: [
      {
        role: 'user',
        content: `Ticker: ${ticker}
Price: $${market.price.toFixed(2)} (${market.changePercent >= 0 ? '+' : ''}${market.changePercent.toFixed(2)}% today)
52W High: $${market.fiftyTwoWeekHigh?.toFixed(2) ?? 'N/A'} (price is at ${priceVs52High}% of high)
52W Low: $${market.fiftyTwoWeekLow?.toFixed(2) ?? 'N/A'} (price is at ${priceVs52Low}% of low)
Volume vs Avg: ${volumeRatio}x
Current positions: ${currentPositions}/${MAX_POSITIONS}

Market analysis & news:
${market.analysis}

Assess risk and determine if a new position can be added.`,
      },
    ],
  });

  let fullText = '';
  let inputTokens = 0;
  let outputTokens = 0;

  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      fullText += event.delta.text;
      send({ type: 'agent_log', agent: 'RISK', ticker, text: event.delta.text });
    }
    if (event.type === 'message_start' && event.message.usage) {
      inputTokens = event.message.usage.input_tokens;
    }
    if (event.type === 'message_delta' && event.usage) {
      outputTokens = event.usage.output_tokens;
    }
  }

  span.end({
    'gen_ai.usage.input_tokens': inputTokens,
    'gen_ai.usage.output_tokens': outputTokens,
  });

  // Parse structured fields
  const riskMatch = fullText.match(/RISK:\s*(LOW|MEDIUM|HIGH|EXTREME)/i);
  const canAddMatch = fullText.match(/CAN_ADD:\s*(YES|NO)/i);
  const reasoningMatch = fullText.match(/REASONING:\s*([\s\S]+?)(?:\n[A-Z_]+:|$)/i);

  const riskLevel = (riskMatch?.[1]?.toUpperCase() ?? 'MEDIUM') as RiskAssessment['riskLevel'];
  const canAdd = currentPositions < MAX_POSITIONS && (canAddMatch?.[1]?.toUpperCase() !== 'NO');

  const assessment: RiskAssessment = {
    ticker,
    riskLevel,
    canAddPosition: canAdd,
    positionsUsed: currentPositions,
    maxPositions: MAX_POSITIONS,
    reasoning: reasoningMatch?.[1]?.trim() ?? fullText,
  };

  send({ type: 'risk_result', data: assessment });

  return assessment;
}
