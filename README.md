# Trading//Orchestrator

**Agentic ecosystem for real-time trading analysis · Powered by Claude**

Four AI agents with distinct identities and personalities run in parallel, talk to each other, debate their findings, and converge on a trading signal — all streamed live to your screen.

---

## The Agentic Ecosystem

Add up to 3 tickers and hit **Run Agents**. All ticker conversations start simultaneously. Each runs its own multi-agent dialogue:

```
ORACLE → AXIOM → VEGA → EDGE  (→ debate round if needed) → ORACLE
```

All ticker pipelines execute **in parallel** via `Promise.all` — NVDA, AAPL, and TSLA are analyzed at the same time, not one after another.

### The agents

| Agent | Personality | Role |
|---|---|---|
| **ORACLE** | Calm, authoritative, strategic | Opens and closes each ticker session. Directs the team. Delivers the final verdict. |
| **AXIOM** | Data-obsessed, precise, factual | Runs a live web search for price, volume, 52W range, sentiment, and breaking news. Reports in facts only. |
| **VEGA** | Skeptical, contrarian, protective | Challenges overconfidence. Evaluates news risk, sentiment overextension, and price risk. Gives a risk rating. |
| **EDGE** | Decisive, confident, committed | Synthesizes the conversation and makes the call: **BUY / HOLD / WAIT** with entry, stop, and target. |

### The debate

If VEGA rates risk **HIGH** or **EXTREME** and EDGE calls **BUY**, a debate round is triggered automatically:

```
VEGA →EDGE  "That volume spike could be distribution, not accumulation..."
EDGE →VEGA  "Institutional block trades confirmed — reaffirming BUY..."
ORACLE      "Signal confirmed. EDGE holds. Moving on."
```

ORACLE closes with the final word.

---

## Stack

- **Frontend** — Next.js 14, Tailwind CSS, Space Mono font
- **AI** — Anthropic Claude (`claude-sonnet-4-6`) via the Anthropic SDK, with real-time streaming
- **Market data + news** — Anthropic built-in `web_search` tool (no extra API key needed)
- **Parallelism** — `Promise.all` across tickers; SSE stream routes events by ticker to the UI
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

> Your key is only used server-side. It is never exposed in the UI or committed to git.

### 3. Run

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## Usage

1. Add up to **3 tickers** (e.g. `NVDA`, `AAPL`, `TSLA`)
2. Click **▶ Run Agents**
3. Watch the **Agentic Ecosystem** panel — each ticker gets its own conversation section, all streaming simultaneously. Agents appear as colored chat bubbles as they speak.

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

`lib/telemetry.ts` is pre-wired for [Gen AI semantic conventions](https://opentelemetry.io/docs/specs/semconv/gen-ai/). Each Claude call emits spans with:

```
gen_ai.system           = "anthropic"
gen_ai.operation.name   = "chat"
gen_ai.request.model    = "claude-sonnet-4-6"
gen_ai.request.max_tokens
gen_ai.usage.input_tokens
gen_ai.usage.output_tokens
gen_ai.agent.name       = "oracle" | "axiom" | "vega" | "edge"
```

To activate Honeycomb, add your key to `.env.local` and uncomment the OTel exporter in `lib/telemetry.ts`.

---

## Project structure

```
app/
  page.tsx              # Chat-style UI — parallel ticker sections, agent bubbles, signal cards
  api/run/route.ts      # SSE endpoint — runs all ticker conversations in parallel
  layout.tsx / globals.css

lib/
  anthropic.ts          # Anthropic client singleton
  telemetry.ts          # OTel span helper (Honeycomb-ready)
  agents/
    types.ts            # AgentName, ConversationMessage, TradingSignal, TraceEvent
    utils.ts            # formatHistory helper
    conversation.ts     # Per-ticker conversation runner (ORACLE→AXIOM→VEGA→EDGE→debate→ORACLE)
    oracle.ts           # ORACLE — calm orchestrator, opens/closes sessions
    axiom.ts            # AXIOM — market intel via web_search
    vega.ts             # VEGA — skeptical risk assessor, triggers debate
    edge.ts             # EDGE — decisive signal generator, defends or adjusts
```

---

## Disclaimer

This tool is for informational and educational purposes only. Nothing it produces constitutes financial advice. Always do your own research before making any trading decisions.
