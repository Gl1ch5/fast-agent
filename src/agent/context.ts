// Keeping the context small. Old tool output and the file contents the model already wrote
// are replaced by short stubs once the conversation grows past cfg.compactAt input tokens
// (300k by default) or past the model's real window, learned from its first "prompt is too long"
// error. The newest tool results stay intact.
import { cfg } from '../config.ts';
import { conv, usage } from './state.ts';

const KEEP = 8;      // newest tool results that are never pruned
const SMALL = 400;   // shorter texts are not worth a stub

export const ctxLimit = { model: '', max: 0 };   // window learned from an error, for this model
export const compactAt = () => {
  const c = cfg.compactAt || 300_000;
  return ctxLimit.max && ctxLimit.model === cfg.model ? Math.min(c, Math.round(ctxLimit.max * 0.8)) : c;
};
export const tooLong = (msg: string) => /context|too long|too many tokens|maximum.*tokens|token limit|exceeds/i.test(msg);

// remember the window from "maximum context length is 128000 tokens" / "215000 tokens > 200000 maximum"
export function learnLimit(msg: string, sent: number) {
  const m = /context(?: length| window)?(?: is| of)? (\d{4,})/i.exec(msg) || /> ?(\d{4,}) maximum/i.exec(msg) || /maximum[^\d]{0,30}(\d{4,})/i.exec(msg);
  const max = m ? Number(m[1]) : Math.round(sent * 0.9);
  if (max > 0) { ctxLimit.max = ctxLimit.model === cfg.model && ctxLimit.max ? Math.min(ctxLimit.max, max) : max; ctxLimit.model = cfg.model; }
}

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
