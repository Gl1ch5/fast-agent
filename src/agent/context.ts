// Keeping the context small. Old tool output and the file contents the model already wrote
// are replaced by short stubs once the conversation grows past cfg.compactAt input tokens
// (or when the API says the prompt is too long). The newest tool results stay intact.
import { cfg } from '../config.ts';
import { conv, usage } from './state.ts';

const KEEP = 8;      // newest tool results that are never pruned
const SMALL = 400;   // shorter texts are not worth a stub

export const compactAt = () => cfg.compactAt || 100_000;
export const tooLong = (msg: string) => /context|too long|too many tokens|maximum.*tokens|token limit|exceeds/i.test(msg);

// returns how many characters were removed
export function prune(keep = KEEP): number {
  const h = conv.history;
  let toolsSeen = 0, cut = 0, from = h.length;
  for (let i = h.length - 1; i >= 0; i--) if (h[i].role === 'tool' && ++toolsSeen > keep) { from = i + 1; break; }
  if (toolsSeen <= keep) return 0;
  for (let i = 0; i < from; i++) {
    const m = h[i];
    if (m.role === 'tool' && !m.pruned && m.text.length > SMALL) {
      cut += m.text.length;
      m.text = `[old output removed to save context (${m.text.length} chars) — read or run again if you need it]`;
      m.pruned = true;
    } else if (m.role === 'assistant') {
      for (const c of m.calls) cut += stubArgs(c.args);
      for (const b of m.blocks || []) if (b.type === 'tool_use') stubArgs(b.input);
    }
  }
  return cut;
}

// write content and edit texts the model sent earlier: the files hold them now
function stubArgs(a: any): number {
  if (!a || typeof a !== 'object') return 0;
  let cut = 0;
  if (typeof a.content === 'string' && a.content.length > SMALL) { cut += a.content.length; a.content = `[${a.content.length} chars written]`; }
  if (Array.isArray(a.edits)) for (const e of a.edits) for (const k of ['old', 'new']) {
    if (typeof e?.[k] === 'string' && e[k].length > SMALL) { cut += e[k].length; e[k] = `[${e[k].length} chars]`; }
  }
  return cut;
}

// before each model call: prune when the last request was already large
export function keepSmall(): number {
  return usage.last > compactAt() ? prune() : 0;
}
