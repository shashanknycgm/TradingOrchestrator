export type AgentName = 'ORACLE' | 'AXIOM' | 'VEGA' | 'EDGE';

export interface ConversationMessage {
  from: AgentName;
  to: string; // 'all' | agent name
  content: string;
}

export interface MarketPrice {
  ticker: string;
  price: number;
  change: number;
  changePercent: number;
  volume: number;
  week52High?: number;
  week52Low?: number;
}

export interface TradingSignal {
  ticker: string;
  signal: 'BUY' | 'HOLD' | 'WAIT';
  confidence: 'LOW' | 'MEDIUM' | 'HIGH';
  timeframe: 'DAY' | 'SWING';
  entry?: string;
  stopLoss?: string;
  target?: string;
  reasoning: string;
}

export type TraceEvent =
  | { type: 'ticker_start'; ticker: string }
  | { type: 'agent_chunk'; ticker: string; from: AgentName; to: string; text: string }
  | { type: 'agent_message_done'; ticker: string; from: AgentName; to: string; content: string }
  | { type: 'price_update'; ticker: string; price: MarketPrice }
  | { type: 'ticker_complete'; ticker: string; signal: TradingSignal }
  | { type: 'complete' }
  | { type: 'error'; message: string };

export type SendFn = (event: TraceEvent) => void;
