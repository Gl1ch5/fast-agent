// Entering / leaving the full-screen mode (alternate screen, raw keys, animation clock).
import readline from 'node:readline';
import { w } from '../env.ts';
import { ui, spin } from './screen.ts';
import { render, resetFrame, wrapLog } from './render.ts';
import { onKey } from './input.ts';
import { M } from './modal.ts';
import { cards } from './cards.ts';
import { agent } from '../agent/state.ts';

export function startTui() {
  ui.tui = true;
  readline.emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdin.on('keypress', (s, k) => onKey(s, k || {}));
  w('\x1b[?1049h\x1b[?2004h');
  resetFrame();
  process.stdout.on('resize', () => { resetFrame(); render(); });
  setInterval(() => {
    ui.tick++;
    if (M.modal?.anim || agent.ctrl || spin.on || cards.length || ui.note) render();
  }, 80);
  process.on('exit', () => leaveTui());
  render();
}

// back to the normal screen; the transcript is printed so it stays in scrollback
export function leaveTui(dump = true) {
  if (!ui.tui) return;
  const W = Math.max(24, (process.stdout.columns || 80) - 1);
  const rows = dump ? wrapLog(W) : [];
  ui.tui = false;
  w('\x1b[?2004l\x1b[?25h\x1b[?1049l');
  try { process.stdin.setRawMode(false); } catch {}
  if (rows.length) w(rows.slice(-500).join('\x1b[0m\n') + '\x1b[0m\n');
}
