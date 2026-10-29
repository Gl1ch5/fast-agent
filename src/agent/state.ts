// Conversation and live turn state shared by the agent loop, the API clients and the UI.
import type { Call } from '../tools/types.ts';

export type Msg =
  | { role: 'user'; text: string }
  | { role: 'assistant'; text: string; calls: Call[]; blocks?: any[]; prov?: string }
  | { role: 'tool'; id: string; text: string; err?: boolean };

export interface Turn { text: string; calls: Call[]; blocks?: any[]; stop: string }

export const conv = { history: [] as Msg[], system: '' };
export const usage = { in: 0, out: 0, cache: 0 };

// the running request: what the status line shows
export const agent = {
  ctrl: null as AbortController | null,
  t0: 0, chars: 0,
  mode: '' as 'text' | 'think' | '',
  thinking: false, thinkBuf: '', thinkT0: 0,
  draft: null as { name: string; raw: string } | null,   // tool call still being streamed
};
