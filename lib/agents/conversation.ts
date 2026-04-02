import { oracleOpen, oracleClose, oracleArbitrate } from './oracle';
import { axiomReport } from './axiom';
import { vegaAssess, vegaChallenge } from './vega';
import { edgeDecide, edgeRespond } from './edge';
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
): Promise<TradingSignal> {
  const history: ConversationMessage[] = [];
  let lastMarketPrice: MarketPrice | undefined;

  send({ type: 'ticker_start', ticker });

  const add = (from: AgentName, to: string, content: string) => {
    history.push({ from, to, content });
  };

  // 1. ORACLE opens
  const oracleOpenMsg = await oracleOpen(ticker, send);
  add('ORACLE', 'all', oracleOpenMsg);

  // 2. AXIOM reports (web search)
  const { message: axiomMsg, price } = await axiomReport(ticker, history, send);
  add('AXIOM', 'all', axiomMsg);
  if (price) {
    lastMarketPrice = price;
    send({ type: 'price_update', ticker, price });
  }

  // 3. VEGA assesses risk
  const vegaMsg = await vegaAssess(ticker, history, send);
  add('VEGA', 'all', vegaMsg);

  // 4. EDGE makes initial signal call
  const edgeMsg = await edgeDecide(ticker, history, send);
  add('EDGE', 'all', edgeMsg);

  // 5. Deliberation loop — min 1 round, max 3
  const MAX_ROUNDS = 3;
  let converged = false;
  let lastEdgeMsg = edgeMsg;

  for (let round = 1; round <= MAX_ROUNDS; round++) {
    send({ type: 'debate_round_start', ticker, round });

    const vegaChallengeMsg = await vegaChallenge(ticker, history, send, round);
    add('VEGA', 'EDGE', vegaChallengeMsg);

    if (vegaChallengeMsg.trimStart().toUpperCase().startsWith('CONCEDE')) {
      converged = true;
      break;
    }

    const edgeResponseMsg = await edgeRespond(ticker, history, send);
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
    const arbitrationMsg = await oracleArbitrate(ticker, history, send);
    add('ORACLE', 'all', arbitrationMsg);

    const finalOverride = parseField(arbitrationMsg, 'FINAL')?.toUpperCase();
    if (finalOverride === 'BUY' || finalOverride === 'HOLD' || finalOverride === 'WAIT') {
      finalSignalSource = arbitrationMsg.replace(/FINAL:/i, 'SIGNAL:');
    }
  }

  // 7. Parse final signal
  const signal = parseSignal(ticker, finalSignalSource);

  // 8. ORACLE closes
  const oracleCloseMsg = await oracleClose(ticker, history, signal, send);
  add('ORACLE', 'all', oracleCloseMsg);

  send({ type: 'ticker_complete', ticker, signal });
  void lastMarketPrice;
  return signal;
}
