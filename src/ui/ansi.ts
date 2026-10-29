// Colors, gradients and ANSI-aware width / clip / wrap helpers.
import { IS_WIN, TTY } from '../env.ts';

const sty = (n: string) => (s: string) => (TTY ? `\x1b[${n}m${s}\x1b[0m` : s);
export const dim = sty('2'), bold = sty('1'), italic = sty('3');
export const cyan = sty('36'), gray = sty('90'), magenta = sty('35');

// ─── true color (falls back to the 256-color cube) ───
export type RGB = [number, number, number];
const TRUECOLOR = IS_WIN || /truecolor|24bit/i.test(process.env.COLORTERM || '') || !!process.env.WT_SESSION ||
  /iTerm|vscode|WezTerm|ghostty|kitty|Hyper/i.test(process.env.TERM_PROGRAM || '');
export const fgc = ([r, g, b]: RGB) => (TRUECOLOR
  ? `\x1b[38;2;${r};${g};${b}m`
  : `\x1b[38;5;${16 + 36 * Math.round(r / 51) + 6 * Math.round(g / 51) + Math.round(b / 51)}m`);
export const rgb = (c: RGB) => (s: string) => (TTY ? fgc(c) + s + '\x1b[39m' : s);

// graphite palette: neutral grays, near-white highlight, muted status colors
export const SHADE: RGB = [96, 98, 104], LIGHT: RGB = [232, 233, 236];
export const accent = rgb([228, 229, 232]), accent2 = rgb([150, 153, 160]), code = rgb([196, 186, 168]);
export const border = rgb([78, 80, 86]), borderHi = rgb([128, 131, 138]);
export const red = rgb([224, 108, 108]), green = rgb([128, 190, 136]), yellow = rgb([214, 184, 112]);

export const lerp = (a: RGB, b: RGB, t: number): RGB =>
  [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * t)) as RGB;

// moving two-color gradient across a string
export function gradient(s: string, phase = 0, a = SHADE, b = LIGHT) {
  if (!TTY) return s;
  const cs = Array.from(s);
  return cs.map((ch, i) => fgc(lerp(a, b, (Math.sin((i / Math.max(10, cs.length)) * Math.PI * 2 - phase) + 1) / 2)) + ch).join('') + '\x1b[39m';
}

// a bright spot sliding over dim text (the "working…" effect)
export function shimmer(s: string, t: number, base: RGB = [125, 125, 140], hi: RGB = [240, 240, 255]) {
  if (!TTY) return s;
  const cs = Array.from(s); const pos = (t % (cs.length + 12)) - 6;
  return cs.map((ch, i) => fgc(lerp(base, hi, Math.max(0, 1 - Math.abs(i - pos) / 4))) + ch).join('') + '\x1b[39m';
}

// ─── width ───
const isWide = (cp: number) =>
  (cp >= 0x1100 && cp <= 0x115f) || (cp >= 0x2e80 && cp <= 0xa4cf) || (cp >= 0xac00 && cp <= 0xd7a3) ||
  (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0xfe30 && cp <= 0xfe4f) || (cp >= 0xff00 && cp <= 0xff60) ||
  (cp >= 0xffe0 && cp <= 0xffe6) || (cp >= 0x1f300 && cp <= 0x1faff) || (cp >= 0x20000 && cp <= 0x3fffd);
export function strWidth(s: string) {
  let n = 0;
  for (const ch of s) { const cp = ch.codePointAt(0)!; if (cp >= 32 && !(cp >= 0x300 && cp <= 0x36f)) n += isWide(cp) ? 2 : 1; }
  return n;
}
export function clip(s: string, max: number) {
  let n = 0, out = '';
  for (const ch of s) { const cw = strWidth(ch); if (n + cw > max) return out.slice(0, -1) + '…'; n += cw; out += ch; }
  return out;
}

export const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g;
export const strip = (s: string) => s.replace(ANSI, '');
export const vw = (s: string) => strWidth(strip(s));

// split into escape sequences (w = -1) and visible characters
function units(s: string): { t: string; w: number }[] {
  const u: { t: string; w: number }[] = [];
  let i = 0;
  while (i < s.length) {
    if (s[i] === '\x1b') {
      const m = /^\x1b\[[0-9;?]*[A-Za-z]/.exec(s.slice(i, i + 32));
      if (m) { u.push({ t: m[0], w: -1 }); i += m[0].length; continue; }
    }
    const ch = String.fromCodePoint(s.codePointAt(i)!);
    u.push({ t: ch, w: strWidth(ch) }); i += ch.length;
  }
  return u;
}

// clip a styled string to `max` columns
export function fit(s: string, max: number) {
  if (vw(s) <= max) return s;
  let o = '', n = 0;
  for (const u of units(s)) {
    if (u.w < 0) { o += u.t; continue; }
    if (n + u.w > max - 1) break;
    o += u.t; n += u.w;
  }
  return o + '…\x1b[0m';
}
export const pad = (s: string, n: number) => { const f = fit(s, n); return f + ' '.repeat(Math.max(0, n - vw(f))); };
export const center = (s: string, n: number) => ' '.repeat(Math.max(0, Math.floor((n - vw(s)) / 2))) + s;

// word-wrap a styled string; styles carry over to the next line
export function wrapAnsi(s: string, width: number): string[] {
  width = Math.max(4, width);
  if (vw(s) <= width) return [s];
  const lines: string[] = [];
  let cur = '', n = 0, sgr = '', sp = -1, spN = 0, spSgr = '';
  for (const u of units(s)) {
    if (u.w < 0) { cur += u.t; if (u.t.endsWith('m')) sgr = /^\x1b\[0?m$/.test(u.t) ? '' : sgr + u.t; continue; }
    if (n + u.w > width) {
      if (sp > 0 && spN > width * 0.3) { lines.push(cur.slice(0, sp) + '\x1b[0m'); cur = spSgr + cur.slice(sp); n -= spN; }
      else { lines.push(cur + '\x1b[0m'); cur = sgr; n = 0; }
      sp = -1;
      if (u.t === ' ' && n === 0) continue;
    }
    cur += u.t; n += u.w;
    if (u.t === ' ') { sp = cur.length; spN = n; spSgr = sgr; }
  }
  if (cur) lines.push(cur);
  return lines;
}

// rounded box, `W` columns wide in total
export function boxed(rows: string[], W: number, title = '', col: (s: string) => string = gray) {
  const inner = W - 4; const t = title ? ` ${title} ` : '';
  const out = [col('╭─') + (t ? bold(t) : '') + col('─'.repeat(Math.max(0, W - 3 - vw(t))) + '╮')];
  for (const r of rows) out.push(col('│') + ' ' + pad(r, inner) + ' ' + col('│'));
  out.push(col('╰' + '─'.repeat(W - 2) + '╯'));
  return out;
}
