import fs from 'node:fs';
import { safePath, relp, snapshot } from './sandbox.ts';
import { green, red } from '../ui/ansi.ts';
import type { Result } from './types.ts';

// Where `old` is in `text`: exactly, else line by line ignoring trailing spaces, else ignoring
// indentation (then `nw` is re-indented to the file's indentation). Saves the model a re-read
// and a second try when it gets whitespace slightly wrong.
function locate(text: string, o: string, nw: string, i: number, file: string): { at: number; len: number; nw: string } {
  const first = text.indexOf(o);
  if (first >= 0) {
    if (text.indexOf(o, first + 1) >= 0) throw new Error(`edit #${i}: old text matches several places — add surrounding lines. No changes applied.`);
    return { at: first, len: o.length, nw };
  }
  const trimNl = (s: string) => s.replace(/^\n+|\n+$/g, '');
  const ol = trimNl(o).split('\n'), lines = text.split('\n');
  const starts: number[] = [];
  lines.reduce((p, l) => { starts.push(p); return p + l.length + 1; }, 0);
  for (const norm of [(s: string) => s.trimEnd(), (s: string) => s.trim()]) {
    const want = ol.map(norm);
    const hits: number[] = [];
    for (let s = 0; s + ol.length <= lines.length; s++) if (want.every((w, j) => norm(lines[s + j]) === w)) hits.push(s);
    if (hits.length > 1) throw new Error(`edit #${i}: old text matches several places — add surrounding lines. No changes applied.`);
    if (!hits.length) continue;
    const s = hits[0], e = s + ol.length - 1;
    let rep = trimNl(nw);
    const k = ol.findIndex((l) => l.trim());
    const have = /^\s*/.exec(lines[s + Math.max(0, k)])![0], gave = /^\s*/.exec(ol[Math.max(0, k)])![0];
    if (have !== gave) rep = rep.split('\n').map((l) => (l.startsWith(gave) ? have + l.slice(gave.length) : l)).join('\n');
    return { at: starts[s], len: starts[e] + lines[e].length - starts[s], nw: rep };
  }
  throw new Error(`edit #${i}: old text not found in ${file}. Read the file again and copy the text exactly. No changes applied.`);
}

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
    const m = locate(text, o, nw, i + 1, a.path);
    text = text.slice(0, m.at) + m.nw + text.slice(m.at + m.len);
    minus += o.split('\n').length; plus += nw.split('\n').length;
  }
  snapshot(abs);
  fs.writeFileSync(abs, crlf ? text.replace(/\n/g, '\r\n') : text);
  return { text: `edited ${relp(abs)}`, show: `${green('+' + plus)} ${red('-' + minus)}` };
}
