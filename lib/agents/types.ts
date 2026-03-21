export interface MarketData {
  ticker: string;
  price: number;
  change: number;
  changePercent: number;
  volume: number;
  marketCap?: number;
  fiftyTwoWeekHigh?: number;
  fiftyTwoWeekLow?: number;
  avgVolume?: number;
  peRatio?: number;
  analysis: string; // Claude's news + sentiment synthesis
}

export interface RiskAssessment {
  ticker: string;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME';
  canAddPosition: boolean;
  positionsUsed: number;
  maxPositions: number;
  reasoning: string;
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

// SSE event shapes sent from API → client
export type TraceEvent =
  | { type: 'orchestrator_start' }
  | { type: 'agent_log'; agent: string; ticker?: string; text: string }
  | { type: 'phase_start'; agent: string; ticker?: string }
  | { type: 'price_data'; ticker: string; price: number; change: number; changePercent: number; volume: number }
  | { type: 'risk_result'; data: RiskAssessment }
  | { type: 'signal_result'; data: TradingSignal }
  | { type: 'complete' }
  | { type: 'error'; message: string };

export type SendFn = (event: TraceEvent) => void;
