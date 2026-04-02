import { NextRequest } from 'next/server';
import { runTickerConversationSafe } from '@/lib/agents/conversation';
import { sendEvent } from '@/lib/telemetry';
import type { TraceEvent } from '@/lib/agents/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const { tickers, sessionId }: { tickers: string[]; sessionId?: string } = await req.json();

  if (!tickers || tickers.length === 0) {
    return new Response(JSON.stringify({ error: 'No tickers provided' }), { status: 400 });
  }

  // Record the human's "Run Agents" command as a Honeycomb event
  sendEvent('human.input', {
    'event.type': 'human_input',
    'input.tickers': tickers.join(', '),
    'input.ticker_count': tickers.length,
    ...(sessionId ? { 'gen_ai.conversation.id': sessionId } : {}),
  });

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let cancelled = false;

      const send = (event: TraceEvent) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          // Controller already closed — client disconnected
          cancelled = true;
        }
      };

      // Detect client disconnect via AbortSignal
      req.signal.addEventListener('abort', () => {
        if (!cancelled) {
          cancelled = true;
          sendEvent('conversation.cancelled', {
            'event.type': 'cancellation',
            'error.type': 'cancelled',
            'input.tickers': tickers.join(', '),
            ...(sessionId ? { 'gen_ai.conversation.id': sessionId } : {}),
          });
        }
      });

      const onCancel = () => {
        if (!cancelled) {
          cancelled = true;
          sendEvent('conversation.cancelled', {
            'event.type': 'cancellation',
            'error.type': 'cancelled',
            'input.tickers': tickers.join(', '),
            ...(sessionId ? { 'gen_ai.conversation.id': sessionId } : {}),
          });
        }
      };

      try {
        await Promise.all(
          tickers.map((ticker: string) =>
            runTickerConversationSafe(ticker, send, sessionId, onCancel)
          )
        );
        if (!cancelled) send({ type: 'complete' });
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
