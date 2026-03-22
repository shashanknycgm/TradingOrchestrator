'use client';

import { useEffect, useRef, useState } from 'react';
import type { AgentName, MarketPrice, TradingSignal, TraceEvent } from '@/lib/agents/types';

// ─── Types ────────────────────────────────────────────────────────────────────

type Status = 'IDLE' | 'RUNNING' | 'COMPLETE' | 'ERROR';

interface AgentMsg {
  id: number;
  from: AgentName;
  to: string;
  text: string;
  done: boolean;
}

interface TickerThread {
  ticker: string;
  messages: AgentMsg[];
  status: 'running' | 'complete';
  signal?: TradingSignal;
  price?: MarketPrice;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

let _id = 0;
const uid = () => ++_id;

function fmtVol(v: number): string {
  if (v >= 1_000_000) return (v / 1_000_000).toFixed(1) + 'M';
  if (v >= 1_000) return (v / 1_000).toFixed(0) + 'K';
  return String(v);
}

const AGENT_COLORS: Record<AgentName, string> = {
  ORACLE: 'text-[#aaff00]',
  AXIOM:  'text-cyan-400',
  VEGA:   'text-orange-400',
  EDGE:   'text-purple-400',
};

const AGENT_BORDER: Record<AgentName, string> = {
  ORACLE: 'border-[#aaff00]/30',
  AXIOM:  'border-cyan-400/30',
  VEGA:   'border-orange-400/30',
  EDGE:   'border-purple-400/30',
};

// ─── Sub-components ───────────────────────────────────────────────────────────

function PriceBar({ p }: { p: MarketPrice }) {
  const up = p.changePercent >= 0;
  return (
    <div className="flex items-center gap-3 px-3 py-1.5 bg-[#0a0a08] border border-[#2a2a1a] text-xs mb-1">
      <span className="text-[#aaff00] font-bold">{p.ticker}</span>
      <span className="text-white">${p.price.toFixed(2)}</span>
      <span className={up ? 'text-[#aaff00]' : 'text-red-400'}>
        {up ? '+' : ''}{p.changePercent.toFixed(2)}%
      </span>
      {p.volume > 0 && <span className="text-gray-600">Vol {fmtVol(p.volume)}</span>}
    </div>
  );
}

function SignalBadge({ s }: { s: TradingSignal }) {
  const col = s.signal === 'BUY' ? 'text-[#aaff00] border-[#aaff00]'
    : s.signal === 'HOLD' ? 'text-yellow-400 border-yellow-400'
    : 'text-gray-500 border-gray-600';
  return (
    <span className={`text-[10px] font-bold tracking-widest px-2 py-0.5 border ${col}`}>
      {s.signal}
    </span>
  );
}

function SignalCard({ s }: { s: TradingSignal }) {
  const borderCol = s.signal === 'BUY' ? 'border-[#aaff00]'
    : s.signal === 'HOLD' ? 'border-yellow-400'
    : 'border-gray-600';
  const textCol = s.signal === 'BUY' ? 'text-[#aaff00]'
    : s.signal === 'HOLD' ? 'text-yellow-400'
    : 'text-gray-400';
  return (
    <div className={`border-l-2 ${borderCol} pl-4 py-2 mt-2 bg-[#0f0f0c]`}>
      <div className="flex items-center gap-3 mb-1">
        <span className={`text-sm font-bold ${textCol}`}>▶ {s.signal}</span>
        <span className="text-gray-600 text-[10px]">·</span>
        <span className="text-[10px] text-gray-500">{s.confidence} CONFIDENCE · {s.timeframe}</span>
      </div>
      {(s.entry || s.stopLoss || s.target) && (
        <div className="flex gap-4 text-[10px] mb-1">
          {s.entry && s.entry !== 'N/A' && (
            <span><span className="text-gray-600">ENTRY </span><span className="text-white">{s.entry}</span></span>
          )}
          {s.stopLoss && s.stopLoss !== 'N/A' && (
            <span><span className="text-gray-600">STOP </span><span className="text-red-400">{s.stopLoss}</span></span>
          )}
          {s.target && s.target !== 'N/A' && (
            <span><span className="text-gray-600">TARGET </span><span className="text-[#aaff00]">{s.target}</span></span>
          )}
        </div>
      )}
      {s.reasoning && (
        <p className="text-[11px] text-gray-500 leading-relaxed">{s.reasoning}</p>
      )}
    </div>
  );
}

function AgentBubble({ msg }: { msg: AgentMsg }) {
  const col = AGENT_COLORS[msg.from];
  const border = AGENT_BORDER[msg.from];
  const toLabel = msg.to !== 'all'
    ? <span className="text-gray-700 text-[9px] ml-1">→{msg.to}</span>
    : null;

  return (
    <div className={`flex gap-3 border-l ${border} pl-3 py-1`}>
      <div className="shrink-0 w-14">
        <span className={`text-[10px] font-bold tracking-widest ${col}`}>{msg.from}</span>
        {toLabel}
      </div>
      <div className="flex-1 min-w-0">
        <pre
          className={`text-[11px] text-gray-300 whitespace-pre-wrap leading-relaxed font-mono break-words ${
            !msg.done ? 'after:content-["▌"] after:text-gray-600 after:animate-pulse' : ''
          }`}
        >
          {msg.text || <span className="text-gray-700">...</span>}
        </pre>
      </div>
    </div>
  );
}

function TickerSection({ thread }: { thread: TickerThread }) {
  const isRunning = thread.status === 'running';
  return (
    <div className="border border-[#2a2a1a] mb-4">
      {/* Section header */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-[#2a2a1a] bg-[#0d0d0a]">
        <span className="font-bold text-[#aaff00] tracking-wider">{thread.ticker}</span>
        {isRunning ? (
          <span className="flex items-center gap-1.5 text-[10px] text-[#aaff00] tracking-widest">
            <span className="w-1.5 h-1.5 rounded-full bg-[#aaff00] animate-pulse" />
            ACTIVE
          </span>
        ) : (
          <span className="text-[10px] text-gray-600 tracking-widest">DONE</span>
        )}
        {thread.price && <PriceBar p={thread.price} />}
        {thread.signal && <SignalBadge s={thread.signal} />}
      </div>

      {/* Messages */}
      <div className="p-4 space-y-3">
        {thread.messages.map((msg) => (
          <AgentBubble key={msg.id} msg={msg} />
        ))}
        {thread.signal && thread.status === 'complete' && (
          <SignalCard s={thread.signal} />
        )}
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function Home() {
  const [tickers, setTickers] = useState<string[]>([]);
  const [input, setInput] = useState('');
  const [status, setStatus] = useState<Status>('IDLE');
  const [threads, setThreads] = useState<TickerThread[]>([]);
  const traceRef = useRef<HTMLDivElement>(null);

  // Auto-scroll
  useEffect(() => {
    if (traceRef.current) {
      traceRef.current.scrollTop = traceRef.current.scrollHeight;
    }
  }, [threads]);

  const addTicker = () => {
    const t = input.trim().toUpperCase();
    if (!t || tickers.includes(t) || tickers.length >= 3) return;
    setTickers((p) => [...p, t]);
    setInput('');
  };

  const removeTicker = (t: string) => setTickers((p) => p.filter((x) => x !== t));

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') addTicker();
  };

  // ── Event handlers ──────────────────────────────────────────────────────────

  const handleEvent = (evt: TraceEvent) => {
    switch (evt.type) {
      case 'ticker_start':
        setThreads((p) => [
          ...p,
          { ticker: evt.ticker, messages: [], status: 'running' },
        ]);
        break;

      case 'agent_chunk':
        setThreads((p) =>
          p.map((thread) => {
            if (thread.ticker !== evt.ticker) return thread;
            const msgs = [...thread.messages];
            const last = msgs[msgs.length - 1];
            if (last && last.from === evt.from && !last.done) {
              // Append chunk to current message
              msgs[msgs.length - 1] = { ...last, text: last.text + evt.text };
            } else if (evt.text === '') {
              // New message starting
              msgs.push({ id: uid(), from: evt.from, to: evt.to, text: '', done: false });
            }
            return { ...thread, messages: msgs };
          })
        );
        break;

      case 'agent_message_done':
        setThreads((p) =>
          p.map((thread) => {
            if (thread.ticker !== evt.ticker) return thread;
            const msgs = [...thread.messages];
            const last = msgs[msgs.length - 1];
            if (last && last.from === evt.from && !last.done) {
              msgs[msgs.length - 1] = { ...last, text: evt.content, done: true };
            }
            return { ...thread, messages: msgs };
          })
        );
        break;

      case 'price_update':
        setThreads((p) =>
          p.map((thread) =>
            thread.ticker === evt.ticker ? { ...thread, price: evt.price } : thread
          )
        );
        break;

      case 'ticker_complete':
        setThreads((p) =>
          p.map((thread) =>
            thread.ticker === evt.ticker
              ? { ...thread, status: 'complete', signal: evt.signal }
              : thread
          )
        );
        break;

      case 'complete':
        setStatus('COMPLETE');
        break;

      case 'error':
        setStatus('ERROR');
        break;
    }
  };

  // ── Run ─────────────────────────────────────────────────────────────────────

  const runAgents = async () => {
    if (tickers.length === 0 || status === 'RUNNING') return;
    setStatus('RUNNING');
    setThreads([]);

    try {
      const resp = await fetch('/api/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tickers }),
      });

      if (!resp.ok || !resp.body) {
        setStatus('ERROR');
        return;
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const raw = line.slice(6).trim();
          if (!raw) continue;
          try {
            handleEvent(JSON.parse(raw));
          } catch { /* ignore parse errors */ }
        }
      }
    } catch {
      setStatus('ERROR');
    }
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  const statusDot =
    status === 'RUNNING' ? 'bg-[#aaff00] animate-pulse'
    : status === 'COMPLETE' ? 'bg-[#aaff00]'
    : status === 'ERROR' ? 'bg-red-500'
    : 'bg-gray-700';

  return (
    <div className="flex flex-col h-screen font-mono text-[#aaff00] bg-[#0a0a08]">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header className="flex items-center justify-between px-6 py-3 border-b border-[#2a2a1a] shrink-0">
        <div className="flex items-baseline gap-6">
          <span className="text-xl font-bold tracking-tight">
            TRADING<span className="text-[#445500]">//</span>ORCHESTRATOR
          </span>
          <span className="text-[10px] text-[#445500] tracking-widest hidden sm:block">
            MULTI-AGENT TRADING MONITOR · ORCHESTRATED
          </span>
        </div>
        <div className="flex items-center gap-2 text-[10px] text-[#445500] tracking-widest">
          ANTHROPIC
          <span className={`w-2 h-2 rounded-full ${statusDot}`} />
        </div>
      </header>

      {/* ── Body ───────────────────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">

        {/* ── Left sidebar ─────────────────────────────────────────────────── */}
        <aside className="w-[360px] shrink-0 border-r border-[#2a2a1a] flex flex-col">
          <section className="px-5 pt-5 pb-4 flex-1 overflow-y-auto">
            <p className="text-[10px] text-[#445500] tracking-widest mb-4">WATCHLIST</p>
            <p className="text-[10px] text-gray-700 mb-2 tracking-wide">ADD TICKER (MAX 3)</p>

            <div className="flex gap-2 mb-3">
              <input
                type="text"
                placeholder="e.g. NVDA"
                value={input}
                onChange={(e) => setInput(e.target.value.toUpperCase())}
                onKeyDown={handleKeyDown}
                maxLength={6}
                disabled={tickers.length >= 3}
                className="flex-1 bg-[#0f0f0c] border border-[#2a2a1a] text-[#aaff00] placeholder-[#334400] text-sm px-3 py-2 outline-none focus:border-[#445500] disabled:opacity-40"
              />
            </div>

            <button
              onClick={addTicker}
              disabled={tickers.length >= 3 || !input.trim()}
              className="w-full border border-[#445500] text-[#aaff00] text-xs py-2 px-3 tracking-widest hover:bg-[#1a2200] disabled:opacity-30 disabled:cursor-not-allowed transition-colors mb-5"
            >
              + ADD TO WATCHLIST
            </button>

            <div className="space-y-1.5 mb-5">
              {tickers.map((t) => (
                <div
                  key={t}
                  className="flex items-center justify-between border border-[#2a2a1a] px-3 py-2 text-sm"
                >
                  <span className="font-bold">{t}</span>
                  <button
                    onClick={() => removeTicker(t)}
                    className="text-gray-700 hover:text-red-400 text-xs transition-colors"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>

            <p className="text-[10px] text-gray-700">
              Tickers:{' '}
              <span className={tickers.length > 0 ? 'text-[#aaff00]' : 'text-gray-700'}>
                {tickers.length}
              </span>{' '}
              / 3
            </p>
          </section>

          {/* Agent legend */}
          <section className="px-5 py-4 border-t border-[#2a2a1a]">
            <p className="text-[10px] text-[#445500] tracking-widest mb-3">AGENTS</p>
            <div className="space-y-1.5">
              {([
                ['ORACLE', 'text-[#aaff00]', 'Orchestrator'],
                ['AXIOM',  'text-cyan-400',   'Market Intel'],
                ['VEGA',   'text-orange-400',  'Risk Assessment'],
                ['EDGE',   'text-purple-400',  'Signal Generation'],
              ] as const).map(([name, col, role]) => (
                <div key={name} className="flex items-center gap-2">
                  <span className={`text-[10px] font-bold tracking-widest w-14 ${col}`}>{name}</span>
                  <span className="text-[10px] text-gray-700">{role}</span>
                </div>
              ))}
            </div>
          </section>

          {/* Run button */}
          <div className="p-5 border-t border-[#2a2a1a] shrink-0">
            <button
              onClick={runAgents}
              disabled={tickers.length === 0 || status === 'RUNNING'}
              className="w-full bg-[#1a2500] border border-[#aaff00] text-[#aaff00] font-bold text-sm py-4 tracking-widest hover:bg-[#aaff00] hover:text-black disabled:opacity-30 disabled:cursor-not-allowed transition-all"
            >
              {status === 'RUNNING' ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-[#aaff00] animate-pulse" />
                  AGENTS RUNNING...
                </span>
              ) : (
                '▶  RUN AGENTS'
              )}
            </button>
          </div>
        </aside>

        {/* ── Right panel — Agent Trace ──────────────────────────────────── */}
        <main className="flex-1 flex flex-col overflow-hidden">
          <div className="flex items-center justify-between px-6 py-3 border-b border-[#2a2a1a] shrink-0">
            <div className="flex items-center gap-3">
              <span className="text-sm font-bold tracking-wider">AGENTIC ECOSYSTEM</span>
              <span className={`text-[10px] tracking-widest px-2 py-0.5 border ${
                status === 'RUNNING'  ? 'border-[#aaff00] text-[#aaff00]'
                : status === 'COMPLETE' ? 'border-[#445500] text-[#445500]'
                : status === 'ERROR'    ? 'border-red-500 text-red-500'
                : 'border-gray-700 text-gray-700'
              }`}>
                {status}
              </span>
            </div>
            {threads.length > 0 && (
              <button
                onClick={() => { setThreads([]); setStatus('IDLE'); }}
                className="text-[10px] text-gray-700 hover:text-[#aaff00] tracking-widest transition-colors"
              >
                CLEAR
              </button>
            )}
          </div>

          <div ref={traceRef} className="flex-1 overflow-y-auto p-6">
            {threads.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center">
                <div className="w-12 h-12 rounded-full border border-gray-800 flex items-center justify-center mb-4">
                  <span className="w-4 h-4 rounded-full border border-gray-800" />
                </div>
                <p className="text-[11px] text-gray-700 tracking-widest mb-2">ADD TICKERS AND RUN AGENTS</p>
                <p className="text-[10px] text-gray-800">
                  ORACLE · AXIOM · VEGA · EDGE run in parallel per ticker
                </p>
              </div>
            ) : (
              threads.map((thread) => (
                <TickerSection key={thread.ticker} thread={thread} />
              ))
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
