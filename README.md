# Trading//Orchestrator

**Multi-agent trading monitor · Orchestrated by Claude**

A real-time, AI-powered trading analysis tool that runs a 4-agent pipeline against your watchlist — delivering market intelligence, risk assessment, and actionable signals for swing and day traders.

---

## What it does

You add up to 3 tickers, set your current open position count, and hit **Run Agents**. Four Claude-powered agents then work in sequence, streaming their reasoning to the screen in real time:

```
Orchestrator → Market Agent → Risk Agent → Signal Agent
```

| Agent | Role |
|---|---|
| **Orchestrator** | Plans the analysis sequence — prioritizes tickers by risk/opportunity |
| **Market Agent** | Fetches live price data (Yahoo Finance) + searches the web for breaking news and sentiment |
| **Risk Agent** | Assesses position risk against your portfolio rules (max 7 positions, swing/day focus), evaluates news-driven risk |
| **Signal Agent** | Produces a **BUY / HOLD / WAIT** recommendation with entry, stop-loss, target, and reasoning |

---

## Stack

- **Frontend** — Next.js 14, Tailwind CSS, Space Mono font
- **AI** — Anthropic Claude (`claude-sonnet-4-6`) via the Anthropic SDK, with streaming
- **Market data** — [yahoo-finance2](https://github.com/gadicc/node-yahoo-finance2) (free, no API key)
- **News** — Anthropic built-in `web_search` tool (server-side, no extra key needed)
- **Observability** — OpenTelemetry stub following [Gen AI semantic conventions](https://opentelemetry.io/docs/specs/semconv/gen-ai/), ready to wire into Honeycomb

---

## Setup

### 1. Clone and install

```bash
git clone https://github.com/shashanknycgm/TradingOrchestrator.git
cd TradingOrchestrator
npm install
```

### 2. Add your API key

Create a `.env.local` file in the project root:

```env
ANTHROPIC_API_KEY=sk-ant-...

# Optional — add when ready for Honeycomb tracing:
# HONEYCOMB_API_KEY=
# HONEYCOMB_DATASET=trading-orchestrator
```

> Your key is only used server-side and is never exposed in the UI or committed to git.

### 3. Run

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## Usage

1. Set **Open Positions** to your current number of active trades (used by the Risk Agent)
2. Add up to **3 tickers** (e.g. `NVDA`, `AAPL`, `MSFT`)
3. Click **▶ Run Agents**
4. Watch the agent trace stream in real time — price cards, risk ratings, and final signals appear as each agent completes

### Signal output

Each ticker gets a structured result:

```
▶ BUY · HIGH CONFIDENCE · SWING
ENTRY  $122–125  STOP  $118  TARGET  $140
Strong earnings beat with analyst upgrades...
```

Signals are color-coded: **BUY** (green) · **HOLD** (yellow) · **WAIT** (gray)

---

## Observability (Honeycomb)

The telemetry layer in `lib/telemetry.ts` is pre-wired for [Gen AI semantic conventions](https://opentelemetry.io/docs/specs/semconv/gen-ai/). Each Claude call emits spans with:

```
gen_ai.system           = "anthropic"
gen_ai.operation.name   = "chat"
gen_ai.request.model    = "claude-sonnet-4-6"
gen_ai.request.max_tokens
gen_ai.usage.input_tokens
gen_ai.usage.output_tokens
gen_ai.agent.name       = "orchestrator" | "market_agent" | "risk_agent" | "signal_agent"
```

To activate Honeycomb, add your key to `.env.local` and uncomment the OTel exporter in `lib/telemetry.ts`.

---

## Project structure

```
app/
  page.tsx              # Main UI (client component — streaming trace display)
  api/run/route.ts      # Streaming SSE endpoint — wires the 4-agent pipeline
  layout.tsx / globals.css

lib/
  anthropic.ts          # Anthropic client singleton
  telemetry.ts          # OTel span helper (Honeycomb-ready)
  agents/
    types.ts            # Shared types (MarketData, RiskAssessment, TradingSignal)
    orchestrator.ts     # Plans analysis sequence
    market-agent.ts     # Price data + web search
    risk-agent.ts       # Risk evaluation
    signal-agent.ts     # Signal generation
```

---

## Disclaimer

This tool is for informational and educational purposes only. Nothing it produces constitutes financial advice. Always do your own research before making any trading decisions.
