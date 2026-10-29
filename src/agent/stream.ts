// Turning streamed model output into transcript rows and status updates.
import { accent, gray, italic, wrapAnsi } from '../ui/ansi.ts';
import { ui, out, line, endLine, gap, spin, req, pushRows } from '../ui/screen.ts';
import { kb } from '../util.ts';
import { agent } from './state.ts';
import type { Call } from '../tools/types.ts';

export function onText(s: string) {
  agent.chars += s.length; agent.firstAt ||= Date.now();
  if (!ui.tui) { if (agent.mode === 'think') out('\n'); agent.mode = 'text'; out(s); return; }
  if (agent.mode !== 'text') { endThink(); gap(); agent.mode = 'text'; }
  out(s, { md: true, ind: 2, mark: accent('● '), kind: 'text' });
}

export function onThink(s: string) {
  agent.chars += s.length; agent.firstAt ||= Date.now();
  if (!ui.tui) { if (agent.mode !== 'think') endLine(); agent.mode = 'think'; out(gray(s)); return; }
  if (agent.mode !== 'think') {
    if (agent.mode === 'text') endLine();
    agent.mode = 'think'; agent.thinking = true; agent.thinkBuf = agent.thinkAll = ''; agent.thinkT0 = Date.now();
    spin.text = 'Thinking';
  }
  agent.thinkBuf = (agent.thinkBuf + s).slice(-2000);
  agent.thinkAll += s;
  req();
}

// collapse the reasoning into one "Thought for Ns" line; Ctrl+O shows it in full
export function endThink() {
  if (!agent.thinking) return;
  agent.thinking = false;
  const secs = Math.max(1, Math.round((Date.now() - agent.thinkT0) / 1000));
  const text = agent.thinkAll.trim();
  gap();
  pushRows([{ s: '', kind: 'think', dyn: (W) => {
    const head = `${gray('∴ ')}${gray(italic(`Thought for ${secs}s`))}${text && !ui.thoughts ? gray('  ctrl+o to expand') : ''}`;
    if (!ui.thoughts || !text) return [head];
    return [head, ...text.split('\n').flatMap((l) => wrapAnsi(l, W - 4)).map((l) => '    ' + gray(italic(l)))];
  } }]);
}

// The live tail of the reasoning, under the transcript while the model thinks.
export function thinkRows(W: number): string[] {
  if (!agent.thinking || !agent.thinkBuf.trim()) return [];
  const ls = agent.thinkBuf.trim().split('\n').flatMap((l) => (l.trim() ? wrapAnsi(l, W - 4) : []));
  return ['', ...ls.slice(-5).map((l) => '    ' + gray(italic(l)))];
}

// Reasoning that arrives inside the text — <think>…</think> (DeepSeek, Qwen, local servers),
// <thought>…</thought> (Gemini) — goes to onThink. Tags count only before any visible text.
export function thinkTags() {
  let buf = '', inside = false, shown = false;
  const tail = (tags: string[]) => {   // keep a tag that may be cut in half at the end
    for (let k = Math.min(buf.length, 11); k > 0; k--) if (tags.some((t) => t.startsWith(buf.slice(-k)))) return k;
    return 0;
  };
  const OPEN = ['<think>', '<thinking>', '<thought>'], CLOSE = ['</think>', '</thinking>', '</thought>'];
  const emit = (t: string) => { if (!shown) t = t.replace(/^\s+/, ''); if (t) { shown = true; onText(t); } return t; };
  const feed = (s: string): string => {
    buf += s; let text = '';
    for (;;) {
      if (!inside) {
        const m = shown ? null : /<(think|thinking|thought)>/.exec(buf);
        if (m && !buf.slice(0, m.index).trim()) { buf = buf.slice(m.index + m[0].length); inside = true; continue; }
        const k = shown ? 0 : tail(OPEN);
        text += emit(buf.slice(0, buf.length - k)); buf = buf.slice(buf.length - k); return text;
      }
      const m = /<\/(think|thinking|thought)>/.exec(buf);
      if (m) { if (m.index) onThink(buf.slice(0, m.index)); buf = buf.slice(m.index + m[0].length); inside = false; continue; }
      const k = tail(CLOSE);
      if (buf.length > k) onThink(buf.slice(0, buf.length - k));
      buf = buf.slice(buf.length - k); return text;
    }
  };
  const flush = (): string => { const b = buf; buf = ''; if (inside) { if (b) onThink(b); return ''; } return emit(b); };
  return { feed, flush };
}

export function endStream() { endThink(); endLine(); agent.mode = ''; agent.draft = null; }

const DOING: Record<string, string> = { write: 'Writing', edit: 'Editing', read: 'Reading', shell: 'Preparing' };

// the model is streaming tool-call arguments
export function toolProgress(name: string, raw: string) {
  agent.firstAt ||= Date.now();
  const p = /"path"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(raw)?.[1] ?? /"command"\s*:\s*"((?:[^"\\]|\\.)*)/.exec(raw)?.[1] ?? '';
  if (agent.mode) { endThink(); endLine(); agent.mode = ''; }
  if (ui.tui) { gap(); agent.draft = { name, raw }; spin.start(DOING[name] || name); return; }
  const what = name === 'shell' ? '' : p.replace(/\\n/g, ' ');
  spin.start(`${DOING[name] || name}${what ? ' ' + what : ''}  ${kb(raw.length)}`);
}

export function parseArgs(name: string, raw: string, truncated: boolean): Pick<Call, 'args' | 'bad'> {
  try { return { args: raw ? JSON.parse(raw) : {} }; }
  catch {
    return {
      args: {},
      bad: truncated
        ? `the ${name} call was cut off by the output token limit — split the content: write a smaller file first, then add the rest with edit`
        : `invalid JSON arguments for ${name}`,
    };
  }
}
