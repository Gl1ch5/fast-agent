// Small helpers with no UI or state.
import os from 'node:os';
import path from 'node:path';

export const kb = (n: number) => (n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`);
export const kt = (n: number) => (n < 1000 ? `${n}` : `${(n / 1000).toFixed(1)}k`);

export const sleep = (ms: number, sig?: AbortSignal) => new Promise<void>((res) => {
  const t = setTimeout(res, ms); sig?.addEventListener('abort', () => { clearTimeout(t); res(); }, { once: true });
});

// semver-ish compare: >0 when a is newer than b
export function cmpVer(a: string, b: string) {
  const x = a.split('.').map(Number), y = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0);
  return 0;
}

export function tildify(p: string) {
  const home = os.homedir();
  return (p.startsWith(home) ? '~' + p.slice(home.length) : p).split(path.sep).join('/');
}
