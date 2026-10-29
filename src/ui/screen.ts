// The transcript and the low-level output API. In the full-screen TUI everything
// goes into `log` and is drawn by render.ts; in print mode (-p, pipes) it is
// written straight to stdout.
import { TTY, w } from '../env.ts';
import { clip, cyan, dim, gray } from './ansi.ts';
import { render } from './render.ts';
import { queue } from './input.ts';

// One logical transcript line. Wrapped to the screen width at render time (cached).
export interface Row {
  s: string; md?: boolean; ind?: number; mark?: string; clip?: boolean; kind?: string;
  wr?: string[]; ww?: number; wf?: boolean;
}

export const ui = { tui: false, scroll: 0, tick: 0, note: '', noteUntil: 0 };
export const log: Row[] = [];
let open = false;   // TUI: the last row still receives streamed text
let atBOL = true;   // print mode: cursor is at the beginning of a line
let queued = false;

export function req() {
  if (!ui.tui || queued) return;
  queued = true;
  setTimeout(() => { queued = false; render(); }, 16);
}

export type RowOpts = { md?: boolean; ind?: number; mark?: string; kind?: string; clip?: boolean };

// streamed text; `mark` decorates the first row of a new block
export function out(s: string, o: RowOpts = {}) {
  if (!s) return;
  if (!ui.tui) { spin.stop(); w(s); atBOL = s.endsWith('\n'); return; }
  s.split('\n').forEach((p, i) => {
    if (i > 0 || !open) log.push({ s: '', md: o.md, ind: o.ind, kind: o.kind, mark: !open && i === 0 ? o.mark : undefined });
    const r = log[log.length - 1]; r.s += p; r.wr = undefined;
  });
  open = true; req();
}

export function endLine() {
  if (!ui.tui) { if (!atBOL) { w('\n'); atBOL = true; } return; }
  if (open && log.length && log[log.length - 1].s === '') log.pop();
  open = false;
}

export function line(s = '', o: RowOpts = {}) {
  if (!ui.tui) { spin.stop(); if (!atBOL) w('\n'); w((o.mark ?? '') + s + '\n'); atBOL = true; return; }
  endLine();
  for (const p of s.split('\n')) log.push({ ...o, s: p });
  req();
}

export function pushRows(rows: Row[]) {
  if (!ui.tui) { for (const r of rows) line(r.s, r); return; }
  endLine(); log.push(...rows); req();
}

// one blank row between blocks
export function gap() {
  if (!ui.tui) return;
  endLine();
  if (log.length && log[log.length - 1].s !== '') log.push({ s: '' });
}

// transient message in the footer
export function note(s: string, ms = 2000) { ui.note = s; ui.noteUntil = Date.now() + ms; req(); }

export const spin = {
  t: null as ReturnType<typeof setInterval> | null, text: '', on: false, i: 0,
  start(text: string) {
    this.text = text;
    if (ui.tui) { this.on = true; req(); return; }
    if (!TTY || this.t) return;
    if (!atBOL) { w('\n'); atBOL = true; }
    w('\x1b[?25l');
    this.t = setInterval(() => this.draw(), 90); this.draw();
  },
  draw() {
    const f = ['·  ', '·· ', '···', ' ··', '  ·', '   '][this.i++ % 6];
    const q = queue.length ? gray(`  · ${queue.length} queued`) : '';
    w(`\r\x1b[2K${cyan(f)} ${dim(clip(this.text, (process.stdout.columns || 80) - 20))}${q}`);
  },
  stop() {
    if (ui.tui) { this.on = false; req(); return; }
    if (this.t) { clearInterval(this.t); this.t = null; w('\r\x1b[2K\x1b[?25h'); }
  },
};
