import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { IS_WIN, ROOT } from '../env.ts';
import { gray, red } from '../ui/ansi.ts';
import { feedCard, type Card } from '../ui/cards.ts';
import type { Result } from './types.ts';

export const SHELL = process.env.FA_SHELL || (IS_WIN ? 'powershell' : fs.existsSync('/bin/bash') ? 'bash' : 'sh');
const MAX_OUT = 30_000;

export function toolShell(a: any, sig: AbortSignal, card?: Card): Promise<Result> {
  const cmd = String(a.command ?? '');
  if (!cmd.trim()) throw new Error('command is required');
  const timeout = Math.min(Math.max(Number(a.timeout) || 120, 1), 3600);
  const isPS = /powershell|pwsh/i.test(SHELL);
  const args = isPS
    ? ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command',
      `[Console]::OutputEncoding=[Text.Encoding]::UTF8;$OutputEncoding=[Text.Encoding]::UTF8;$ProgressPreference='SilentlyContinue';${cmd}`]
    : IS_WIN && /cmd(\.exe)?$/i.test(SHELL) ? ['/d', '/s', '/c', cmd] : ['-c', cmd];
  return new Promise((resolve) => {
    const child = spawn(isPS && SHELL === 'powershell' ? 'powershell.exe' : SHELL, args, {
      cwd: ROOT, detached: !IS_WIN, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, FA: '1', NO_COLOR: '1', GIT_TERMINAL_PROMPT: '0', GIT_PAGER: 'cat', PAGER: 'cat' },
    });
    const chunks: Buffer[] = []; let size = 0, timedOut = false;
    const add = (d: Buffer) => {
      chunks.push(d); size += d.length;
      while (size > MAX_OUT * 4 && chunks.length > 1) size -= chunks.shift()!.length;
      if (card) feedCard(card, d.toString('utf8'));
    };
    child.stdout!.on('data', add); child.stderr!.on('data', add);
    const kill = () => {
      try { if (IS_WIN) spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }); else process.kill(-child.pid!, 'SIGKILL'); }
      catch { try { child.kill('SIGKILL'); } catch {} }
    };
    const timer = setTimeout(() => { timedOut = true; kill(); }, timeout * 1000);
    sig.addEventListener('abort', kill, { once: true });
    const done = (code: number | null, extra = '') => {
      clearTimeout(timer); sig.removeEventListener('abort', kill);
      let o = Buffer.concat(chunks).toString('utf8').replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').trimEnd();
      if (o.length > MAX_OUT) o = `… [${o.length - MAX_OUT} chars cut]\n` + o.slice(-MAX_OUT);
      const status = timedOut ? `killed after ${timeout}s timeout` : sig.aborted ? 'interrupted' : `exit ${code}`;
      const tail = o.split('\n').map((l) => l.split('\r').filter((x) => x.trim()).pop() ?? '').join('\n');
      resolve({ text: `${status}${extra}\n${o}`, err: code !== 0, show: code === 0 ? (o ? '' : gray('no output')) : red(status + extra), tail });
    };
    child.on('error', (e) => done(-1, `: ${e.message}`));
    child.on('close', (code) => done(code));
  });
}
