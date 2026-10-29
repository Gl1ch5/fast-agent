// Full-screen frame: transcript, live status/cards, input box (or a modal),
// command suggestions and the footer. Only changed rows are rewritten.
import { w } from '../env.ts';
import { accent, bold, code, gray, italic, yellow, fit, pad, vw, wrapAnsi, boxed, shimmer, border, borderHi } from './ansi.ts';
import { log, ui, spin } from './screen.ts';
import { M } from './modal.ts';
import { editor, queue, suggestions, inputView } from './input.ts';
import { cards, cardRows } from './cards.ts';
import { agent } from '../agent/state.ts';
import { cfg, modelLabel } from '../config.ts';
import { VERSION } from '../version.ts';
import { cmpVer, kt } from '../util.ts';

// light inline markdown for assistant text
function mdLine(s: string, fence: boolean): string {
  if (/^\s*```/.test(s)) return gray(s);
  if (fence) return code(s);
  const h = /^(#{1,6})\s+(.*)$/.exec(s);
  if (h) return bold(accent(h[2]));
  if (/^\s*([-*_]\s*){3,}$/.test(s)) return gray('─'.repeat(24));
  return s
    .replace(/^(\s*)[-*+] /, (_, sp) => sp + accent('•') + ' ')
    .replace(/^(\s*)> ?/, (_, sp) => sp + gray('│ '))
    .replace(/`([^`]+)`/g, (_, x) => code(x))
    .replace(/\*\*([^*]+)\*\*/g, (_, x) => bold(x));
}

export function wrapLog(W: number): string[] {
  const all: string[] = [];
  let fence = false;
  for (const r of log) {
    const inFence = !!r.md && fence;
    if (!r.wr || r.ww !== W || r.wf !== inFence) {
      const ind = r.ind || 0;
      const body = r.md ? mdLine(r.s, inFence) : r.s;
      const lines = r.clip ? [fit(body, W - ind)] : wrapAnsi(body, W - ind);
      r.wr = lines.map((l, i) => (i === 0 ? (r.mark ?? ' '.repeat(ind)) : ' '.repeat(ind)) + l);
      r.ww = W; r.wf = inFence;
    }
    if (r.md && /^\s*```/.test(r.s)) fence = !fence;
    for (const l of r.wr) all.push(l);
  }
  return all;
}

const STAR = ['·', '✢', '✳', '✶', '✻', '✽', '✻', '✶', '✳', '✢'];

function liveRows(W: number): string[] {
  const busy = !!agent.ctrl;
  if (!busy && !spin.on && !cards.length) return [];
  const rows: string[] = [''];
  for (const c of cards) rows.push(...cardRows(c, W));
  if (busy || spin.on) {
    let st = `${accent(STAR[ui.tick % STAR.length])} ${shimmer((spin.text || 'Working') + '…', ui.tick)}`;
    if (busy) {
      const secs = Math.floor((Date.now() - agent.t0) / 1000);
      st += gray(` (${secs}s · ↓ ${kt(Math.round(agent.chars / 4))} tokens · esc to interrupt)`);
    }
    rows.push(fit(st, W));
    if (agent.thinking) {
      const last = agent.thinkBuf.trim().split('\n').pop() || '';
      if (last) rows.push(fit(gray(italic('  ' + last)), W));
    }
  }
  return rows;
}

function sugRows(sug: [string, string][], W: number): string[] {
  const n = 8, sel = Math.min(editor.sel, sug.length - 1);
  const start = Math.max(0, Math.min(sel - n + 1, sug.length - n));
  return sug.slice(start, start + n).map(([c, d], i) => {
    const on = start + i === sel;
    return fit(`  ${on ? accent('❯') : ' '} ${pad(on ? accent(bold(c)) : c, 12)} ${on ? d : gray(d)}`, W);
  });
}

function footer(W: number): string {
  let left: string;
  if (ui.note && Date.now() < ui.noteUntil) left = yellow(ui.note);
  else if (ui.scroll > 0) left = accent(`↑ ${ui.scroll} lines up · PgDn to return`);
  else if (agent.ctrl) left = gray('esc interrupt · enter queues a message');
  else left = gray('/ commands · ↑↓ history · wheel/PgUp scroll');
  const upd = cfg.latest && cmpVer(cfg.latest, VERSION) > 0 ? yellow(`↑ ${cfg.latest} · /update`) + gray(' · ') : '';
  const right = upd + gray(`${modelLabel()} · ${cfg.effort}${cfg.fast ? ' · fast' : ''}${cfg.safe ? ' · safe' : ''}`);
  const sp = W - 1 - vw(left) - vw(right);
  return sp >= 2 ? ' ' + left + ' '.repeat(sp) + right : ' ' + fit(left, W - 1);
}

let prev: string[] = [];
let lastTotal = 0;

export function resetFrame() { prev = []; w('\x1b[2J'); }

export function render() {
  if (!ui.tui) return;
  const H = Math.max(8, process.stdout.rows || 24);
  const W = Math.max(24, (process.stdout.columns || 80) - 1);   // never touch the last column
  const bottom: string[] = [];
  let cur: [number, number] | null = null;
  const m = M.modal;
  if (m) {
    const maxBody = H - 3 - (m.full ? 0 : 4);
    const r = m.render(W - 4, maxBody);
    const body = r.rows.slice(0, maxBody);
    if (m.full) while (body.length < maxBody) body.push('');
    bottom.push(...boxed(body, W, m.title, borderHi));
    if (r.cur) cur = [r.cur[0] + 1, r.cur[1] + 2];
  } else {
    bottom.push(...liveRows(W).slice(-Math.max(3, Math.floor(H / 2))));
    for (const q of queue) bottom.push(fit(gray(`  ⏎ ${q.replace(/\n/g, ' ')}`), W));
    const iv = inputView(W - 4);
    cur = [bottom.length + 1 + iv.cur[0], 2 + iv.cur[1]];
    bottom.push(...boxed(iv.rows, W, '', agent.ctrl ? border : borderHi));
    const sug = suggestions();
    if (sug.length) bottom.push(...sugRows(sug, W));
  }
  const vh = Math.max(0, H - 1 - bottom.length);
  const all = m?.full ? [] : wrapLog(W);
  if (ui.scroll > 0 && all.length > lastTotal) ui.scroll += all.length - lastTotal;
  lastTotal = all.length;
  ui.scroll = Math.max(0, Math.min(ui.scroll, all.length - vh));
  const end = all.length - ui.scroll;
  const view = all.slice(Math.max(0, end - vh), end);
  // transcript on top, input area pinned to the bottom
  const frame = [...view];
  while (frame.length < H - 1 - bottom.length) frame.push('');
  const top = frame.length;
  frame.push(...bottom, footer(W));
  let o = '\x1b[?2026h\x1b[?25l';
  frame.slice(0, H).forEach((r, i) => { if (prev[i] !== r) o += `\x1b[${i + 1};1H\x1b[2K${r}\x1b[0m`; });
  prev = frame;
  if (cur) o += `\x1b[${top + cur[0] + 1};${cur[1] + 1}H\x1b[?25h`;
  w(o + '\x1b[?2026l');
}
