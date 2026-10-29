// The prompt editor: multi-line input, history, slash-command suggestions, scrolling.
import { accent, gray, strWidth } from './ansi.ts';
import { ui, req, note } from './screen.ts';
import { M } from './modal.ts';
import { isPrintable, type Key } from './keys.ts';
import { resetFrame } from './render.ts';
import { agent } from '../agent/state.ts';
import { COMMANDS } from '../commands.ts';

export const queue: string[] = [];   // messages typed while the agent works
export const hist: string[] = [];

export const editor = {
  chars: [] as string[], pos: 0, hi: -1, draft: [] as string[], sel: 0,
  pasting: false, lastKey: 0, lastCtrlC: 0,
  resolve: null as ((v: string | null) => void) | null,

  read(): Promise<string | null> {
    this.hi = -1;
    return new Promise((res) => { this.resolve = res; req(); });
  },
  text() { return this.chars.join(''); },
  set(t: string) { this.chars = Array.from(t); this.pos = this.chars.length; },
  clear() { this.chars = []; this.pos = 0; this.sel = 0; this.hi = -1; },
  insert(t: string) {
    const cs = Array.from(t.replace(/\r\n?/g, '\n').replace(/\t/g, '  '));
    this.chars.splice(this.pos, 0, ...cs); this.pos += cs.length; this.sel = 0;
  },
  quit() { const r = this.resolve; this.resolve = null; r?.(null); },
  submit(t = this.text()) {
    if (!t.trim()) return;
    this.clear();
    if (agent.ctrl || !this.resolve) { queue.push(t); req(); return; }
    const r = this.resolve; this.resolve = null; r(t); req();
  },

  key(s: string | undefined, k: Key) {
    const now = Date.now(); const fast = now - this.lastKey < 8; this.lastKey = now;
    const n = k.name; const busy = !!agent.ctrl;
    if (n === 'paste-start') { this.pasting = true; return; }
    if (n === 'paste-end') { this.pasting = false; return req(); }
    if (this.pasting) { if (n === 'return' || n === 'enter') this.insert('\n'); else if (s) this.insert(s); return; }
    if (k.ctrl && n === 'c') {
      if (busy) { agent.ctrl!.abort(); return; }
      if (this.chars.length) { this.clear(); return req(); }
      if (now - this.lastCtrlC < 1500) return this.quit();
      this.lastCtrlC = now; return note('press Ctrl+C again to exit', 1500);
    }
    if (k.ctrl && n === 'd' && !this.chars.length && !busy) return this.quit();
    if (k.ctrl && n === 'l') { resetFrame(); return req(); }
    if (k.ctrl && n === 'o') { ui.thoughts = !ui.thoughts; for (const r of log) if (r.kind === 'think') r.wr = undefined; return note(ui.thoughts ? 'reasoning expanded · ctrl+o to collapse' : 'reasoning collapsed', 1500); }
    if (n === 'pageup' || n === 'pagedown' || (k.shift && (n === 'up' || n === 'down'))) {
      const step = n === 'pageup' || n === 'pagedown' ? Math.max(1, (process.stdout.rows || 24) - 8) : 3;
      ui.scroll = Math.max(0, ui.scroll + (n === 'pageup' || n === 'up' ? step : -step));
      return req();
    }
    const sug = suggestions();
    if (sug.length) {
      this.sel = Math.min(this.sel, sug.length - 1);
      if (n === 'up') { this.sel = (this.sel - 1 + sug.length) % sug.length; return req(); }
      if (n === 'down') { this.sel = (this.sel + 1) % sug.length; return req(); }
      if (n === 'tab') { this.set(sug[this.sel][0] + ' '); this.sel = 0; return req(); }
      if (n === 'return' && !k.meta && !fast) return this.submit(sug[this.sel][0]);
    }
    if (n === 'escape') { if (busy) agent.ctrl!.abort(); else this.clear(); return req(); }
    if (n === 'return' && !k.meta && !k.ctrl && !fast) {
      if (this.chars[this.pos - 1] === '\\') { this.chars.splice(this.pos - 1, 1, '\n'); return req(); }
      return this.submit();
    }
    if (n === 'return' || n === 'enter') this.insert('\n');
    else if (n === 'backspace') { if (this.pos > 0) this.chars.splice(--this.pos, 1); this.sel = 0; }
    else if (n === 'delete') this.chars.splice(this.pos, 1);
    else if (n === 'left') this.pos = Math.max(0, this.pos - 1);
    else if (n === 'right') this.pos = Math.min(this.chars.length, this.pos + 1);
    else if (n === 'home' || (k.ctrl && n === 'a')) this.pos = this.lineStart();
    else if (n === 'end' || (k.ctrl && n === 'e')) this.pos = this.lineEnd();
    else if (k.ctrl && n === 'u') { const st = this.lineStart(); this.chars.splice(st, this.pos - st); this.pos = st; }
    else if (k.ctrl && n === 'k') this.chars.splice(this.pos, this.lineEnd() - this.pos);
    else if ((k.ctrl && n === 'w') || (k.meta && n === 'backspace')) {
      let st = this.pos;
      while (st > 0 && this.chars[st - 1] === ' ') st--;
      while (st > 0 && !/\s/.test(this.chars[st - 1])) st--;
      this.chars.splice(st, this.pos - st); this.pos = st;
    }
    else if (n === 'up' || n === 'down') this.vertical(n === 'up' ? -1 : 1);
    else if (isPrintable(s, k)) this.insert(s!);
    else return;
    req();
  },
  lineStart() { let i = this.pos; while (i > 0 && this.chars[i - 1] !== '\n') i--; return i; },
  lineEnd() { let i = this.pos; while (i < this.chars.length && this.chars[i] !== '\n') i++; return i; },
  vertical(d: number) {
    const st = this.lineStart(), col = this.pos - st;
    if (d < 0 && st > 0) { let ps = st - 1; while (ps > 0 && this.chars[ps - 1] !== '\n') ps--; this.pos = Math.min(ps + col, st - 1); return; }
    const en = this.lineEnd();
    if (d > 0 && en < this.chars.length) {
      let ne = en + 1; while (ne < this.chars.length && this.chars[ne] !== '\n') ne++;
      this.pos = Math.min(en + 1 + col, ne); return;
    }
    if (!hist.length) return;
    if (this.hi === -1) { if (d > 0) return; this.draft = [...this.chars]; this.hi = hist.length; }
    this.hi = Math.max(0, Math.min(hist.length, this.hi + d));
    if (this.hi === hist.length) { this.chars = [...this.draft]; this.pos = this.chars.length; this.hi = -1; }
    else this.set(hist[this.hi]);
  },
};

// slash commands matching what is typed: prefix matches first, then substring / description
export function suggestions(): [string, string][] {
  if (M.modal) return [];
  const t = editor.text();
  if (!t.startsWith('/') || /\s/.test(t)) return [];
  const q = t.slice(1).toLowerCase();
  const pre = COMMANDS.filter(([c]) => c.slice(1).startsWith(q));
  const more = q ? COMMANDS.filter(([c, d]) => !c.slice(1).startsWith(q) && (c.includes(q) || d.toLowerCase().includes(q))) : [];
  return [...pre, ...more];
}

// editor contents laid out for a box `tw` columns wide; cursor is [row, col]
export function inputView(tw: number): { rows: string[]; cur: [number, number] } {
  const busy = !!agent.ctrl;
  const prompt = busy ? gray('› ') : accent('› ');
  if (!editor.chars.length) return { rows: [prompt + gray(busy ? 'type to queue a message…' : 'Ask anything · / for commands · ! for shell')], cur: [0, 2] };
  const cw = Math.max(4, tw - 2);
  const segs: { s: string[]; start: number }[] = [];
  let seg = { s: [] as string[], start: 0 }, n = 0;
  editor.chars.forEach((ch, i) => {
    if (ch === '\n') { segs.push(seg); seg = { s: [], start: i + 1 }; n = 0; return; }
    const w = strWidth(ch);
    if (n + w > cw) { segs.push(seg); seg = { s: [], start: i }; n = 0; }
    seg.s.push(ch); n += w;
  });
  segs.push(seg);
  let cr = 0;
  segs.forEach((sg, i) => { if (sg.start <= editor.pos) cr = i; });
  const cc = strWidth(segs[cr].s.slice(0, editor.pos - segs[cr].start).join(''));
  const MAX = 8, top = cr >= MAX ? cr - MAX + 1 : 0;
  const rows = segs.slice(top, top + MAX).map((sg, i) => (top + i === 0 ? prompt : '  ') + sg.s.join(''));
  return { rows, cur: [cr - top, 2 + cc] };
}

export function onKey(s: string | undefined, k: Key) {
  if (M.modal) return M.modal.key(s, k);
  editor.key(s, k);
}
