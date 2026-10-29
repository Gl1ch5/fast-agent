// Live preview of a tool call while the model is still streaming it:
// file name, size, and the last lines of the content being written.
import { accent2, bold, gray, fit } from './ansi.ts';
import { ui } from './screen.ts';
import { agent } from '../agent/state.ts';
import { shellLabel } from '../shell/parse.ts';
import { kb } from '../util.ts';

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const TITLE: Record<string, string> = { write: 'Write', edit: 'Update', read: 'Read' };

// value of "key" in an unfinished JSON object; the last occurrence (edits stream several "new")
export function partialString(raw: string, key: string): string | null {
  const re = new RegExp(`"${key}"\\s*:\\s*"`, 'g');
  let m: RegExpExecArray | null, at = -1;
  while ((m = re.exec(raw))) at = m.index + m[0].length;
  if (at < 0) return null;
  let out = '';
  for (let i = at; i < raw.length;) {
    const c = raw[i];
    if (c === '"') break;
    if (c !== '\\') { out += c; i++; continue; }
    const n = raw[i + 1];
    if (n === undefined) break;
    if (n === 'u') { const h = raw.slice(i + 2, i + 6); if (h.length < 4) break; out += String.fromCharCode(parseInt(h, 16)); i += 6; continue; }
    out += ({ n: '\n', t: '  ', r: '', b: '', f: '' } as Record<string, string>)[n] ?? n;
    i += 2;
  }
  return out;
}

let cache = { raw: '', W: 0, rows: [] as string[] };

export function draftRows(W: number): string[] {
  const d = agent.draft;
  if (!d) return [];
  if (cache.raw === d.raw && cache.W === W) return withSpinner(cache.rows);
  const file = partialString(d.raw, 'path') ?? '';
  let head: string, body: string | null = null;
  if (d.name === 'shell') head = `${accent2('$')} ${shellLabel(partialString(d.raw, 'command') ?? '')}`;
  else {
    body = d.name === 'write' ? partialString(d.raw, 'content') : d.name === 'edit' ? partialString(d.raw, 'new') : null;
    const lines = body === null ? 0 : body.split('\n').length;
    head = `${bold(TITLE[d.name] || d.name)} ${file}${body !== null ? gray(`  · ${lines} lines · ${kb(Buffer.byteLength(body))}`) : ''}`;
  }
  const rows = [head];
  if (body) {
    const ls = body.split('\n');
    const start = Math.max(0, ls.length - 6);
    ls.slice(start).forEach((l, i) => rows.push(fit(gray(`    ${String(start + i + 1).padStart(4)} │ ${l}`), W)));
  }
  cache = { raw: d.raw, W, rows };
  return withSpinner(rows);
}

const withSpinner = (rows: string[]) => [`${accent2(FRAMES[ui.tick % FRAMES.length])} ${rows[0]}`, ...rows.slice(1)];
