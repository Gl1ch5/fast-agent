// Live "cards" for running tools: spinner, elapsed time, progress bar, output tail.
// When a tool finishes its card is committed to the transcript.
import { accent, gray, green, red, fit, strip } from './ansi.ts';
import { ui, log, req, gap, line, pushRows, spin, type Row } from './screen.ts';
import { outputLines, progressOf } from '../shell/progress.ts';
import type { Result } from '../tools/types.ts';

export interface Card { title: string; t0: number; tail: string[]; pct?: number; buf: string }
export const cards: Card[] = [];

const BRAILLE = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export function newCard(title: string): Card {
  const c: Card = { title, t0: Date.now(), tail: [], buf: '' };
  cards.push(c);
  if (!ui.tui) spin.start(strip(title));
  req();
  return c;
}

// feed a chunk of command output
export function feedCard(c: Card, chunk: string) {
  c.buf = (c.buf + chunk).slice(-4000);
  const ls = outputLines(c.buf);
  c.tail = ls.slice(-3);
  c.pct = progressOf(ls.slice(-2));
  req();
}

export function bar(pct: number, n: number) {
  const f = (Math.max(0, Math.min(100, pct)) / 100) * n, full = Math.floor(f);
  return accent('━'.repeat(full) + (full < n && f - full >= 0.5 ? '╸' : '')) + gray('─'.repeat(Math.max(0, n - full - (f - full >= 0.5 ? 1 : 0))));
}

export function cardRows(c: Card, W: number): string[] {
  const secs = ((Date.now() - c.t0) / 1000).toFixed(1);
  const rows = [fit(`${accent(BRAILLE[ui.tick % BRAILLE.length])} ${c.title}  ${gray(secs + 's')}`, W)];
  if (c.pct !== undefined) rows.push(`    ${bar(c.pct, Math.max(10, Math.min(32, W - 16)))} ${gray(Math.round(c.pct) + '%')}`);
  for (const l of c.tail) rows.push(fit(gray(`    │ ${l}`), W));
  return rows;
}

export function finishCard(c: Card, r: Result) {
  const i = cards.indexOf(c); if (i >= 0) cards.splice(i, 1);
  const secs = (Date.now() - c.t0) / 1000;
  const mark = r.err ? red('✗ ') : green('✓ ');
  const summary = r.err ? red(r.show) : r.show;
  const tail = (r.tail || '').split('\n').filter((l) => l.trim());
  if (!ui.tui) {
    line(`${mark}${c.title}${summary ? "  " + summary : ""}`);
    for (const l of tail.slice(-4)) line(gray(`    ${l}`));
    return;
  }
  if (log[log.length - 1]?.kind !== 'tool') gap();
  const rows: Row[] = [{ s: `${c.title}${summary ? '  ' + summary : ''}${secs >= 1 ? gray(` · ${secs.toFixed(1)}s`) : ''}`, mark, ind: 2, kind: 'tool' }];
  const shown = tail.slice(-4);
  if (tail.length > 4) rows.push({ s: gray(`… ${tail.length - 4} more lines`), ind: 5, mark: gray('  ⎿  '), kind: 'tool', clip: true });
  shown.forEach((l, j) => rows.push({ s: r.err ? red(l) : gray(l), ind: 5, mark: j === 0 && tail.length <= 4 ? gray('  ⎿  ') : undefined, kind: 'tool', clip: true }));
  pushRows(rows);
}
