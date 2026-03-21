import { getAnthropicClient, MODEL } from '../anthropic';
import { startSpan } from '../telemetry';
import type { SendFn } from './types';

export interface OrchestratorPlan {
  sequence: string[];
  rationale: string;
}

export async function runOrchestrator(
  tickers: string[],
  currentPositions: number,
  send: SendFn
): Promise<OrchestratorPlan> {
  send({ type: 'phase_start', agent: 'ORCHESTRATOR' });

  const span = startSpan('orchestrator.plan', {
    'gen_ai.system': 'anthropic',
    'gen_ai.operation.name': 'chat',
    'gen_ai.request.model': MODEL,
    'gen_ai.request.max_tokens': 512,
    'gen_ai.agent.name': 'orchestrator',
  });

  const anthropic = getAnthropicClient();

  const stream = anthropic.messages.stream({
    model: MODEL,
    max_tokens: 512,
    system: `You are a trading orchestration AI. Your job is to plan the analysis sequence for a watchlist of tickers.
Given the tickers and current portfolio state:
- Decide the priority order for analysis (highest risk/opportunity first)
- Briefly explain the sequencing rationale (1-2 sentences)
- Consider market cap, sector concentration, and volatility when ordering

Respond in exactly this format:
SEQUENCE: TICKER1, TICKER2, TICKER3
RATIONALE: <one or two sentences explaining the order>`,
    messages: [
      {
        role: 'user',
        content: `Watchlist: ${tickers.join(', ')}
Current open positions: ${currentPositions}/7
Plan the analysis sequence.`,
      },
    ],
  });

  let fullText = '';
  let inputTokens = 0;
  let outputTokens = 0;

  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      fullText += event.delta.text;
      send({ type: 'agent_log', agent: 'ORCHESTRATOR', text: event.delta.text });
    }
    if (event.type === 'message_delta' && event.usage) {
      outputTokens = event.usage.output_tokens;
    }
    if (event.type === 'message_start' && event.message.usage) {
      inputTokens = event.message.usage.input_tokens;
    }
  }

  span.end({
    'gen_ai.usage.input_tokens': inputTokens,
    'gen_ai.usage.output_tokens': outputTokens,
  });

  // Parse the sequence from the response
  const seqMatch = fullText.match(/SEQUENCE:\s*([^\n]+)/i);
  const ratMatch = fullText.match(/RATIONALE:\s*([^\n]+(?:\n(?!SEQUENCE:)[^\n]+)*)/i);

  const sequence = seqMatch
    ? seqMatch[1].split(',').map((t) => t.trim().toUpperCase()).filter((t) => tickers.includes(t))
    : tickers;

  // Fall back to original order if parsing fails
  return {
    sequence: sequence.length === tickers.length ? sequence : tickers,
    rationale: ratMatch ? ratMatch[1].trim() : '',
  };
}
