import fs from 'node:fs';
import path from 'node:path';
import { safePath, relp, snapshot } from './sandbox.ts';
import { gray } from '../ui/ansi.ts';
import { kb } from '../util.ts';
import type { Result } from './types.ts';

export function toolWrite(a: any): Result {
  const abs = safePath(a.path);
  if (typeof a.content !== 'string') throw new Error('content must be a string');
  const existed = fs.existsSync(abs);
  snapshot(abs);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, a.content);
  const ls = a.content.replace(/\n$/, '').split('\n'), n = a.content ? ls.length : 0;
  const preview = ls.slice(0, n).map((l: string, i: number) => gray(`${String(i + 1).padStart(4)} │ ${l}`));
  return { preview, text: `wrote ${relp(abs)} (${n} lines)`, show: gray(`${existed ? 'rewrote' : 'created'} · ${n} lines · ${kb(Buffer.byteLength(a.content))}`) };
}
