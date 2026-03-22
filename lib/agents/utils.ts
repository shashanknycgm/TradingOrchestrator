import type { ConversationMessage } from './types';

export function formatHistory(history: ConversationMessage[]): string {
  return history
    .map((m) => `[${m.from}→${m.to}]: ${m.content}`)
    .join('\n\n---\n\n');
}

export function parseField(text: string, key: string): string | undefined {
  return text.match(new RegExp(`${key}:\\s*([^\\n\\-]+)`, 'i'))?.[1]?.trim();
}
