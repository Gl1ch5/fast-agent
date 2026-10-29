// Turning streamed model output into transcript rows and status updates.
import { accent, gray, italic } from '../ui/ansi.ts';
import { ui, out, line, endLine, gap, spin, req } from '../ui/screen.ts';
import { kb } from '../util.ts';
import { agent } from './state.ts';
import type { Call } from '../tools/types.ts';

export function onText(s: string) {
  agent.chars += s.length;
  if (!ui.tui) { if (agent.mode === 'think') out('\n'); agent.mode = 'text'; out(s); return; }
  if (agent.mode !== 'text') { endThink(); gap(); agent.mode = 'text'; }
  out(s, { md: true, ind: 2, mark: accent('● '), kind: 'text' });
}

export function onThink(s: string) {
  agent.chars += s.length;
  if (!ui.tui) { if (agent.mode !== 'think') endLine(); agent.mode = 'think'; out(gray(s)); return; }
  if (agent.mode !== 'think') {
    if (agent.mode === 'text') endLine();
    agent.mode = 'think'; agent.thinking = true; agent.thinkBuf = ''; agent.thinkT0 = Date.now();
    spin.text = 'Thinking';
  }
  agent.thinkBuf = (agent.thinkBuf + s).slice(-2000);
  req();
}

// collapse the reasoning into one "Thought for Ns" line
export function endThink() {
  if (!agent.thinking) return;
  agent.thinking = false;
  const secs = Math.max(1, Math.round((Date.now() - agent.thinkT0) / 1000));
  gap();
  line(gray(italic(`Thought for ${secs}s`)), { ind: 2, mark: gray('∴ '), kind: 'think' });
}

export function endStream() { endThink(); endLine(); agent.mode = ''; agent.draft = null; }

const DOING: Record<string, string> = { write: 'Writing', edit: 'Editing', read: 'Reading', shell: 'Preparing' };

// the model is streaming tool-call arguments
export function toolProgress(name: string, raw: string) {
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
