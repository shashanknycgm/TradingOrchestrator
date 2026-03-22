import { oracleOpen, oracleClose } from './oracle';
import { axiomReport } from './axiom';
import { vegaAssess, vegaChallenge } from './vega';
import { edgeDecide, edgeRespond } from './edge';
import { startSpan } from '../telemetry';
import type { TraceContext } from '../telemetry';
import { MODEL } from '../anthropic';
import type { ConversationMessage, AgentName, TradingSignal, MarketPrice, SendFn } from './types';

function parseField(text: string, key: string): string | undefined {
  return text.match(new RegExp(`${key}:\\s*([^\\n\\-]+)`, 'i'))?.[1]?.trim();
}

function parseSignal(ticker: string, text: string): TradingSignal {
  const raw = parseField(text, 'SIGNAL')?.toUpperCase();
  const signal: TradingSignal['signal'] =
    raw === 'BUY' || raw === 'HOLD' || raw === 'WAIT' ? raw : 'WAIT';

  const rawConf = parseField(text, 'CONFIDENCE')?.toUpperCase();
  const confidence: TradingSignal['confidence'] =
    rawConf === 'HIGH' ? 'HIGH' : rawConf === 'MEDIUM' ? 'MEDIUM' : 'LOW';

  const rawTf = parseField(text, 'TIMEFRAME')?.toUpperCase();
  const timeframe: TradingSignal['timeframe'] = rawTf === 'DAY' ? 'DAY' : 'SWING';

  // Reasoning = text before the structured block
  const blockIdx = text.lastIndexOf('---');
  const reasoning = (blockIdx > 0 ? text.slice(0, blockIdx) : text).trim().slice(0, 400);

  return {
    ticker,
    signal,
    confidence,
    timeframe,
    entry: parseField(text, 'ENTRY'),
    stopLoss: parseField(text, 'STOP'),
    target: parseField(text, 'TARGET'),
    reasoning,
  };
}

function parseRiskLevel(text: string): string {
  return parseField(text, 'RISK')?.toUpperCase() ?? 'MEDIUM';
}

export async function runTickerConversation(
  ticker: string,
  send: SendFn
): Promise<TradingSignal> {
  const history: ConversationMessage[] = [];
  let lastMarketPrice: MarketPrice | undefined;

  const add = (from: AgentName, to: string, content: string) => {
    history.push({ from, to, content });
  };

  send({ type: 'ticker_start', ticker });

  // Root span — one trace per ticker analysis
  const traceId = crypto.randomUUID().replace(/-/g, '');
  const rootSpan = startSpan('ticker.analysis', {
    'gen_ai.system': 'anthropic',
    'gen_ai.operation.name': 'analysis',
    'gen_ai.request.model': MODEL,
    'gen_ai.agent.name': 'conversation',
    ticker,
  } as Parameters<typeof startSpan>[1], { traceId });

  // All agent spans are children of the root span
  const childTrace: TraceContext = { traceId, parentSpanId: rootSpan.spanId };

  // 1. ORACLE opens
  const oracleOpenMsg = await oracleOpen(ticker, send, childTrace);
  add('ORACLE', 'all', oracleOpenMsg);

  // 2. AXIOM reports (web search — non-streaming)
  const { message: axiomMsg, price } = await axiomReport(ticker, history, send, childTrace);
  add('AXIOM', 'all', axiomMsg);
  if (price) {
    lastMarketPrice = price;
    send({ type: 'price_update', ticker, price });
  }

  // 3. VEGA assesses
  const vegaMsg = await vegaAssess(ticker, history, send, childTrace);
  add('VEGA', 'all', vegaMsg);

  // 4. EDGE decides
  const edgeMsg = await edgeDecide(ticker, history, send, childTrace);
  add('EDGE', 'all', edgeMsg);

  // 5. Debate round — triggered if VEGA says HIGH/EXTREME and EDGE says BUY
  const vegaRisk = parseRiskLevel(vegaMsg);
  const edgeSignalType = parseField(edgeMsg, 'SIGNAL')?.toUpperCase();

  if ((vegaRisk === 'HIGH' || vegaRisk === 'EXTREME') && edgeSignalType === 'BUY') {
    const vegaChallengeMsg = await vegaChallenge(ticker, history, send, childTrace);
    add('VEGA', 'EDGE', vegaChallengeMsg);

    const edgeResponseMsg = await edgeRespond(ticker, history, send, childTrace);
    add('EDGE', 'VEGA', edgeResponseMsg);
  }

  // 6. Parse final signal from last EDGE message
  const lastEdge = [...history].reverse().find((m) => m.from === 'EDGE');
  const signal = parseSignal(ticker, lastEdge?.content ?? edgeMsg);

  // 7. ORACLE closes
  const oracleCloseMsg = await oracleClose(ticker, history, signal, send, childTrace);
  add('ORACLE', 'all', oracleCloseMsg);

  // Close root span
  rootSpan.end({ ticker } as Parameters<typeof rootSpan.end>[0]);

  send({ type: 'ticker_complete', ticker, signal });
  void lastMarketPrice;
  return signal;
}
