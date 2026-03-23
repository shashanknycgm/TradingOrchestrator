import { oracleOpen, oracleClose, oracleArbitrate } from './oracle';
import { axiomReport } from './axiom';
import { vegaAssess, vegaChallenge } from './vega';
import { edgeDecide, edgeRespond } from './edge';
import { startSpan, sendEvent } from '../telemetry';
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

export async function runTickerConversation(
  ticker: string,
  send: SendFn,
  sessionId?: string
): Promise<TradingSignal> {
  const history: ConversationMessage[] = [];
  let lastMarketPrice: MarketPrice | undefined;

  send({ type: 'ticker_start', ticker });

  // Root span — one trace per ticker analysis
  const traceId = crypto.randomUUID().replace(/-/g, '');

  // Adds message to local history AND sends full content to Honeycomb
  const add = (from: AgentName, to: string, content: string) => {
    history.push({ from, to, content });
    sendEvent('agent.message', {
      'event.type': 'agent_message',
      'message.from': from,
      'message.to': to,
      // Truncate at 4000 chars to stay well within Honeycomb's 10 KB limit
      'message.content': content.length > 4000 ? content.slice(0, 4000) + '…' : content,
      'message.length': content.length,
      ticker,
      'trace.trace_id': traceId,
      ...(sessionId ? { 'session.id': sessionId } : {}),
    });
  };
  const rootSpan = startSpan('ticker.analysis', {
    'gen_ai.system': 'anthropic',
    'gen_ai.operation.name': 'analysis',
    'gen_ai.request.model': MODEL,
    'gen_ai.agent.name': 'oracle',
    'gen_ai.agent.role': 'orchestrator',
    ticker,
  } as Parameters<typeof startSpan>[1], { traceId, sessionId });

  // All agent spans are children of the root span
  const childTrace: TraceContext = { traceId, parentSpanId: rootSpan.spanId, sessionId };

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

  // 4. EDGE makes initial call
  const edgeMsg = await edgeDecide(ticker, history, send, childTrace);
  add('EDGE', 'all', edgeMsg);

  // 5. Deliberation loop — always runs, min 1 round, max 3
  const MAX_ROUNDS = 3;
  let converged = false;
  let lastEdgeMsg = edgeMsg;

  for (let round = 1; round <= MAX_ROUNDS; round++) {
    send({ type: 'debate_round_start', ticker, round });

    // VEGA challenges EDGE
    const vegaChallengeMsg = await vegaChallenge(ticker, history, send, childTrace, round);
    add('VEGA', 'EDGE', vegaChallengeMsg);

    // Check if VEGA conceded
    if (vegaChallengeMsg.trimStart().toUpperCase().startsWith('CONCEDE')) {
      converged = true;
      break;
    }

    // EDGE responds to VEGA's specific concern
    const edgeResponseMsg = await edgeRespond(ticker, history, send, childTrace);
    add('EDGE', 'VEGA', edgeResponseMsg);
    lastEdgeMsg = edgeResponseMsg;

    // Check if EDGE capitulated (changed signal to WAIT or HOLD)
    const newSignal = parseField(edgeResponseMsg, 'SIGNAL')?.toUpperCase();
    if (newSignal === 'WAIT' || newSignal === 'HOLD') {
      converged = true;
      break;
    }
  }

  // 6. If no convergence after max rounds, ORACLE arbitrates
  let finalSignalSource = lastEdgeMsg;

  if (!converged) {
    send({ type: 'oracle_arbitration', ticker });
    const arbitrationMsg = await oracleArbitrate(ticker, history, send, childTrace);
    add('ORACLE', 'all', arbitrationMsg);

    // ORACLE's FINAL: field overrides EDGE's signal
    const finalOverride = parseField(arbitrationMsg, 'FINAL')?.toUpperCase();
    if (finalOverride === 'BUY' || finalOverride === 'HOLD' || finalOverride === 'WAIT') {
      // Rewrite source text so parseSignal picks up ORACLE's FINAL as the SIGNAL
      finalSignalSource = arbitrationMsg.replace(/FINAL:/i, 'SIGNAL:');
    }
  }

  // 7. Parse final signal
  const signal = parseSignal(ticker, finalSignalSource);

  // 8. ORACLE closes
  const oracleCloseMsg = await oracleClose(ticker, history, signal, send, childTrace);
  add('ORACLE', 'all', oracleCloseMsg);

  // Close root span
  rootSpan.end({ ticker } as Parameters<typeof rootSpan.end>[0]);

  send({ type: 'ticker_complete', ticker, signal });
  void lastMarketPrice;
  return signal;
}
