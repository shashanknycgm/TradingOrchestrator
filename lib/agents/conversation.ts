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

  // One trace per ticker; conversationId groups ALL traces across the session
  const traceId = crypto.randomUUID().replace(/-/g, '');
  const conversationId = sessionId; // gen_ai.conversation.id = session ID

  // Root span: create_agent oracle (Agentic Timeline spec)
  const rootSpan = startSpan(`create_agent oracle`, {
    'gen_ai.system': 'anthropic',
    'gen_ai.operation.name': 'create_agent',
    'gen_ai.request.model': MODEL,
    'gen_ai.agent.name': 'oracle',
    'gen_ai.agent.role': 'orchestrator',
    ticker,
  } as Parameters<typeof startSpan>[1], { traceId, conversationId });

  // childTrace: all direct children of root span
  const childTrace: TraceContext = { traceId, parentSpanId: rootSpan.spanId, conversationId };

  // Helper: emit invoke_agent span (oracle → target), run fn under it
  const invokeAgent = async <T>(
    agentName: string,
    fn: (agentTrace: TraceContext) => Promise<T>
  ): Promise<T> => {
    const invokeSpan = startSpan(`invoke_agent ${agentName}`, {
      'gen_ai.system': 'anthropic',
      'gen_ai.operation.name': 'invoke_agent',
      'gen_ai.request.model': MODEL,
      'gen_ai.agent.name': 'oracle',
      'gen_ai.agent.role': 'orchestrator',
      ticker,
    } as Parameters<typeof startSpan>[1], childTrace);

    const agentTrace: TraceContext = {
      traceId,
      parentSpanId: invokeSpan.spanId,
      conversationId,
    };

    const result = await fn(agentTrace);
    invokeSpan.end();
    return result;
  };

  // Adds message to local history AND sends full content to Honeycomb as a
  // properly parented trace event (trace.span_id + trace.parent_id included).
  const add = (from: AgentName, to: string, content: string) => {
    history.push({ from, to, content });
    sendEvent('agent.message', {
      'event.type': 'agent_message',
      'message.from': from,
      'message.to': to,
      'message.content': content.length > 4000 ? content.slice(0, 4000) + '…' : content,
      'message.length': content.length,
      ticker,
    }, childTrace);
  };

  // 1. ORACLE opens (oracle's own chat — direct child of root, no invoke_agent wrapper)
  const oracleOpenMsg = await oracleOpen(ticker, send, childTrace);
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

  // 5. Deliberation loop — always runs, min 1 round, max 3
  const MAX_ROUNDS = 3;
  let converged = false;
  let lastEdgeMsg = edgeMsg;

  for (let round = 1; round <= MAX_ROUNDS; round++) {
    send({ type: 'debate_round_start', ticker, round });

    // ORACLE invokes VEGA to challenge
    const vegaChallengeMsg = await invokeAgent('vega', (t) =>
      vegaChallenge(ticker, history, send, t, round)
    );
    add('VEGA', 'EDGE', vegaChallengeMsg);

    if (vegaChallengeMsg.trimStart().toUpperCase().startsWith('CONCEDE')) {
      converged = true;
      break;
    }

    // ORACLE invokes EDGE to respond
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
    const arbitrationMsg = await oracleArbitrate(ticker, history, send, childTrace);
    add('ORACLE', 'all', arbitrationMsg);

    const finalOverride = parseField(arbitrationMsg, 'FINAL')?.toUpperCase();
    if (finalOverride === 'BUY' || finalOverride === 'HOLD' || finalOverride === 'WAIT') {
      finalSignalSource = arbitrationMsg.replace(/FINAL:/i, 'SIGNAL:');
    }
  }

  // 7. Parse final signal
  const signal = parseSignal(ticker, finalSignalSource);

  // 8. ORACLE closes (direct child of root)
  const oracleCloseMsg = await oracleClose(ticker, history, signal, send, childTrace);
  add('ORACLE', 'all', oracleCloseMsg);

  rootSpan.end({ ticker } as Parameters<typeof rootSpan.end>[0]);

  send({ type: 'ticker_complete', ticker, signal });
  void lastMarketPrice;
  return signal;
}

/**
 * Wraps runTickerConversation and closes the root span with error.type=cancelled
 * if the conversation is interrupted mid-stream. Called by route.ts.
 */
export async function runTickerConversationSafe(
  ticker: string,
  send: SendFn,
  sessionId?: string,
  onCancel?: () => void
): Promise<void> {
  try {
    await runTickerConversation(ticker, send, sessionId);
  } catch {
    // Span already closed with error.type=cancelled inside the agent that threw.
    // Notify the caller so it can fire a session-level cancellation event.
    onCancel?.();
  }
}
