// Entering / leaving the full-screen mode (alternate screen, raw keys, animation clock).
import readline from 'node:readline';
import { PassThrough } from 'node:stream';
import { w } from '../env.ts';
import { ui, spin, req } from './screen.ts';
import { render, resetFrame, wrapLog } from './render.ts';
import { onKey } from './input.ts';
import { M } from './modal.ts';
import { cards } from './cards.ts';
import { agent } from '../agent/state.ts';

export function startTui() {
  ui.tui = true;
  // mouse reports are cut out of stdin before readline parses the keys,
  // so the wheel scrolls the transcript instead of arriving as ↑↓ (history)
  const keys = new PassThrough();
  readline.emitKeypressEvents(keys);
  keys.on('keypress', (s, k) => onKey(s, k || {}));
  process.stdin.setRawMode(true);
  process.stdin.on('data', (d: Buffer) => {
    const rest = d.toString('utf8').replace(/\x1b\[<(\d+);\d+;\d+[Mm]/g, (_, b) => { wheel(Number(b)); return ''; });
    if (rest) keys.write(rest);
  });
  w('\x1b[?1049h\x1b[?2004h\x1b[?1000h\x1b[?1006h');
  resetFrame();
  process.stdout.on('resize', () => { resetFrame(); render(); });
  setInterval(() => {
    ui.tick++;
    if (M.modal?.anim || agent.ctrl || spin.on || cards.length || ui.note) render();
  }, 80);
  process.on('exit', () => leaveTui());
  render();
}

function wheel(b: number) {
  if (b !== 64 && b !== 65) return;   // only the wheel; clicks are ignored
  if (M.modal) return onKey(undefined, { name: b === 64 ? 'up' : 'down' });
  ui.scroll = Math.max(0, ui.scroll + (b === 64 ? 3 : -3));
  req();
}

// back to the normal screen; the transcript is printed so it stays in scrollback
export function leaveTui(dump = true) {
  if (!ui.tui) return;
  const W = Math.max(24, (process.stdout.columns || 80) - 1);
  const rows = dump ? wrapLog(W) : [];
  ui.tui = false;
  w('\x1b[?1000l\x1b[?1006l\x1b[?2004l\x1b[?25h\x1b[?1049l');
  try { process.stdin.setRawMode(false); } catch {}
  if (rows.length) w(rows.slice(-500).join('\x1b[0m\n') + '\x1b[0m\n');
}
