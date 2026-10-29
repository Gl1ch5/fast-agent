// Every file tool is locked inside ROOT; changed files are snapshotted for /undo.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../env.ts';

export function safePath(p: string): string {
  if (typeof p !== 'string' || !p) throw new Error('path is required');
  const abs = path.resolve(ROOT, p);
  let real = abs, probe = abs;
  while (!fs.existsSync(probe)) { const up = path.dirname(probe); if (up === probe) break; probe = up; }
  try { real = path.join(fs.realpathSync(probe), path.relative(probe, abs)); } catch {}
  const rel = path.relative(ROOT, real);
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error(`access denied: ${p} is outside the working directory`);
  return abs;
}
export const relp = (abs: string) => path.relative(ROOT, abs).split(path.sep).join('/') || '.';

// one map per request: file → content before the request (null = did not exist)
export const undoStack: Map<string, Buffer | null>[] = [];
export function snapshot(abs: string) {
  const top = undoStack[undoStack.length - 1];
  if (top && !top.has(abs)) top.set(abs, fs.existsSync(abs) ? fs.readFileSync(abs) : null);
}
