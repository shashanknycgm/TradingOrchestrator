import { getAnthropicClient, MODEL } from '../anthropic';
import { startSpan } from '../telemetry';
import type { MarketData, RiskAssessment, TradingSignal, SendFn } from './types';

export async function runSignalAgent(
  ticker: string,
  market: MarketData,
  risk: RiskAssessment,
  send: SendFn
): Promise<TradingSignal> {
  send({ type: 'phase_start', agent: 'SIGNAL', ticker });

  const span = startSpan('signal_agent.generate', {
    'gen_ai.system': 'anthropic',
    'gen_ai.operation.name': 'chat',
    'gen_ai.request.model': MODEL,
    'gen_ai.request.max_tokens': 600,
    'gen_ai.agent.name': 'signal_agent',
  });

  const anthropic = getAnthropicClient();

  const stream = anthropic.messages.stream({
    model: MODEL,
    max_tokens: 600,
    system: `You are a trading signal agent producing actionable recommendations for swing and day traders.
Based on market intelligence and risk assessment, generate a clear trading signal.

Rules:
- If risk is EXTREME or CAN_ADD is NO → signal must be WAIT
- If risk is HIGH → prefer WAIT unless very strong catalyst
- BUY = enter or add position now
- HOLD = already in position, maintain it
- WAIT = do not enter, conditions unfavorable

Always suggest a realistic entry price range, stop-loss, and target based on recent price action.

Respond in EXACTLY this format (no extra text):
SIGNAL: <BUY|HOLD|WAIT>
CONFIDENCE: <LOW|MEDIUM|HIGH>
TIMEFRAME: <DAY|SWING>
ENTRY: <price range or "N/A">
STOP: <price or "N/A">
TARGET: <price or "N/A">
REASONING: <2-3 sentences with specific rationale>`,
    messages: [
      {
        role: 'user',
        content: `Ticker: ${ticker}
Current price: $${market.price.toFixed(2)} (${market.changePercent >= 0 ? '+' : ''}${market.changePercent.toFixed(2)}%)
52W range: $${market.fiftyTwoWeekLow?.toFixed(2) ?? '?'} – $${market.fiftyTwoWeekHigh?.toFixed(2) ?? '?'}

Market news & sentiment:
${market.analysis}

Risk assessment:
- Risk level: ${risk.riskLevel}
- Can add position: ${risk.canAddPosition ? 'YES' : 'NO'} (${risk.positionsUsed}/${risk.maxPositions} positions used)
- Risk reasoning: ${risk.reasoning}

Generate the trading signal.`,
      },
    ],
  });

  let fullText = '';
  let inputTokens = 0;
  let outputTokens = 0;

  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      fullText += event.delta.text;
      send({ type: 'agent_log', agent: 'SIGNAL', ticker, text: event.delta.text });
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
  const get = (key: string) => fullText.match(new RegExp(`${key}:\\s*([^\\n]+)`, 'i'))?.[1]?.trim();

  const rawSignal = get('SIGNAL')?.toUpperCase();
  const signal: TradingSignal['signal'] =
    rawSignal === 'BUY' || rawSignal === 'HOLD' || rawSignal === 'WAIT' ? rawSignal : 'WAIT';

  const rawConf = get('CONFIDENCE')?.toUpperCase();
  const confidence: TradingSignal['confidence'] =
    rawConf === 'LOW' || rawConf === 'MEDIUM' || rawConf === 'HIGH' ? rawConf : 'LOW';

  const rawTf = get('TIMEFRAME')?.toUpperCase();
  const timeframe: TradingSignal['timeframe'] = rawTf === 'DAY' ? 'DAY' : 'SWING';

  const result: TradingSignal = {
    ticker,
    signal,
    confidence,
    timeframe,
    entry: get('ENTRY'),
    stopLoss: get('STOP'),
    target: get('TARGET'),
    reasoning: get('REASONING') ?? fullText,
  };

  send({ type: 'signal_result', data: result });

  return result;
}
