import { NextRequest } from 'next/server';
import { runOrchestrator } from '@/lib/agents/orchestrator';
import { runMarketAgent } from '@/lib/agents/market-agent';
import { runRiskAgent } from '@/lib/agents/risk-agent';
import { runSignalAgent } from '@/lib/agents/signal-agent';
import type { TraceEvent } from '@/lib/agents/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 120; // seconds

export async function POST(req: NextRequest) {
  const { tickers, currentPositions }: { tickers: string[]; currentPositions: number } =
    await req.json();

  if (!tickers || tickers.length === 0) {
    return new Response(JSON.stringify({ error: 'No tickers provided' }), { status: 400 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: TraceEvent) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          // controller may be closed already
        }
      };

      try {
        send({ type: 'orchestrator_start' });

        // 1. Orchestrator plans the sequence
        const plan = await runOrchestrator(tickers, currentPositions, send);

        // 2. Run Market → Risk → Signal pipeline per ticker
        for (const ticker of plan.sequence) {
          const marketData = await runMarketAgent(ticker, send);
          const riskData = await runRiskAgent(ticker, marketData, currentPositions, send);
          await runSignalAgent(ticker, marketData, riskData, send);
        }

        send({ type: 'complete' });
      } catch (err) {
        send({ type: 'error', message: String(err) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
