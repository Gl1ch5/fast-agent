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
  const n = a.content.split('\n').length;
  return { text: `wrote ${relp(abs)} (${n} lines)`, show: gray(`${existed ? 'rewrote' : 'created'} · ${n} lines · ${kb(Buffer.byteLength(a.content))}`) };
}
