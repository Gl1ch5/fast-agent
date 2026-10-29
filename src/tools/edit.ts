import fs from 'node:fs';
import { safePath, relp, snapshot } from './sandbox.ts';
import { green, red } from '../ui/ansi.ts';
import type { Result } from './types.ts';

export function toolEdit(a: any): Result {
  const abs = safePath(a.path);
  if (!fs.existsSync(abs)) throw new Error(`${a.path} does not exist — use write to create it`);
  const raw = fs.readFileSync(abs, 'utf8');
  const crlf = raw.includes('\r\n');
  let text = crlf ? raw.replace(/\r\n/g, '\n') : raw;
  const edits = Array.isArray(a.edits) ? a.edits : [a];
  let plus = 0, minus = 0;
  for (const [i, e] of edits.entries()) {
    const o = String(e.old ?? '').replace(/\r\n/g, '\n'), nw = String(e.new ?? '').replace(/\r\n/g, '\n');
    if (!o) throw new Error(`edit #${i + 1}: old is empty`);
    const first = text.indexOf(o);
    if (first < 0) throw new Error(`edit #${i + 1}: old text not found in ${a.path} (must match exactly, including whitespace). No changes applied.`);
    if (text.indexOf(o, first + 1) >= 0) throw new Error(`edit #${i + 1}: old text matches several places — add surrounding lines. No changes applied.`);
    text = text.slice(0, first) + nw + text.slice(first + o.length);
    minus += o.split('\n').length; plus += nw.split('\n').length;
  }
  snapshot(abs);
  fs.writeFileSync(abs, crlf ? text.replace(/\n/g, '\r\n') : text);
  return { text: `edited ${relp(abs)}`, show: `${green('+' + plus)} ${red('-' + minus)}` };
}
