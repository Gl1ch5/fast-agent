// One user request: call the model, run its tools, repeat until it answers.
import { cfg, cur } from '../config.ts';
import { gray, red, yellow } from '../ui/ansi.ts';
import { line, gap, spin } from '../ui/screen.ts';
import { undoStack } from '../tools/sandbox.ts';
import { runTools } from '../tools/index.ts';
import { callAnthropic } from '../api/anthropic.ts';
import { callOpenAI } from '../api/openai.ts';
import { kt } from '../util.ts';
import { conv, usage, agent, type Turn } from './state.ts';
import { endStream } from './stream.ts';

const VERBS = ['Thinking', 'Pondering', 'Working', 'Crafting', 'Cooking', 'Brewing', 'Computing', 'Conjuring'];

export async function runTurn(text: string) {
  if (!cfg.model || !cur()) { line(yellow('no model selected — run /setup or /model'), { ind: 2 }); return; }
  conv.history.push({ role: 'user', text });
  undoStack.push(new Map());
  const ctrl = new AbortController(); const sig = ctrl.signal;
  agent.ctrl = ctrl; agent.t0 = Date.now(); agent.chars = 0; agent.mode = '';
  const u0 = { ...usage };
  const verb = VERBS[Math.floor(Math.random() * VERBS.length)];
  let steps = 0, genMs = 0;   // genMs: time spent streaming output, for the average tok/s
  try {
    for (;;) {
      steps++;
      spin.start(steps === 1 ? verb : 'Working');
      const acc: Turn = { text: '', calls: [], stop: '' };
      agent.firstAt = 0;
      try {
        const p = cur();
        await (p.type === 'anthropic' ? callAnthropic(p, sig, acc) : callOpenAI(p, sig, acc));
        if (agent.firstAt) genMs += Date.now() - agent.firstAt;
      } catch (e) {
        endStream();
        if (acc.text) conv.history.push({ role: 'assistant', text: acc.text, calls: [] });
        throw e;
      }
      endStream();
      conv.history.push({ role: 'assistant', text: acc.text, calls: acc.calls, blocks: acc.blocks, prov: cfg.provider });
      if ((acc.stop === 'max_tokens' || acc.stop === 'length') && !acc.calls.length) line(yellow('output hit the token limit'), { ind: 2 });
      if (!acc.calls.length) break;
      spin.start('Running');
      const results = await runTools(acc.calls, sig);
      acc.calls.forEach((c, i) => conv.history.push({ role: 'tool', id: c.id, text: results[i].text, err: results[i].err }));
      if (sig.aborted) throw new Error('aborted');
    }
  } catch (e: any) {
    spin.stop(); gap();
    if (sig.aborted) line(yellow('■ interrupted'), { ind: 2 });
    else line(red(`✗ ${e.message}`) + (/effort|thinking|adaptive/i.test(e.message) && cfg.effort !== 'auto' ? gray('  (try /think auto)') : ''), { ind: 2 });
  } finally {
    agent.ctrl = null; agent.thinking = false; agent.draft = null;
    spin.stop();
    if (undoStack[undoStack.length - 1]?.size === 0) undoStack.pop();
  }
  const s = ((Date.now() - agent.t0) / 1000).toFixed(1);
  const cache = usage.cache - u0.cache;
  const outTok = usage.out - u0.out || Math.round(agent.chars / 4);
  const tps = genMs > 300 ? ` · ${Math.round(outTok / (genMs / 1000))} tok/s` : '';
  gap();
  line(gray(`${s}s · ↑${kt(usage.in - u0.in)}${cache ? ` (${kt(cache)} cached)` : ''} ↓${kt(outTok)}${tps} · ${steps} step${steps > 1 ? 's' : ''}`), { ind: 2, mark: gray('✻ '), kind: 'meta' });
}
