// Conversations are saved per working directory in ~/.fa/sessions, so `fa -c` or /resume
// can pick one up again. Files older than 30 days are removed.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { CFG_DIR } from './config.ts';
import { ROOT } from './env.ts';
import { conv, type Msg } from './agent/state.ts';
import { accent, gray } from './ui/ansi.ts';
import { line, gap } from './ui/screen.ts';
import { describe } from './tools/index.ts';

const DIR = path.join(CFG_DIR, 'sessions');
const TAG = crypto.createHash('sha256').update(ROOT).digest('hex').slice(0, 10);
export const sess = { id: '' };

interface Saved { root: string; title: string; updated: number; history: Msg[] }

export function newSession() { sess.id = `${Date.now()}-${TAG}`; }

export function saveSession() {
  if (!conv.history.length) return;
  if (!sess.id) newSession();
  const first = conv.history.find((m) => m.role === 'user')?.text || '';
  const s: Saved = { root: ROOT, title: first.replace(/\s+/g, ' ').trim().slice(0, 80), updated: Date.now(), history: conv.history };
  try {
    fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(path.join(DIR, sess.id + '.json'), JSON.stringify(s), { mode: 0o600 });
  } catch {}
}

// sessions of this directory, newest first
export function listSessions(): { id: string; title: string; updated: number; turns: number }[] {
  let names: string[] = [];
  try { names = fs.readdirSync(DIR); } catch { return []; }
  const out = [];
  for (const n of names) {
    const f = path.join(DIR, n);
    try {
      if (Date.now() - fs.statSync(f).mtimeMs > 30 * 86400_000) { fs.unlinkSync(f); continue; }
      if (!n.endsWith(`-${TAG}.json`)) continue;
      const s: Saved = JSON.parse(fs.readFileSync(f, 'utf8'));
      out.push({ id: n.slice(0, -5), title: s.title, updated: s.updated, turns: s.history.filter((m) => m.role === 'user').length });
    } catch {}
  }
  return out.sort((a, b) => b.updated - a.updated);
}

// load a session into the conversation and show what was said
export function loadSession(id: string, quiet = false): boolean {
  let s: Saved;
  try { s = JSON.parse(fs.readFileSync(path.join(DIR, id + '.json'), 'utf8')); } catch { return false; }
  conv.history = s.history; sess.id = id;
  if (quiet) return true;
  for (const m of s.history) {
    if (m.role === 'user') { if (m.text.startsWith('[')) continue; gap(); line(m.text.trim(), { mark: accent('› '), ind: 2, kind: 'user' }); }
    else if (m.role === 'assistant') {
      for (const c of m.calls) line(describe(c), { mark: gray('· '), ind: 2, kind: 'tool', clip: true });
      if (m.text.trim()) { gap(); line(m.text.trim(), { md: true, mark: accent('● '), ind: 2, kind: 'text' }); }
    }
  }
  gap(); line(gray(`resumed · ${s.history.filter((m) => m.role === 'user').length} messages`), { ind: 2 });
  return true;
}

export const ago = (t: number) => {
  const m = Math.round((Date.now() - t) / 60000);
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};
