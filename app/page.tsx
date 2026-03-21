'use client';

import { useEffect, useRef, useState } from 'react';
import type { TraceEvent, TradingSignal, RiskAssessment } from '@/lib/agents/types';

// ─── Types ────────────────────────────────────────────────────────────────────

type Status = 'IDLE' | 'RUNNING' | 'COMPLETE' | 'ERROR';

interface PriceSnapshot {
  ticker: string;
  price: number;
  change: number;
  changePercent: number;
  volume: number;
}

interface DisplayEvent {
  id: number;
  kind:
    | 'orchestrator_header'
    | 'phase_header'
    | 'log_chunk'
    | 'price_card'
    | 'risk_card'
    | 'signal_card'
    | 'error'
    | 'complete';
  agent?: string;
  ticker?: string;
  text?: string;
  price?: PriceSnapshot;
  risk?: RiskAssessment;
  signal?: TradingSignal;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtVol(v: number): string {
  if (v >= 1_000_000) return (v / 1_000_000).toFixed(1) + 'M';
  if (v >= 1_000) return (v / 1_000).toFixed(0) + 'K';
  return String(v);
}

function signalColor(s: TradingSignal['signal']) {
  return s === 'BUY' ? 'text-primary' : s === 'HOLD' ? 'text-yellow-400' : 'text-gray-400';
}

function riskColor(r: RiskAssessment['riskLevel']) {
  return r === 'LOW'
    ? 'text-primary'
    : r === 'MEDIUM'
    ? 'text-yellow-400'
    : r === 'HIGH'
    ? 'text-orange-400'
    : 'text-red-500';
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function PriceCard({ p }: { p: PriceSnapshot }) {
  const up = p.changePercent >= 0;
  return (
    <div className="border border-border-bright bg-surface-2 px-3 py-2 my-1 text-xs">
      <span className="text-primary font-bold">{p.ticker}</span>
      <span className="ml-3 text-white">${p.price.toFixed(2)}</span>
      <span className={`ml-2 ${up ? 'text-primary' : 'text-red-400'}`}>
        {up ? '+' : ''}
        {p.changePercent.toFixed(2)}%
      </span>
      <span className="ml-3 text-gray-500">Vol {fmtVol(p.volume)}</span>
    </div>
  );
}

function RiskCard({ r }: { r: RiskAssessment }) {
  return (
    <div className="border border-border bg-surface-2 px-3 py-2 my-1 text-xs">
      <div className="flex gap-4 mb-1">
        <span className="text-gray-500">RISK</span>
        <span className={`font-bold ${riskColor(r.riskLevel)}`}>{r.riskLevel}</span>
        <span className="text-gray-500">POSITION</span>
        <span className={r.canAddPosition ? 'text-primary font-bold' : 'text-red-400 font-bold'}>
          {r.canAddPosition ? `CAN ADD (${r.positionsUsed}/${r.maxPositions})` : `FULL (${r.positionsUsed}/${r.maxPositions})`}
        </span>
      </div>
    </div>
  );
}

function SignalCard({ s }: { s: TradingSignal }) {
  const borderCol =
    s.signal === 'BUY'
      ? 'border-primary'
      : s.signal === 'HOLD'
      ? 'border-yellow-400'
      : 'border-gray-600';

  return (
    <div className={`border-l-2 ${borderCol} bg-surface-2 px-4 py-3 my-2`}>
      <div className="flex items-center gap-3 mb-2">
        <span className={`text-lg font-bold ${signalColor(s.signal)}`}>▶ {s.signal}</span>
        <span className="text-gray-500 text-xs">·</span>
        <span className="text-xs text-gray-400">{s.confidence} CONFIDENCE</span>
        <span className="text-gray-500 text-xs">·</span>
        <span className="text-xs text-gray-400">{s.timeframe}</span>
      </div>
      {(s.entry || s.stopLoss || s.target) && (
        <div className="flex gap-4 text-xs mb-2">
          {s.entry && s.entry !== 'N/A' && (
            <span>
              <span className="text-gray-500">ENTRY </span>
              <span className="text-white">{s.entry}</span>
            </span>
          )}
          {s.stopLoss && s.stopLoss !== 'N/A' && (
            <span>
              <span className="text-gray-500">STOP </span>
              <span className="text-red-400">{s.stopLoss}</span>
            </span>
          )}
          {s.target && s.target !== 'N/A' && (
            <span>
              <span className="text-gray-500">TARGET </span>
              <span className="text-primary">{s.target}</span>
            </span>
          )}
        </div>
      )}
      {s.reasoning && (
        <p className="text-xs text-gray-400 leading-relaxed">{s.reasoning}</p>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function Home() {
  const [tickers, setTickers] = useState<string[]>([]);
  const [input, setInput] = useState('');
  const [currentPositions, setCurrentPositions] = useState(0);
  const [status, setStatus] = useState<Status>('IDLE');
  const [events, setEvents] = useState<DisplayEvent[]>([]);
  const traceRef = useRef<HTMLDivElement>(null);
  const idRef = useRef(0);

  const nextId = () => ++idRef.current;

  // Auto-scroll trace panel
  useEffect(() => {
    if (traceRef.current) {
      traceRef.current.scrollTop = traceRef.current.scrollHeight;
    }
  }, [events]);

  const addEvent = (e: Omit<DisplayEvent, 'id'>) => {
    setEvents((prev) => [...prev, { ...e, id: nextId() }]);
  };

  const appendLog = (agent: string, ticker: string | undefined, chunk: string) => {
    setEvents((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.kind === 'log_chunk' && last.agent === agent && last.ticker === ticker) {
        return [
          ...prev.slice(0, -1),
          { ...last, text: (last.text ?? '') + chunk },
        ];
      }
      return [
        ...prev,
        { id: nextId(), kind: 'log_chunk', agent, ticker, text: chunk },
      ];
    });
  };

  const addTicker = () => {
    const t = input.trim().toUpperCase();
    if (!t || tickers.includes(t) || tickers.length >= 3) return;
    setTickers((prev) => [...prev, t]);
    setInput('');
  };

  const removeTicker = (t: string) => setTickers((prev) => prev.filter((x) => x !== t));

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') addTicker();
  };

  const runAgents = async () => {
    if (tickers.length === 0 || status === 'RUNNING') return;

    setStatus('RUNNING');
    setEvents([]);

    try {
      const resp = await fetch('/api/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tickers, currentPositions }),
      });

      if (!resp.ok || !resp.body) {
        setStatus('ERROR');
        addEvent({ kind: 'error', text: `HTTP ${resp.status}: ${resp.statusText}` });
        return;
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const raw = line.slice(6).trim();
          if (!raw) continue;

          let evt: TraceEvent;
          try {
            evt = JSON.parse(raw);
          } catch {
            continue;
          }

          handleTraceEvent(evt);
        }
      }
    } catch (err) {
      setStatus('ERROR');
      addEvent({ kind: 'error', text: String(err) });
    }
  };

  const handleTraceEvent = (evt: TraceEvent) => {
    switch (evt.type) {
      case 'orchestrator_start':
        addEvent({ kind: 'orchestrator_header' });
        break;

      case 'phase_start':
        addEvent({ kind: 'phase_header', agent: evt.agent, ticker: evt.ticker });
        break;

      case 'agent_log':
        appendLog(evt.agent, evt.ticker, evt.text);
        break;

      case 'price_data':
        addEvent({
          kind: 'price_card',
          ticker: evt.ticker,
          price: {
            ticker: evt.ticker,
            price: evt.price,
            change: evt.change,
            changePercent: evt.changePercent,
            volume: evt.volume,
          },
        });
        break;

      case 'risk_result':
        addEvent({ kind: 'risk_card', ticker: evt.data.ticker, risk: evt.data });
        break;

      case 'signal_result':
        addEvent({ kind: 'signal_card', ticker: evt.data.ticker, signal: evt.data });
        break;

      case 'complete':
        setStatus('COMPLETE');
        addEvent({ kind: 'complete' });
        break;

      case 'error':
        setStatus('ERROR');
        addEvent({ kind: 'error', text: evt.message });
        break;
    }
  };

  const agentLabel = (agent?: string) => {
    const colors: Record<string, string> = {
      ORCHESTRATOR: 'text-primary',
      MARKET: 'text-cyan-400',
      RISK: 'text-orange-400',
      SIGNAL: 'text-purple-400',
    };
    return colors[agent ?? ''] ?? 'text-gray-400';
  };

  const statusDot =
    status === 'RUNNING'
      ? 'bg-primary animate-pulse'
      : status === 'COMPLETE'
      ? 'bg-primary'
      : status === 'ERROR'
      ? 'bg-red-500'
      : 'bg-gray-600';

  return (
    <div className="flex flex-col h-screen font-mono text-primary bg-[#0a0a08]">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <header className="flex items-center justify-between px-6 py-3 border-b border-border shrink-0">
        <div className="flex items-baseline gap-6">
          <span className="text-xl font-bold tracking-tight">
            TRADING<span className="text-primary-muted">//</span>ORCHESTRATOR
          </span>
          <span className="text-xs text-primary-muted tracking-widest hidden sm:block">
            MULTI-AGENT TRADING MONITOR · ORCHESTRATED
          </span>
        </div>
        <div className="flex items-center gap-2 text-xs text-primary-muted">
          <span className="tracking-widest">ANTHROPIC</span>
          <span className={`w-2 h-2 rounded-full ${process.env.NODE_ENV ? 'bg-primary' : 'bg-gray-600'}`} />
        </div>
      </header>

      {/* ── Body ───────────────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">
        {/* ── Left sidebar ─────────────────────────────────────────────── */}
        <aside className="w-[360px] shrink-0 border-r border-border flex flex-col overflow-y-auto">
          {/* Portfolio state */}
          <section className="px-5 pt-5 pb-4 border-b border-border">
            <p className="text-[10px] text-primary-muted tracking-widest mb-3">PORTFOLIO</p>
            <div className="flex items-center gap-3">
              <label className="text-xs text-gray-500 whitespace-nowrap">OPEN POSITIONS</label>
              <input
                type="number"
                min={0}
                max={7}
                value={currentPositions}
                onChange={(e) => setCurrentPositions(Math.min(7, Math.max(0, Number(e.target.value))))}
                className="w-14 bg-surface-2 border border-border text-primary text-center text-sm px-2 py-1 outline-none focus:border-border-bright"
              />
              <span className="text-xs text-gray-600">/ 7 MAX</span>
            </div>
          </section>

          {/* Watchlist */}
          <section className="px-5 pt-4 pb-3 border-b border-border flex-1">
            <p className="text-[10px] text-primary-muted tracking-widest mb-3">WATCHLIST</p>

            <p className="text-[10px] text-gray-600 mb-2 tracking-wide">
              ADD TICKER (MAX 3)
            </p>
            <div className="flex gap-2 mb-3">
              <input
                type="text"
                placeholder="e.g. NVDA"
                value={input}
                onChange={(e) => setInput(e.target.value.toUpperCase())}
                onKeyDown={handleKeyDown}
                maxLength={6}
                disabled={tickers.length >= 3}
                className="flex-1 bg-surface-2 border border-border text-primary placeholder-primary-dim text-sm px-3 py-2 outline-none focus:border-border-bright disabled:opacity-40"
              />
            </div>

            <button
              onClick={addTicker}
              disabled={tickers.length >= 3 || !input.trim()}
              className="w-full border border-border-bright text-primary text-xs py-2 px-3 tracking-widest hover:bg-primary-dark disabled:opacity-30 disabled:cursor-not-allowed transition-colors mb-4"
            >
              + ADD TO WATCHLIST
            </button>

            {/* Ticker list */}
            <div className="space-y-1 mb-4">
              {tickers.map((t) => (
                <div
                  key={t}
                  className="flex items-center justify-between border border-border px-3 py-2 text-sm"
                >
                  <span className="font-bold">{t}</span>
                  <button
                    onClick={() => removeTicker(t)}
                    className="text-gray-600 hover:text-red-400 text-xs transition-colors"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>

            <p className="text-[10px] text-gray-600">
              Tickers:{' '}
              <span className={tickers.length > 0 ? 'text-primary' : 'text-gray-600'}>
                {tickers.length}
              </span>{' '}
              / 3
            </p>
          </section>

          {/* Spacer */}
          <div className="flex-1" />

          {/* Run button */}
          <div className="p-5 border-t border-border shrink-0">
            <button
              onClick={runAgents}
              disabled={tickers.length === 0 || status === 'RUNNING'}
              className="w-full bg-primary-dim border border-primary text-primary font-bold text-sm py-4 tracking-widest hover:bg-primary hover:text-black disabled:opacity-30 disabled:cursor-not-allowed transition-all"
            >
              {status === 'RUNNING' ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                  RUNNING...
                </span>
              ) : (
                '▶  RUN AGENTS'
              )}
            </button>
          </div>
        </aside>

        {/* ── Right panel — Agent Trace ──────────────────────────────── */}
        <main className="flex-1 flex flex-col overflow-hidden">
          {/* Trace header */}
          <div className="flex items-center justify-between px-6 py-3 border-b border-border shrink-0">
            <div className="flex items-center gap-3">
              <span className="text-sm font-bold tracking-wider">AGENT TRACE</span>
              <span
                className={`text-[10px] tracking-widest px-2 py-0.5 border ${
                  status === 'RUNNING'
                    ? 'border-primary text-primary'
                    : status === 'COMPLETE'
                    ? 'border-primary-muted text-primary-muted'
                    : status === 'ERROR'
                    ? 'border-red-500 text-red-500'
                    : 'border-gray-700 text-gray-600'
                }`}
              >
                {status}
              </span>
              {status === 'RUNNING' && (
                <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse-slow" />
              )}
            </div>
            {events.length > 0 && (
              <button
                onClick={() => { setEvents([]); setStatus('IDLE'); }}
                className="text-[10px] text-gray-600 hover:text-primary tracking-widest transition-colors"
              >
                CLEAR
              </button>
            )}
          </div>

          {/* Trace body */}
          <div
            ref={traceRef}
            className="flex-1 overflow-y-auto px-6 py-4 space-y-0.5"
          >
            {events.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center">
                <div className="w-12 h-12 rounded-full border border-gray-700 flex items-center justify-center mb-4">
                  <span className="w-4 h-4 rounded-full border border-gray-700" />
                </div>
                <p className="text-xs text-gray-600 tracking-widest mb-2">ADD TICKERS AND RUN AGENTS</p>
                <p className="text-[10px] text-gray-700">Results appear here in real-time</p>
              </div>
            ) : (
              events.map((e) => {
                switch (e.kind) {
                  case 'orchestrator_header':
                    return (
                      <div key={e.id} className="pt-2 pb-1">
                        <span className="text-[10px] text-primary-muted tracking-widest">
                          ── ORCHESTRATOR ─────────────────────────
                        </span>
                      </div>
                    );

                  case 'phase_header':
                    return (
                      <div key={e.id} className="pt-3 pb-1">
                        <span className={`text-[10px] tracking-widest ${agentLabel(e.agent)}`}>
                          ── {e.agent}{e.ticker ? ` [${e.ticker}]` : ''} ─────────────────────────
                        </span>
                      </div>
                    );

                  case 'log_chunk':
                    return (
                      <pre
                        key={e.id}
                        className="text-xs text-gray-400 whitespace-pre-wrap leading-relaxed font-mono"
                      >
                        {e.text}
                      </pre>
                    );

                  case 'price_card':
                    return e.price ? <PriceCard key={e.id} p={e.price} /> : null;

                  case 'risk_card':
                    return e.risk ? <RiskCard key={e.id} r={e.risk} /> : null;

                  case 'signal_card':
                    return e.signal ? <SignalCard key={e.id} s={e.signal} /> : null;

                  case 'error':
                    return (
                      <div key={e.id} className="text-xs text-red-400 py-2">
                        ✕ ERROR: {e.text}
                      </div>
                    );

                  case 'complete':
                    return (
                      <div key={e.id} className="pt-4 pb-2 text-[10px] text-primary-muted tracking-widest">
                        ── ANALYSIS COMPLETE ─────────────────────────
                      </div>
                    );

                  default:
                    return null;
                }
              })
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
