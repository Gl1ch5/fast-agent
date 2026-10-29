import fs from 'node:fs';
import { safePath } from './sandbox.ts';
import { gray } from '../ui/ansi.ts';
import type { Result } from './types.ts';

export function toolRead(a: any): Result {
  const abs = safePath(a.path);
  const st = fs.statSync(abs);
  if (st.isDirectory()) {
    const ents = fs.readdirSync(abs, { withFileTypes: true }).sort((x, y) => Number(y.isDirectory()) - Number(x.isDirectory()) || x.name.localeCompare(y.name));
    const list = ents.slice(0, 500).map((e) => e.name + (e.isDirectory() ? '/' : '')).join('\n');
    return { text: (list || '(empty)') + (ents.length > 500 ? `\n… ${ents.length - 500} more` : ''), show: gray(`${ents.length} entries`) };
  }
  const buf = fs.readFileSync(abs);
  if (buf.subarray(0, 8000).includes(0)) return { text: `binary file, ${buf.length} bytes`, show: gray('binary') };
  const lines = buf.toString('utf8').split('\n');
  const from = Math.max(1, Number(a.offset) || 1);
  const limit = Math.max(1, Number(a.limit) || 2000);
  let body = lines.slice(from - 1, from - 1 + limit).join('\n');
  if (body.length > 60_000) body = body.slice(0, 60_000) + '\n… [truncated]';
  const end = Math.min(lines.length, from - 1 + limit);
  if (end < lines.length) body += `\n… [${lines.length - end} more lines, read with offset=${end + 1}]`;
  return { text: body, show: gray(from > 1 || end < lines.length ? `lines ${from}-${end} of ${lines.length}` : `${lines.length} lines`) };
}
