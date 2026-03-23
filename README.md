# Trading//Orchestrator

**Agentic ecosystem for real-time trading analysis · Powered by Claude**

Four AI agents with distinct identities and personalities run in parallel, debate their findings across multiple rounds, and converge on a trading signal — all streamed live to your screen.

---

## The Agentic Ecosystem

Add up to 3 tickers and hit **Run Agents**. All ticker conversations start simultaneously. Each runs its own multi-agent dialogue with a structured deliberation protocol:

```
ORACLE → AXIOM → VEGA → EDGE → [Deliberation: up to 3 rounds] → ORACLE
                                  VEGA ⟷ EDGE ⟷ VEGA ⟷ EDGE
                                  (ORACLE arbitrates if unresolved)
```

All ticker pipelines execute **in parallel** via `Promise.all` — NVDA, AAPL, and TSLA are analyzed at the same time, not one after another.

### The agents

| Agent | Personality | Role |
|---|---|---|
| **ORACLE** | Calm, authoritative, strategic | Opens and closes each session. Directs the team. Arbitrates deadlocks. Delivers the final verdict. |
| **AXIOM** | Data-obsessed, precise, factual | Runs a live web search for price, volume, 52W range, sentiment, and breaking news. Reports in facts only. Uses `claude-haiku` for speed. |
| **VEGA** | Skeptical, contrarian, protective | Challenges overconfidence. Evaluates news risk, sentiment overextension, and price risk. Gives a risk rating and drives debate. |
| **EDGE** | Decisive, confident, committed | Synthesizes the conversation and makes the call: **BUY / HOLD / WAIT** with entry, stop, and target. Defends its position under pressure. |

---

### The Deliberation Protocol

Every analysis includes a structured debate between VEGA and EDGE — not just when risk is high, but every run. The debate runs for up to **3 rounds**, with convergence detection after each:

```
── DELIBERATION · ROUND 1 ────────────────────────────
VEGA →EDGE  "Volume spike could be distribution, not accumulation — explain."
EDGE →VEGA  "Block trades confirmed institutional accumulation at this level."

── DELIBERATION · ROUND 2 ────────────────────────────
VEGA →EDGE  "Earnings revisions are trending negative for next quarter."
EDGE →VEGA  "Priced in — forward P/E already reflects the downgrade cycle."

VEGA        "CONCEDE: The valuation argument holds. Risk accepted."
```

**Convergence rules:**
- VEGA starts a response with `CONCEDE:` → loop ends, EDGE's signal stands
- EDGE emits a new `SIGNAL: WAIT` or `SIGNAL: HOLD` → loop ends with the adjusted call
- 3 rounds exhaust without agreement → **ORACLE arbitrates** with a binding `FINAL:` decision

```
── ORACLE ARBITRATION ────────────────────────────────
ORACLE  "Irreconcilable divergence on risk weighting — defaulting to WAIT
         until confirmation. FINAL: WAIT"
```

---

## Stack

- **Frontend** — Next.js 14, Tailwind CSS, Space Mono font
- **AI** — Anthropic Claude (`claude-sonnet-4-6` for ORACLE/VEGA/EDGE, `claude-haiku` for AXIOM) via the Anthropic SDK, with real-time SSE streaming
- **Market data + news** — Anthropic built-in `web_search_20250305` tool (no extra API key needed)
- **Parallelism** — `Promise.all` across tickers; SSE stream routes events by ticker to the UI
- **Observability** — Honeycomb.io via direct Events API with [Gen AI semantic conventions](https://opentelemetry.io/docs/specs/semconv/gen-ai/) and distributed tracing

---

## Setup

### 1. Clone and install

```bash
git clone https://github.com/shashanknycgm/TradingOrchestrator.git
cd TradingOrchestrator
npm install
```

### 2. Add your API keys

Create a `.env.local` file in the project root:

```env
ANTHROPIC_API_KEY=sk-ant-...

# Optional — for Honeycomb observability:
HONEYCOMB_API_KEY=hcaik_...
HONEYCOMB_DATASET=trading-orchestrator
```

> Your keys are only used server-side. They are never exposed in the UI or committed to git.

### 3. Run

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## Usage

1. Add up to **3 tickers** (e.g. `NVDA`, `AAPL`, `TSLA`)
2. Click **▶ Run Agents**
3. Watch the **Agentic Ecosystem** panel — each ticker gets its own conversation section, all streaming simultaneously. Round separators appear as the debate progresses.

### Signal output

Each ticker closes with a structured signal card:

```
▶ BUY · HIGH CONFIDENCE · SWING
ENTRY  $122–125  STOP  $118  TARGET  $140
Strong earnings beat with analyst upgrades...
```

Color-coded: **BUY** (green) · **HOLD** (yellow) · **WAIT** (gray)

---

## Observability (Honeycomb)

Every Claude call emits a span to Honeycomb via direct HTTP POST to the Events API, following [Gen AI semantic conventions](https://opentelemetry.io/docs/specs/semconv/gen-ai/):

```
gen_ai.system              = "anthropic"
gen_ai.operation.name      = "chat" | "tool_call"
gen_ai.request.model       = "claude-sonnet-4-6" | "claude-haiku-..."
gen_ai.request.max_tokens
gen_ai.usage.input_tokens
gen_ai.usage.output_tokens
gen_ai.agent.name          = "oracle" | "axiom" | "vega" | "edge"
gen_ai.agent.role          = "orchestrator" | "market_intel" | "risk_assessor" | "signal_generator"
```

**Distributed tracing** — each ticker run generates a unique `trace.trace_id`. All agent spans share it as children of a root `ticker.analysis` span, so you can reconstruct the full conversation as a trace waterfall in Honeycomb. A `session.id` ties multiple ticker runs together into a single user session.

**Debate round tracking** — VEGA challenge spans carry a `debate.round` field so you can filter and compare how debates progress across runs.

**Tool call spans** — AXIOM's `web_search` calls are emitted as child spans under `tool.web_search` with the query recorded.

**Human input events** — every "Run Agents" click fires a `human.input` event capturing the tickers and session ID, so you can see exactly what the user asked for alongside the agent activity.

**Agent message content** — every message an agent sends is emitted as an `agent.message` event with the full message text, `message.from`, `message.to`, and the ticker — so you can read the entire conversation as it happened directly in Honeycomb.

```
Event types in Honeycomb:
  human.input        — tickers the user submitted + session.id
  agent.message      — full content of each agent message (from/to/content/ticker)
  ticker.analysis    — root span for a full ticker run (duration_ms, token counts)
  oracle.open/close  — ORACLE's opening and closing statements
  axiom.report       — AXIOM's market data call (tokens, model)
  vega.assess/challenge — VEGA's risk assessment + each debate round
  edge.decide/respond   — EDGE's signal + each debate response
  tool.web_search    — AXIOM's individual web search calls (query, duration)
```

---

## Project structure

```
app/
  page.tsx              # Chat-style UI — parallel ticker sections, agent bubbles, round badges, signal cards
  api/run/route.ts      # SSE endpoint — runs all ticker conversations in parallel

lib/
  anthropic.ts          # Anthropic client singleton
  telemetry.ts          # Honeycomb Events API — distributed tracing + Gen AI semantic conventions
  agents/
    types.ts            # AgentName, ConversationMessage, TradingSignal, TraceEvent
    utils.ts            # formatHistory helper
    conversation.ts     # Per-ticker runner — deliberation loop, convergence detection, ORACLE arbitration
    oracle.ts           # ORACLE — orchestrator, opens/closes sessions, arbitrates deadlocks
    axiom.ts            # AXIOM — market intel via web_search (Haiku model)
    vega.ts             # VEGA — risk assessor, multi-round challenger, can concede
    edge.ts             # EDGE — signal generator, defends position or adjusts under pressure
```

---

## Disclaimer

This tool is for informational and educational purposes only. Nothing it produces constitutes financial advice. Always do your own research before making any trading decisions.
