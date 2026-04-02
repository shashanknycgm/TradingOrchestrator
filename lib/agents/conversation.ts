import { oracleOpen, oracleClose, oracleArbitrate } from './oracle';
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
  conversationId: string,
): Promise<TradingSignal> {
  const history: ConversationMessage[] = [];
  let lastMarketPrice: MarketPrice | undefined;

  send({ type: 'ticker_start', ticker });

  const add = (from: AgentName, to: string, content: string) => {
    history.push({ from, to, content });
  };

  // One trace per ticker; all traces share the same conversationId (one per "Run Agents" click)
  const traceId = crypto.randomUUID().replace(/-/g, '');

  // Root span: ORACLE creates the agent session
  const rootSpan = startSpan('create_agent oracle', {
    'gen_ai.system': 'anthropic',
    'gen_ai.operation.name': 'create_agent',
    'gen_ai.agent.name': 'oracle',
    'gen_ai.request.model': MODEL,
    ticker,
  }, { traceId, conversationId });

  // Direct children of root span
  const rootTrace: TraceContext = { traceId, parentSpanId: rootSpan.spanId, conversationId };

  /**
   * Emits an invoke_agent span from ORACLE to the target agent,
   * then runs the agent function as a child of that span.
   * Per spec: the *calling* agent (ORACLE) emits invoke_agent,
   * the called agent emits its own chat spans under its own gen_ai.agent.name.
   */
  const invokeAgent = async <T>(
    agentName: string,
    fn: (agentTrace: TraceContext) => Promise<T>,
  ): Promise<T> => {
    const invokeSpan = startSpan(`invoke_agent ${agentName}`, {
      'gen_ai.system': 'anthropic',
      'gen_ai.operation.name': 'invoke_agent',
      'gen_ai.agent.name': 'oracle',
      'gen_ai.request.model': MODEL,
      ticker,
    }, rootTrace);

    const agentTrace: TraceContext = {
      traceId,
      parentSpanId: invokeSpan.spanId,
      conversationId,
    };

    const result = await fn(agentTrace);
    invokeSpan.end();
    return result;
  };

  // 1. ORACLE opens (ORACLE's own chat — direct child of root, no invoke_agent wrapper)
  const oracleOpenMsg = await oracleOpen(ticker, send, rootTrace);
  add('ORACLE', 'all', oracleOpenMsg);

  // 2. ORACLE invokes AXIOM
  const { message: axiomMsg, price } = await invokeAgent('axiom', (t) =>
    axiomReport(ticker, history, send, t)
  );
  add('AXIOM', 'all', axiomMsg);
  if (price) {
    lastMarketPrice = price;
    send({ type: 'price_update', ticker, price });
  }

  // 3. ORACLE invokes VEGA (risk assessment)
  const vegaMsg = await invokeAgent('vega', (t) =>
    vegaAssess(ticker, history, send, t)
  );
  add('VEGA', 'all', vegaMsg);

  // 4. ORACLE invokes EDGE (initial signal)
  const edgeMsg = await invokeAgent('edge', (t) =>
    edgeDecide(ticker, history, send, t)
  );
  add('EDGE', 'all', edgeMsg);

  // 5. Deliberation loop — min 1 round, max 3
  const MAX_ROUNDS = 3;
  let converged = false;
  let lastEdgeMsg = edgeMsg;

  for (let round = 1; round <= MAX_ROUNDS; round++) {
    send({ type: 'debate_round_start', ticker, round });

    const vegaChallengeMsg = await invokeAgent('vega', (t) =>
      vegaChallenge(ticker, history, send, t, round)
    );
    add('VEGA', 'EDGE', vegaChallengeMsg);

    if (vegaChallengeMsg.trimStart().toUpperCase().startsWith('CONCEDE')) {
      converged = true;
      break;
    }

    const edgeResponseMsg = await invokeAgent('edge', (t) =>
      edgeRespond(ticker, history, send, t)
    );
    add('EDGE', 'VEGA', edgeResponseMsg);
    lastEdgeMsg = edgeResponseMsg;

    const newSignal = parseField(edgeResponseMsg, 'SIGNAL')?.toUpperCase();
    if (newSignal === 'WAIT' || newSignal === 'HOLD') {
      converged = true;
      break;
    }
  }

  // 6. If no convergence, ORACLE arbitrates
  let finalSignalSource = lastEdgeMsg;

  if (!converged) {
    send({ type: 'oracle_arbitration', ticker });
    const arbitrationMsg = await oracleArbitrate(ticker, history, send, rootTrace);
    add('ORACLE', 'all', arbitrationMsg);

    const finalOverride = parseField(arbitrationMsg, 'FINAL')?.toUpperCase();
    if (finalOverride === 'BUY' || finalOverride === 'HOLD' || finalOverride === 'WAIT') {
      finalSignalSource = arbitrationMsg.replace(/FINAL:/i, 'SIGNAL:');
    }
  }

  // 7. Parse final signal
  const signal = parseSignal(ticker, finalSignalSource);

  // 8. ORACLE closes
  const oracleCloseMsg = await oracleClose(ticker, history, signal, send, rootTrace);
  add('ORACLE', 'all', oracleCloseMsg);

  rootSpan.end({ ticker, 'gen_ai.response.finish_reasons': 'stop' });

  send({ type: 'ticker_complete', ticker, signal });
  void lastMarketPrice;
  return signal;
}
