import { getAnthropicClient, MODEL } from '../anthropic';
import { formatHistory } from './utils';
import type { ConversationMessage, AgentName, SendFn } from './types';

const SYSTEM = `You are VEGA, risk assessment agent for Trading Orchestrator.
You are skeptical, contrarian, and protect the portfolio above all else.
You challenge overconfidence. You find what others miss.
Focus on: news-driven risk, sentiment overextension, price proximity to 52W extremes, volume anomalies.

For the 'assess' phase — end your message with exactly:
---
RISK: [LOW|MEDIUM|HIGH|EXTREME]
CAN_ADD: [YES|NO]
---

For the 'challenge' phase — directly challenge EDGE's position with a specific, concrete concern.
On round 2 or 3, if EDGE made a genuinely strong point that addresses your concern, you may concede.
To concede, start your message with exactly "CONCEDE:" and briefly acknowledge what convinced you.
Otherwise, pivot to a different specific risk you haven't raised yet.

Keep it sharp: 2-4 sentences max. You don't waste words.`;

async function streamVega(
  phase: 'assess' | 'challenge',
  ticker: string,
  history: ConversationMessage[],
  send: SendFn,
  round?: number
): Promise<string> {
  const to = phase === 'challenge' ? 'EDGE' : 'all';
  const anthropic = getAnthropicClient();
  let fullText = '';

  let userContent: string;
  if (phase === 'assess') {
    userContent = `Conversation:\n\n${formatHistory(history)}\n\nAssess risk for ${ticker}. Be skeptical. What are the real dangers here?`;
  } else if (round === 1) {
    userContent = `Conversation:\n\n${formatHistory(history)}\n\nRound 1 — Challenge EDGE's call on ${ticker}. Pick the single most important risk they are underweighting. Be specific and sharp.`;
  } else {
    userContent = `Conversation:\n\n${formatHistory(history)}\n\nRound ${round} — EDGE has responded to your challenge. If their defense is genuinely solid and addresses your concern, start with "CONCEDE:" and acknowledge it. Otherwise, press a DIFFERENT specific risk you haven't raised yet. Don't repeat yourself.`;
  }

  send({ type: 'agent_chunk', ticker, from: 'VEGA' as AgentName, to, text: '' });

  const stream = anthropic.messages.stream({
    model: MODEL,
    max_tokens: 300,
    system: SYSTEM,
    messages: [{ role: 'user', content: userContent }],
  });

  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      fullText += event.delta.text;
      send({ type: 'agent_chunk', ticker, from: 'VEGA' as AgentName, to, text: event.delta.text });
    }
  }

  send({ type: 'agent_message_done', ticker, from: 'VEGA' as AgentName, to, content: fullText });
  return fullText;
}

export const vegaAssess = (ticker: string, history: ConversationMessage[], send: SendFn) =>
  streamVega('assess', ticker, history, send);

export const vegaChallenge = (ticker: string, history: ConversationMessage[], send: SendFn, round = 1) =>
  streamVega('challenge', ticker, history, send, round);
