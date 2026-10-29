// Modal dialogs drawn over the input box: list picker (single / multi), text prompt,
// confirmation and a loading spinner.
import { accent, gray, green, bold, pad, vw, wrapAnsi, strWidth, fit, shimmer } from './ansi.ts';
import { req, ui } from './screen.ts';
import { isPrintable, type Key } from './keys.ts';

export interface Modal {
  title: string;
  full?: boolean;   // take the whole screen (setup wizard, welcome)
  anim?: boolean;   // redraw on every animation tick
  render(w: number, h: number): { rows: string[]; cur?: [number, number] };
  key(s: string | undefined, k: Key): void;
}
export const M = { modal: null as Modal | null };

function openModal(m: Modal) { M.modal = m; req(); }
function closeModal() { M.modal = null; req(); }

function header(o: { step?: string; desc?: string }, W: number): string[] {
  const rows: string[] = [];
  if (o.step) rows.push(o.step, '');
  if (o.desc) { for (const l of o.desc.split('\n')) rows.push(...wrapAnsi(l, W)); rows.push(''); }
  return rows;
}

export interface Item { value: string; label: string; hint?: string; tag?: string }
export interface PickOpts {
  title: string; step?: string; desc?: string; query?: string; initial?: string;
  multi?: boolean; selected?: string[]; search?: boolean; full?: boolean;
}

// single: resolves the chosen value; multi: Enter (or Space/Tab) ticks the highlighted item and the
// "✓ Save" row on top resolves the ticked values; Esc → null
export function pick(o: PickOpts, raw: (Item | string)[]): Promise<any> {
  const items: Item[] = raw.map((x) => (typeof x === 'string' ? { value: x, label: x } : x));
  const chosen = new Set(o.selected || []);
  const SAVE: Item = { value: '\0save', label: '' };
  const search = o.search ?? items.length > 8;
  const labW = Math.min(46, Math.max(4, ...items.map((i) => vw(i.label) + (i.tag ? vw(i.tag) + 1 : 0))) + 6);
  let q = Array.from(o.query || ''), sel = 0, top = 0, h = 10;
  const filter = () => {
    const qs = q.join('').toLowerCase().trim();
    if (!qs) return items;
    const toks = qs.split(/\s+/);
    const hit = items.filter((it) => toks.every((t) => (it.label + ' ' + it.value).toLowerCase().includes(t)));
    if (hit.length) return hit;
    const flat = qs.replace(/\s+/g, '');
    return items.filter((it) => { let j = 0; for (const ch of it.value.toLowerCase()) if (ch === flat[j]) j++; return j === flat.length; });
  };
  const shown = () => (o.multi ? [SAVE, ...filter()] : filter());
  const refilter = () => { list = shown(); sel = o.multi && list.length > 1 ? 1 : 0; };
  let list = shown();
  if (o.initial) sel = Math.max(0, list.findIndex((i) => i.value === o.initial));
  if (o.multi && !sel && list.length > 1) sel = 1;
  return new Promise((resolve) => {
    const done = (v: any) => { closeModal(); resolve(v); };
    openModal({
      title: o.title, full: o.full,
      render(W, Hm) {
        const rows = header(o, W);
        if (search) rows.push(`${accent('⌕')} ${q.length ? q.join('') : gray('type to filter')}${accent('▏')}`, '');
        h = Math.max(3, Hm - rows.length - 2);
        if (sel < top) top = sel;
        if (sel >= top + h) top = sel - h + 1;
        list.slice(top, top + h).forEach((it, i) => {
          const on = top + i === sel;
          if (it === SAVE) return rows.push(`${on ? accent('❯') : ' '} ${green(bold('✓ Save'))} ${gray(`· ${chosen.size} selected`)}`);
          const box = o.multi ? (chosen.has(it.value) ? green('◉ ') : gray('○ ')) : '';
          const left = `${on ? accent('❯') : ' '} ${box}${on ? accent(bold(it.label)) : it.label}${it.tag ? ' ' + it.tag : ''}`;
          rows.push(it.hint ? pad(left, labW + 4) + gray(it.hint) : left);
        });
        const n = list.length - (o.multi ? 1 : 0);
        if (!n) rows.push(gray('  no matches'));
        rows.push('');
        const info: string[] = [];
        if (list.length > h || n < items.length) info.push(`${n}/${items.length}`);
        info.push('↑↓ move', o.multi ? 'enter tick · ctrl+a all · ✓ Save to finish' : 'enter select', 'esc back');
        rows.push(gray(info.join(' · ')));
        return { rows };
      },
      key(s, k) {
        const n = k.name;
        if (n === 'escape' || (k.ctrl && n === 'c')) return done(null);
        if (n === 'return') {
          if (!o.multi) return list[sel] ? done(list[sel].value) : undefined;
          if (list[sel] === SAVE) return done(items.filter((i) => chosen.has(i.value)).map((i) => i.value));
        }
        if (o.multi && (n === 'return' || s === ' ' || n === 'tab')) { const it = list[sel]; if (it && it !== SAVE) { if (chosen.has(it.value)) chosen.delete(it.value); else chosen.add(it.value); } }
        else if (o.multi && k.ctrl && n === 'a') { const its = list.filter((i) => i !== SAVE); const all = its.every((i) => chosen.has(i.value)); for (const i of its) all ? chosen.delete(i.value) : chosen.add(i.value); }
        else if (n === 'up') sel = sel > 0 ? sel - 1 : Math.max(0, list.length - 1);
        else if (n === 'down') sel = sel < list.length - 1 ? sel + 1 : 0;
        else if (n === 'pageup') sel = Math.max(0, sel - h);
        else if (n === 'pagedown') sel = Math.min(list.length - 1, sel + h);
        else if (n === 'home') sel = 0;
        else if (n === 'end') sel = Math.max(0, list.length - 1);
        else if (search && n === 'backspace') { q.pop(); refilter(); }
        else if (search && k.ctrl && n === 'u') { q = []; refilter(); }
        else if (search && isPrintable(s, k)) { q.push(...Array.from(s!.replace(/[\r\n]/g, ''))); refilter(); }
        else if (!search && s && /^[1-9]$/.test(s) && Number(s) <= list.length) sel = Number(s) - 1;
        req();
      },
    });
  });
}

export interface AskOpts { title: string; step?: string; desc?: string; mask?: boolean; placeholder?: string; initial?: string; allowEmpty?: boolean; full?: boolean }

// one-line text input; Esc → null
export function ask(o: AskOpts): Promise<string | null> {
  let v = Array.from(o.initial || ''), p = v.length, pasting = false;
  return new Promise((resolve) => {
    const done = (x: string | null) => { closeModal(); resolve(x); };
    openModal({
      title: o.title, full: o.full,
      render(W) {
        const rows = header(o, W);
        const shown = o.mask ? v.map(() => '•') : v;
        const cw = W - 3;
        let start = 0;
        while (start < p && strWidth(shown.slice(start, p).join('')) > cw) start++;
        rows.push(`${accent('›')} ${v.length ? fit(shown.slice(start).join(''), cw + 1) : gray(o.placeholder || '')}`);
        const cur: [number, number] = [rows.length - 1, 2 + strWidth(shown.slice(start, p).join(''))];
        rows.push('', gray(`enter confirm${o.allowEmpty ? ' (empty = none)' : ''} · esc back`));
        return { rows, cur };
      },
      key(s, k) {
        const n = k.name;
        if (n === 'paste-start') { pasting = true; return; }
        if (n === 'paste-end') { pasting = false; return req(); }
        if (n === 'escape' || (k.ctrl && n === 'c')) return done(null);
        if (n === 'return' && !pasting) { const t = v.join('').trim(); if (t || o.allowEmpty) done(t); return; }
        if (n === 'backspace') { if (p > 0) v.splice(--p, 1); }
        else if (n === 'delete') v.splice(p, 1);
        else if (n === 'left') p = Math.max(0, p - 1);
        else if (n === 'right') p = Math.min(v.length, p + 1);
        else if (n === 'home' || (k.ctrl && n === 'a')) p = 0;
        else if (n === 'end' || (k.ctrl && n === 'e')) p = v.length;
        else if (k.ctrl && n === 'u') { v = []; p = 0; }
        else if (isPrintable(s, k)) { const cs = Array.from(s!.replace(/[\r\n]/g, '')); v.splice(p, 0, ...cs); p += cs.length; }
        req();
      },
    });
  });
}

export async function confirm(q: string, yes = 'Yes', no = 'No'): Promise<boolean> {
  if (!ui.tui) return false;
  return (await pick({ title: 'Confirm', desc: q, search: false }, [{ value: 'y', label: yes }, { value: 'n', label: no }])) === 'y';
}

// spinner modal while a promise runs
export async function loading<T>(title: string, text: string, p: Promise<T>): Promise<T> {
  if (!ui.tui) return p;
  const FR = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  openModal({
    title, anim: true,
    render: () => ({ rows: ['', `${accent(FR[ui.tick % FR.length])} ${shimmer(text, ui.tick)}`, ''] }),
    key: () => {},
  });
  try { return await p; } finally { closeModal(); }
}
