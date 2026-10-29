// Tool schemas sent to the model, dispatch, and parallel execution.
import { safePath } from './sandbox.ts';
import { toolWrite } from './write.ts';
import { toolEdit } from './edit.ts';
import { toolRead } from './read.ts';
import { toolShell, SHELL } from './shell.ts';
import { shellLabel } from '../shell/parse.ts';
import { accent2, bold, red, yellow } from '../ui/ansi.ts';
import { newCard, finishCard, type Card } from '../ui/cards.ts';
import { confirm } from '../ui/modal.ts';
import { cfg } from '../config.ts';
import type { Call, Result } from './types.ts';

export const TOOLS = [
  {
    name: 'write',
    description: 'Create or overwrite a file with its complete content. Parent folders are created automatically.',
    schema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] },
  },
  {
    name: 'edit',
    description: 'Replace exact text in an existing file. Each `old` must occur exactly once. Put all changes to one file into a single call.',
    schema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        edits: { type: 'array', items: { type: 'object', properties: { old: { type: 'string' }, new: { type: 'string' } }, required: ['old', 'new'] } },
      },
      required: ['path', 'edits'],
    },
  },
  {
    name: 'read',
    description: 'Read a text file (optionally a line range) or list a directory.',
    schema: {
      type: 'object',
      properties: { path: { type: 'string' }, offset: { type: 'integer', description: 'first line, 1-based' }, limit: { type: 'integer' } },
      required: ['path'],
    },
  },
  {
    name: 'shell',
    description: `Run a ${SHELL} command in the working directory (non-interactive, no stdin). Returns exit code and output tail.`,
    schema: { type: 'object', properties: { command: { type: 'string' }, timeout: { type: 'integer', description: 'seconds, default 120' } }, required: ['command'] },
  },
];

const VERB: Record<string, string> = { write: 'Write', edit: 'Update', read: 'Read' };

export function describe(c: Call) {
  const a = c.args || {};
  if (c.name === 'shell') return `${accent2('$')} ${shellLabel(String(a.command ?? ''))}`;
  return `${bold(VERB[c.name] || c.name)} ${a.path ?? ''}`;
}

async function runTool(c: Call, sig: AbortSignal, card: Card): Promise<Result> {
  if (sig.aborted) return { text: 'not run: interrupted by user', err: true, show: yellow('skipped') };
  if (c.bad) return { text: c.bad, err: true, show: c.bad };
  try {
    switch (c.name) {
      case 'write': return toolWrite(c.args);
      case 'edit': return toolEdit(c.args);
      case 'read': return toolRead(c.args);
      case 'shell':
        if (cfg.safe && !(await confirm(`Run this command?\n\n${String(c.args.command)}`, 'Run it', 'Skip')))
          return { text: 'user declined to run this command', err: true, show: yellow('declined') };
        return await toolShell(c.args, sig, card);
      default: throw new Error(`unknown tool ${c.name}`);
    }
  } catch (e: any) {
    return { text: `error: ${e.message}`, err: true, show: red(e.message) };
  }
}

// Calls touching the same file run in order; everything else runs in parallel.
export async function runTools(calls: Call[], sig: AbortSignal): Promise<Result[]> {
  const results: Result[] = new Array(calls.length);
  const groups = new Map<string, number[]>();
  calls.forEach((c, i) => {
    const k = c.name === 'shell' ? `$${i}` : (() => { try { return safePath(c.args?.path); } catch { return `?${i}`; } })();
    groups.set(k, [...(groups.get(k) || []), i]);
  });
  await Promise.all([...groups.values()].map(async (idx) => {
    for (const i of idx) {
      const card = newCard(describe(calls[i]));
      results[i] = await runTool(calls[i], sig, card);
      finishCard(card, results[i]);
    }
  }));
  return results;
}
