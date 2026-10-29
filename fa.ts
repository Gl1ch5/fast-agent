#!/usr/bin/env node
// fa — fast agent. One file, zero dependencies. Node >= 22.18 (or Bun).
// Run: node fa.ts            Docs: README.md
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';

const VERSION = '0.1.0';
const IS_WIN = process.platform === 'win32';
const TTY = !!process.stdout.isTTY;

// ─── colors ──────────────────────────────────────────────────────────────────
const sty = (n: string) => (s: string) => (TTY ? `\x1b[${n}m${s}\x1b[0m` : s);
const dim = sty('2'), bold = sty('1'), red = sty('31'), green = sty('32'), yellow = sty('33');
const cyan = sty('36'), gray = sty('90'), magenta = sty('35');
const w = (s: string) => process.stdout.write(s);

// ─── args ────────────────────────────────────────────────────────────────────
const HELP = `fa ${VERSION} — fast one-file coding agent

usage: fa [options] [prompt]
  -p, --print          run the prompt non-interactively and exit
  -m, --model P/M      provider/model, e.g. anthropic/claude-opus-5-5
  -e, --effort LVL     auto | low | medium | high | xhigh | max
  -C, --cwd DIR        working directory (the agent is locked inside it)
      --safe           ask before every shell command
  -h, --help           this help

in the prompt: /help for commands, Esc stops the agent, Ctrl+J or "\\" + Enter = new line`;

const opt = { print: false, model: '', cwd: '', effort: '', safe: false };
const rest: string[] = [];
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a === '-p' || a === '--print') opt.print = true;
  else if (a === '-m' || a === '--model') opt.model = process.argv[++i] ?? '';
  else if (a === '-e' || a === '--effort') opt.effort = process.argv[++i] ?? '';
  else if (a === '-C' || a === '--cwd') opt.cwd = process.argv[++i] ?? '';
  else if (a === '--safe') opt.safe = true;
  else if (a === '-h' || a === '--help') { console.log(HELP); process.exit(0); }
  else if (a === '-v' || a === '--version') { console.log(VERSION); process.exit(0); }
  else rest.push(a);
}

const ROOT = fs.realpathSync(path.resolve(opt.cwd || process.cwd()));
process.chdir(ROOT);

// ─── config & providers ──────────────────────────────────────────────────────
type PType = 'openai' | 'anthropic';
interface Prov { type: PType; url: string; key?: string; env?: string; headers?: Record<string, string> }
interface Cfg {
  provider: string; model: string; effort: string; fast: boolean; safe: boolean;
  maxTokens?: number; providers: Record<string, Partial<Prov>>; recent: string[];
}

const PRESETS: Record<string, Prov> = {
  anthropic: { type: 'anthropic', url: 'https://api.anthropic.com', env: 'ANTHROPIC_API_KEY' },
  openai: { type: 'openai', url: 'https://api.openai.com/v1', env: 'OPENAI_API_KEY' },
  openrouter: { type: 'openai', url: 'https://openrouter.ai/api/v1', env: 'OPENROUTER_API_KEY' },
  gemini: { type: 'openai', url: 'https://generativelanguage.googleapis.com/v1beta/openai', env: 'GEMINI_API_KEY' },
  groq: { type: 'openai', url: 'https://api.groq.com/openai/v1', env: 'GROQ_API_KEY' },
  cerebras: { type: 'openai', url: 'https://api.cerebras.ai/v1', env: 'CEREBRAS_API_KEY' },
  deepseek: { type: 'openai', url: 'https://api.deepseek.com/v1', env: 'DEEPSEEK_API_KEY' },
  xai: { type: 'openai', url: 'https://api.x.ai/v1', env: 'XAI_API_KEY' },
  mistral: { type: 'openai', url: 'https://api.mistral.ai/v1', env: 'MISTRAL_API_KEY' },
  ollama: { type: 'openai', url: 'http://localhost:11434/v1' },
  lmstudio: { type: 'openai', url: 'http://localhost:1234/v1' },
};
const DEFAULT_MODEL: Record<string, string> = { anthropic: 'claude-opus-5-5' };
const EFFORTS = ['auto', 'low', 'medium', 'high', 'xhigh', 'max'];

const CFG_DIR = process.env.FA_HOME || path.join(os.homedir(), '.fa');
const CFG_FILE = path.join(CFG_DIR, 'config.json');
const cfg: Cfg = { provider: '', model: '', effort: 'auto', fast: false, safe: false, providers: {}, recent: [] };
try { Object.assign(cfg, JSON.parse(fs.readFileSync(CFG_FILE, 'utf8'))); } catch {}
function saveCfg() {
  try {
    fs.mkdirSync(CFG_DIR, { recursive: true });
    fs.writeFileSync(CFG_FILE, JSON.stringify(cfg, null, 2), { mode: 0o600 });
  } catch (e: any) { console.log(red(`  can't save config: ${e.message}`)); }
}
function provs(): Record<string, Prov> {
  const out: Record<string, Prov> = {};
  for (const n of new Set([...Object.keys(PRESETS), ...Object.keys(cfg.providers)]))
    out[n] = { ...PRESETS[n], ...cfg.providers[n] } as Prov;
  return out;
}
const keyOf = (p: Prov) => p.key || (p.env ? process.env[p.env] : '') || '';
const isLocal = (p: Prov) => /\/\/(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(p.url || '');
const usable = (p: Prov) => !!p.url && (!!keyOf(p) || isLocal(p));

if (opt.model) {
  const i = opt.model.indexOf('/');
  if (i > 0 && provs()[opt.model.slice(0, i)]) { cfg.provider = opt.model.slice(0, i); cfg.model = opt.model.slice(i + 1); }
  else cfg.model = opt.model;
}
if (opt.effort) cfg.effort = opt.effort;
if (opt.safe) cfg.safe = true;
if (!cfg.provider || !provs()[cfg.provider]) {
  cfg.provider = Object.keys(provs()).find((n) => usable(provs()[n]) && !isLocal(provs()[n])) || '';
  cfg.model = DEFAULT_MODEL[cfg.provider] || '';
}
const cur = () => provs()[cfg.provider];
const modelLabel = () => (cfg.provider && cfg.model ? `${cfg.provider}/${cfg.model}` : '(no model — /model)');

// ─── text width / misc ───────────────────────────────────────────────────────
const isWide = (cp: number) =>
  (cp >= 0x1100 && cp <= 0x115f) || (cp >= 0x2e80 && cp <= 0xa4cf) || (cp >= 0xac00 && cp <= 0xd7a3) ||
  (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0xfe30 && cp <= 0xfe4f) || (cp >= 0xff00 && cp <= 0xff60) ||
  (cp >= 0xffe0 && cp <= 0xffe6) || (cp >= 0x1f300 && cp <= 0x1faff) || (cp >= 0x20000 && cp <= 0x3fffd);
function strWidth(s: string) {
  let n = 0;
  for (const ch of s) { const cp = ch.codePointAt(0)!; if (cp >= 32 && !(cp >= 0x300 && cp <= 0x36f)) n += isWide(cp) ? 2 : 1; }
  return n;
}
function clip(s: string, max: number) {
  let n = 0, out = '';
  for (const ch of s) { const cw = strWidth(ch); if (n + cw > max) return out.slice(0, -1) + '…'; n += cw; out += ch; }
  return out;
}
const kb = (n: number) => (n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`);
const kt = (n: number) => (n < 1000 ? `${n}` : `${(n / 1000).toFixed(1)}k`);
const sleep = (ms: number, sig?: AbortSignal) => new Promise<void>((res) => {
  const t = setTimeout(res, ms); sig?.addEventListener('abort', () => { clearTimeout(t); res(); }, { once: true });
});

// ─── output state + spinner ──────────────────────────────────────────────────
let atBOL = true;
function out(s: string) { if (!s) return; spin.stop(); w(s); atBOL = s.endsWith('\n'); }
function line(s = '') { spin.stop(); if (!atBOL) w('\n'); w(s + '\n'); atBOL = true; }
const spin = {
  t: null as ReturnType<typeof setInterval> | null, text: '', i: 0,
  start(text: string) {
    this.text = text;
    if (!TTY || this.t) return;
    if (!atBOL) { w('\n'); atBOL = true; }
    w('\x1b[?25l');
    this.t = setInterval(() => this.draw(), 90); this.draw();
  },
  draw() {
    const f = ['·  ', '·· ', '···', ' ··', '  ·', '   '][this.i++ % 6];
    const q = queue.length ? gray(`  · ${queue.length} queued`) : '';
    w(`\r\x1b[2K${cyan(f)} ${dim(clip(this.text, (process.stdout.columns || 80) - 20))}${q}`);
  },
  stop() { if (this.t) { clearInterval(this.t); this.t = null; w('\r\x1b[2K\x1b[?25h'); } },
};

// ─── sandbox: everything stays inside ROOT ───────────────────────────────────
function safePath(p: string): string {
  if (typeof p !== 'string' || !p) throw new Error('path is required');
  const abs = path.resolve(ROOT, p);
  let real = abs, probe = abs;
  while (!fs.existsSync(probe)) { const up = path.dirname(probe); if (up === probe) break; probe = up; }
  try { real = path.join(fs.realpathSync(probe), path.relative(probe, abs)); } catch {}
  const rel = path.relative(ROOT, real);
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error(`access denied: ${p} is outside the working directory`);
  return abs;
}
const relp = (abs: string) => path.relative(ROOT, abs).split(path.sep).join('/') || '.';

// ─── undo ────────────────────────────────────────────────────────────────────
const undoStack: Map<string, Buffer | null>[] = [];
function snapshot(abs: string) {
  const top = undoStack[undoStack.length - 1];
  if (top && !top.has(abs)) top.set(abs, fs.existsSync(abs) ? fs.readFileSync(abs) : null);
}

// ─── tools ───────────────────────────────────────────────────────────────────
const SHELL = process.env.FA_SHELL || (IS_WIN ? 'powershell' : fs.existsSync('/bin/bash') ? 'bash' : 'sh');
const MAX_OUT = 30_000;
const TOOLS = [
  {
    name: 'write',
    description: 'Create or overwrite a file with its complete content. Parent folders are created automatically.',
    schema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] },
  },
  {
    name: 'edit',
    description: 'Replace exact text in an existing file. Each `old` must occur exactly once. Put all changes to one file into a single call.',
    schema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        edits: { type: 'array', items: { type: 'object', properties: { old: { type: 'string' }, new: { type: 'string' } }, required: ['old', 'new'] } },
      },
      required: ['path', 'edits'],
    },
  },
  {
    name: 'read',
    description: 'Read a text file (optionally a line range) or list a directory.',
    schema: {
      type: 'object',
      properties: { path: { type: 'string' }, offset: { type: 'integer', description: 'first line, 1-based' }, limit: { type: 'integer' } },
      required: ['path'],
    },
  },
  {
    name: 'shell',
    description: `Run a ${SHELL} command in the working directory (non-interactive, no stdin). Returns exit code and output tail.`,
    schema: { type: 'object', properties: { command: { type: 'string' }, timeout: { type: 'integer', description: 'seconds, default 120' } }, required: ['command'] },
  },
];

interface Call { id: string; name: string; args: any; bad?: string }
interface Result { text: string; err?: boolean; show: string }

function toolWrite(a: any): Result {
  const abs = safePath(a.path);
  if (typeof a.content !== 'string') throw new Error('content must be a string');
  snapshot(abs);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, a.content);
  const n = a.content.split('\n').length;
  return { text: `wrote ${relp(abs)} (${n} lines)`, show: `${n} lines, ${kb(Buffer.byteLength(a.content))}` };
}

function toolEdit(a: any): Result {
  const abs = safePath(a.path);
  if (!fs.existsSync(abs)) throw new Error(`${a.path} does not exist — use write to create it`);
  const raw = fs.readFileSync(abs, 'utf8');
  const crlf = raw.includes('\r\n');
  let text = crlf ? raw.replace(/\r\n/g, '\n') : raw;
  const edits = Array.isArray(a.edits) ? a.edits : [a];
  let plus = 0, minus = 0;
  for (const [i, e] of edits.entries()) {
    const o = String(e.old ?? '').replace(/\r\n/g, '\n'), nw = String(e.new ?? '').replace(/\r\n/g, '\n');
    if (!o) throw new Error(`edit #${i + 1}: old is empty`);
    const first = text.indexOf(o);
    if (first < 0) throw new Error(`edit #${i + 1}: old text not found in ${a.path} (must match exactly, including whitespace). No changes applied.`);
    if (text.indexOf(o, first + 1) >= 0) throw new Error(`edit #${i + 1}: old text matches several places — add surrounding lines. No changes applied.`);
    text = text.slice(0, first) + nw + text.slice(first + o.length);
    minus += o.split('\n').length; plus += nw.split('\n').length;
  }
  snapshot(abs);
  fs.writeFileSync(abs, crlf ? text.replace(/\n/g, '\r\n') : text);
  return { text: `edited ${relp(abs)}`, show: `${green('+' + plus)} ${red('-' + minus)}` };
}

function toolRead(a: any): Result {
  const abs = safePath(a.path);
  const st = fs.statSync(abs);
  if (st.isDirectory()) {
    const ents = fs.readdirSync(abs, { withFileTypes: true }).sort((x, y) => Number(y.isDirectory()) - Number(x.isDirectory()) || x.name.localeCompare(y.name));
    const list = ents.slice(0, 500).map((e) => e.name + (e.isDirectory() ? '/' : '')).join('\n');
    return { text: (list || '(empty)') + (ents.length > 500 ? `\n… ${ents.length - 500} more` : ''), show: `${ents.length} entries` };
  }
  const buf = fs.readFileSync(abs);
  if (buf.subarray(0, 8000).includes(0)) return { text: `binary file, ${buf.length} bytes`, show: 'binary' };
  const lines = buf.toString('utf8').split('\n');
  const from = Math.max(1, Number(a.offset) || 1);
  const limit = Math.max(1, Number(a.limit) || 2000);
  let body = lines.slice(from - 1, from - 1 + limit).join('\n');
  if (body.length > 60_000) body = body.slice(0, 60_000) + '\n… [truncated]';
  const end = Math.min(lines.length, from - 1 + limit);
  if (end < lines.length) body += `\n… [${lines.length - end} more lines, read with offset=${end + 1}]`;
  return { text: body, show: from > 1 || end < lines.length ? `lines ${from}-${end} of ${lines.length}` : `${lines.length} lines` };
}

function toolShell(a: any, sig: AbortSignal): Promise<Result> {
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
    const add = (d: Buffer) => { chunks.push(d); size += d.length; while (size > MAX_OUT * 4 && chunks.length > 1) size -= chunks.shift()!.length; };
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
      const status = timedOut ? `killed after ${timeout}s timeout` : sig.aborted ? 'interrupted by user' : `exit ${code}`;
      resolve({ text: `${status}${extra}\n${o}`, err: code !== 0, show: `${code === 0 ? dim(status) : red(status)}\n${tail(o)}` });
    };
    child.on('error', (e) => done(-1, `: ${e.message}`));
    child.on('close', (code) => done(code));
  });
}
function tail(s: string, n = 4) {
  if (!s) return '';
  const ls = s.split('\n'); const cols = (process.stdout.columns || 80) - 6;
  return (ls.length > n ? gray(`    … ${ls.length - n} more lines\n`) : '') + ls.slice(-n).map((l) => gray('    ' + clip(l, cols))).join('\n');
}

async function runTool(c: Call, sig: AbortSignal): Promise<Result> {
  if (sig.aborted) return { text: 'not run: interrupted by user', err: true, show: yellow('skipped') };
  if (c.bad) return { text: c.bad, err: true, show: red(c.bad) };
  try {
    switch (c.name) {
      case 'write': return toolWrite(c.args);
      case 'edit': return toolEdit(c.args);
      case 'read': return toolRead(c.args);
      case 'shell':
        if (cfg.safe && !(await confirm(`run ${cyan(clip(String(c.args.command), 200))} ?`)))
          return { text: 'user declined to run this command', err: true, show: yellow('declined') };
        return await toolShell(c.args, sig);
      default: throw new Error(`unknown tool ${c.name}`);
    }
  } catch (e: any) {
    return { text: `error: ${e.message}`, err: true, show: red(e.message) };
  }
}

function describe(c: Call) {
  const a = c.args || {};
  if (c.name === 'shell') return `${bold('$')} ${clip(String(a.command ?? '').split('\n')[0], (process.stdout.columns || 80) - 10)}`;
  return `${bold(c.name)} ${a.path ?? ''}`;
}

// Calls touching the same file run in order; everything else runs in parallel.
async function runTools(calls: Call[], sig: AbortSignal): Promise<Result[]> {
  const results: Result[] = new Array(calls.length);
  const groups = new Map<string, number[]>();
  calls.forEach((c, i) => {
    const k = c.name === 'shell' ? `$${i}` : (() => { try { return safePath(c.args?.path); } catch { return `?${i}`; } })();
    groups.set(k, [...(groups.get(k) || []), i]);
  });
  const anyShell = calls.some((c) => c.name === 'shell');
  if (anyShell) spin.start(calls.length > 1 ? `running ${calls.length} tools` : describe(calls[0]).replace(/\x1b\[[0-9;]*m/g, ''));
  await Promise.all([...groups.values()].map(async (idx) => {
    for (const i of idx) {
      results[i] = await runTool(calls[i], sig);
      const r = results[i];
      spin.stop();
      const [head, ...more] = r.show.split('\n');
      line(`${r.err ? red('●') : green('●')} ${describe(calls[i])}  ${r.err ? head : gray(head)}`);
      if (more.length) line(more.join('\n'));
      if (anyShell && results.filter(Boolean).length < calls.length) spin.start('running tools');
    }
  }));
  spin.stop();
  return results;
}

// ─── system prompt ───────────────────────────────────────────────────────────
function systemPrompt() {
  let listing = '';
  try {
    const ents = fs.readdirSync(ROOT, { withFileTypes: true }).filter((e) => e.name !== '.git');
    listing = ents.slice(0, 80).map((e) => e.name + (e.isDirectory() ? '/' : '')).join('  ') + (ents.length > 80 ? `  … +${ents.length - 80}` : '');
  } catch {}
  let ctx = '';
  for (const f of ['AGENTS.md', 'CLAUDE.md']) {
    try { ctx = fs.readFileSync(path.join(ROOT, f), 'utf8').slice(0, 16_000); if (ctx) { ctx = `\n\n# Project instructions (${f})\n${ctx}`; break; } } catch {}
  }
  return `You are fa, a fast coding agent. You work in ${ROOT.split(path.sep).join('/')} on ${IS_WIN ? 'Windows' : process.platform} (shell: ${SHELL}). Today is ${new Date().toISOString().slice(0, 10)}.

Speed is the priority: finish the task with the fewest tool calls and tokens, without lowering quality.
- Act at once. No plans, no preambles, no restating the task.
- New file/app/game/page: write it complete and working in ONE write call. Do not explore first, do not read it back, do not add files nobody asked for (README, tests, configs).
- Existing code: read only what the task needs. Issue independent tool calls together in one turn — they run in parallel.
- Change files with edit, all changes to one file in one call. Rewrite with write only when most of the file changes.
- Run commands only when the task needs them (install, build, the tests the user asked for). Never start servers, watchers or anything interactive.
- You can only touch files inside the working directory; use relative paths.
- Done = one short sentence on what changed. No feature lists, no headings, no "next steps".
- Questions and chat: answer directly and briefly, without tools.
- Reply in the user's language.

Working directory: ${listing || '(empty)'}${ctx}`;
}

// ─── HTTP / SSE ──────────────────────────────────────────────────────────────
async function* sse(res: Response): AsyncGenerator<any> {
  const reader = res.body!.getReader(); const dec = new TextDecoder(); let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const l = buf.slice(0, i).replace(/\r$/, ''); buf = buf.slice(i + 1);
      if (!l.startsWith('data:')) continue;
      const d = l.slice(5).trim();
      if (d === '[DONE]') return;
      if (d) { try { yield JSON.parse(d); } catch {} }
    }
  }
}
function errText(t: string) {
  try { const j = JSON.parse(t); return j.error?.message || j.message || j.error || t; } catch { return t.slice(0, 500); }
}
async function post(url: string, headers: Record<string, string>, body: any, sig: AbortSignal): Promise<Response> {
  for (let a = 0; ; a++) {
    let res: Response;
    try {
      res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: sig });
    } catch (e: any) {
      if (sig.aborted) throw e;
      if (a >= 3) throw new Error(`${e.message}${e.cause ? ': ' + (e.cause.code || e.cause.message) : ''} (${url})`);
      spin.start(`network error, retry ${a + 1}/3`); await sleep(1000 * 2 ** a, sig); continue;
    }
    if (res.ok) return res;
    const t = await res.text();
    if ((res.status === 429 || res.status >= 500) && a < 3) {
      const ra = Number(res.headers.get('retry-after'));
      spin.start(`${res.status} ${clip(String(errText(t)), 60)} — retry ${a + 1}/3`);
      await sleep(ra > 0 && ra < 60 ? ra * 1000 : 1500 * 2 ** a, sig);
      if (sig.aborted) throw new Error('aborted');
      continue;
    }
    throw new Error(`${res.status}: ${errText(t)}`);
  }
}
function authHeaders(p: Prov): Record<string, string> {
  const k = keyOf(p);
  if (p.type === 'anthropic') return { ...(k ? { 'x-api-key': k } : {}), 'anthropic-version': '2023-06-01', ...p.headers };
  return { ...(k ? { authorization: `Bearer ${k}` } : {}), ...p.headers };
}
const base = (p: Prov) => p.url.replace(/\/+$/, '');

// ─── conversation ────────────────────────────────────────────────────────────
type Msg =
  | { role: 'user'; text: string }
  | { role: 'assistant'; text: string; calls: Call[]; blocks?: any[]; prov?: string }
  | { role: 'tool'; id: string; text: string; err?: boolean };
let history: Msg[] = [];
let SYSTEM = systemPrompt();
const usage = { in: 0, out: 0, cache: 0 };

interface Turn { text: string; calls: Call[]; blocks?: any[]; stop: string }
let streamMode: 'text' | 'think' | '' = '';
function onText(s: string) {
  if (streamMode === 'think') { out('\n'); }
  streamMode = 'text'; out(s);
}
function onThink(s: string) {
  if (streamMode !== 'think' && !atBOL) out('\n');
  streamMode = 'think'; out(gray(s));
}
function toolProgress(name: string, raw: string) {
  const p = /"path"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(raw)?.[1] ?? /"command"\s*:\s*"((?:[^"\\]|\\.)*)/.exec(raw)?.[1] ?? '';
  if (streamMode === 'think' || streamMode === 'text') { line(); streamMode = ''; }
  spin.start(`${name} ${p.replace(/\\n/g, ' ')}  ${kb(raw.length)}`);
}
function parseArgs(name: string, raw: string, truncated: boolean): Pick<Call, 'args' | 'bad'> {
  try { return { args: raw ? JSON.parse(raw) : {} }; }
  catch {
    return {
      args: {},
      bad: truncated
        ? `the ${name} call was cut off by the output token limit — split the content: write a smaller file first, then add the rest with edit`
        : `invalid JSON arguments for ${name}`,
    };
  }
}

async function callAnthropic(p: Prov, sig: AbortSignal, acc: Turn) {
  const official = /api\.anthropic\.com/.test(p.url);
  const msgs: any[] = [];
  const push = (role: string, blocks: any[]) => {
    const last = msgs[msgs.length - 1];
    if (last && last.role === role && role === 'user') last.content.push(...blocks); else msgs.push({ role, content: blocks });
  };
  for (const m of history) {
    if (m.role === 'user') push('user', [{ type: 'text', text: m.text }]);
    else if (m.role === 'tool') push('user', [{ type: 'tool_result', tool_use_id: m.id, content: m.text || '(no output)', ...(m.err ? { is_error: true } : {}) }]);
    else {
      let blocks = m.blocks && m.prov === cfg.provider ? m.blocks : [
        ...(m.text ? [{ type: 'text', text: m.text }] : []),
        ...m.calls.map((c) => ({ type: 'tool_use', id: c.id, name: c.name, input: c.args ?? {} })),
      ];
      if (!blocks.length) blocks = [{ type: 'text', text: '(no response)' }];
      msgs.push({ role: 'assistant', content: blocks });
    }
  }
  // cache breakpoints: system (+tools before it) and the newest message
  const last = msgs[msgs.length - 1];
  if (last) { const lb = last.content.length - 1; last.content[lb] = { ...last.content[lb], cache_control: { type: 'ephemeral' } }; }
  const body: any = {
    model: cfg.model, max_tokens: cfg.maxTokens || 64000, stream: true, messages: msgs,
    system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
    tools: TOOLS.map((t) => ({ name: t.name, description: t.description, input_schema: t.schema, ...(official ? { eager_input_streaming: true } : {}) })),
  };
  if (cfg.effort !== 'auto') { body.output_config = { effort: cfg.effort }; body.thinking = { type: 'adaptive', display: 'summarized' }; }
  const headers = authHeaders(p);
  if (cfg.fast && official) { body.speed = 'fast'; headers['anthropic-beta'] = 'fast-mode-2026-02-01'; }

  let res: Response;
  try { res = await post(`${base(p)}/v1/messages`, headers, body, sig); }
  catch (e: any) {
    if (!cfg.maxTokens && /max_tokens/.test(e.message)) { body.max_tokens = 8192; res = await post(`${base(p)}/v1/messages`, headers, body, sig); }
    else throw e;
  }
  const blocks: any[] = []; const raw: Record<number, string> = {};
  for await (const ev of sse(res)) {
    switch (ev.type) {
      case 'message_start': {
        const u = ev.message?.usage || {};
        usage.in += (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
        usage.cache += u.cache_read_input_tokens || 0; usage.out += u.output_tokens || 0;
        break;
      }
      case 'content_block_start': {
        const b = { ...ev.content_block }; blocks[ev.index] = b;
        if (b.type === 'tool_use') { raw[ev.index] = ''; toolProgress(b.name, ''); }
        break;
      }
      case 'content_block_delta': {
        const b = blocks[ev.index], d = ev.delta;
        if (d.type === 'text_delta') { b.text = (b.text || '') + d.text; acc.text += d.text; onText(d.text); }
        else if (d.type === 'thinking_delta') { b.thinking = (b.thinking || '') + d.thinking; onThink(d.thinking); }
        else if (d.type === 'signature_delta') b.signature = (b.signature || '') + d.signature;
        else if (d.type === 'input_json_delta') { raw[ev.index] += d.partial_json; toolProgress(b.name, raw[ev.index]); }
        break;
      }
      case 'message_delta':
        if (ev.delta?.stop_reason) acc.stop = ev.delta.stop_reason;
        usage.out += ev.usage?.output_tokens || 0;
        break;
      case 'error': throw new Error(ev.error?.message || JSON.stringify(ev.error));
    }
  }
  const truncated = acc.stop === 'max_tokens';
  acc.blocks = blocks.filter(Boolean).map((b) => {
    if (b.type === 'text') return { type: 'text', text: b.text || '' };
    if (b.type === 'tool_use') {
      const r = parseArgs(b.name, raw[blocks.indexOf(b)] ?? '', truncated);
      acc.calls.push({ id: b.id, name: b.name, ...r });
      return { type: 'tool_use', id: b.id, name: b.name, input: r.args };
    }
    return b;
  }).filter((b) => !(b.type === 'text' && !b.text));
  if (acc.stop === 'refusal') line(yellow('  the model declined this request'));
}

async function callOpenAI(p: Prov, sig: AbortSignal, acc: Turn) {
  const msgs: any[] = [{ role: 'system', content: SYSTEM }];
  for (const m of history) {
    if (m.role === 'user') msgs.push({ role: 'user', content: m.text });
    else if (m.role === 'tool') msgs.push({ role: 'tool', tool_call_id: m.id, content: m.text || '(no output)' });
    else msgs.push({
      role: 'assistant', content: m.text || (m.calls.length ? null : '(no response)'),
      ...(m.calls.length ? { tool_calls: m.calls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args ?? {}) } })) } : {}),
    });
  }
  const body: any = {
    model: cfg.model, stream: true, messages: msgs, stream_options: { include_usage: true },
    tools: TOOLS.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.schema } })),
  };
  if (cfg.maxTokens) body.max_tokens = cfg.maxTokens;
  if (cfg.effort !== 'auto') body.reasoning_effort = ['xhigh', 'max'].includes(cfg.effort) ? 'high' : cfg.effort;
  const res = await post(`${base(p)}/chat/completions`, authHeaders(p), body, sig);
  const slots: { id: string; name: string; args: string }[] = [];
  for await (const ch of sse(res)) {
    if (ch.error) throw new Error(ch.error.message || JSON.stringify(ch.error));
    if (ch.usage) {
      const c = ch.usage.prompt_tokens_details?.cached_tokens || ch.usage.prompt_cache_hit_tokens || 0;
      usage.in += ch.usage.prompt_tokens || 0; usage.out += ch.usage.completion_tokens || 0; usage.cache += c;
    }
    const choice = ch.choices?.[0];
    if (!choice) continue;
    const d = choice.delta || {};
    const think = d.reasoning_content ?? d.reasoning;
    if (typeof think === 'string' && think) onThink(think);
    if (d.content) { acc.text += d.content; onText(d.content); }
    for (const tc of d.tool_calls || []) {
      const i = typeof tc.index === 'number' ? tc.index : slots.length;
      const s = (slots[i] ||= { id: '', name: '', args: '' });
      if (tc.id) s.id = tc.id;
      if (tc.function?.name) s.name = tc.function.name;
      if (tc.function?.arguments) s.args += tc.function.arguments;
      toolProgress(s.name, s.args);
    }
    if (choice.finish_reason) acc.stop = choice.finish_reason;
  }
  slots.filter(Boolean).forEach((s, i) => acc.calls.push({ id: s.id || `call_${Date.now()}_${i}`, name: s.name, ...parseArgs(s.name, s.args, acc.stop === 'length') }));
}

// ─── agent loop ──────────────────────────────────────────────────────────────
let ctrl: AbortController | null = null;
async function runTurn(text: string) {
  if (!cfg.model || !cur()) { line(yellow('  no model selected — use /model')); return; }
  history.push({ role: 'user', text });
  undoStack.push(new Map());
  ctrl = new AbortController(); const sig = ctrl.signal;
  const t0 = Date.now(); const u0 = { ...usage };
  let steps = 0;
  try {
    for (;;) {
      steps++;
      streamMode = '';
      spin.start(steps === 1 ? 'thinking' : 'working');
      const acc: Turn = { text: '', calls: [], stop: '' };
      try {
        const p = cur();
        await (p.type === 'anthropic' ? callAnthropic(p, sig, acc) : callOpenAI(p, sig, acc));
      } catch (e) {
        if (acc.text) history.push({ role: 'assistant', text: acc.text, calls: [] });
        throw e;
      }
      spin.stop();
      if (!atBOL) line();
      history.push({ role: 'assistant', text: acc.text, calls: acc.calls, blocks: acc.blocks, prov: cfg.provider });
      if ((acc.stop === 'max_tokens' || acc.stop === 'length') && !acc.calls.length) line(yellow('  output hit the token limit'));
      if (!acc.calls.length) break;
      const results = await runTools(acc.calls, sig);
      acc.calls.forEach((c, i) => history.push({ role: 'tool', id: c.id, text: results[i].text, err: results[i].err }));
      if (sig.aborted) throw new Error('aborted');
    }
  } catch (e: any) {
    spin.stop();
    if (sig.aborted) line(yellow('■ stopped'));
    else line(red(`✖ ${e.message}`) + (/effort|thinking|adaptive/i.test(e.message) && cfg.effort !== 'auto' ? gray('  (try /think auto)') : ''));
  } finally {
    ctrl = null;
    if (undoStack[undoStack.length - 1]?.size === 0) undoStack.pop();
  }
  const s = ((Date.now() - t0) / 1000).toFixed(1);
  const cache = usage.cache - u0.cache;
  line(gray(`  ${s}s · ↑${kt(usage.in - u0.in)}${cache ? ` (${kt(cache)} cached)` : ''} ↓${kt(usage.out - u0.out)} · ${steps} step${steps > 1 ? 's' : ''}`));
}

// ─── models ──────────────────────────────────────────────────────────────────
let modelCache: { at: number; items: { label: string; created: number }[]; errs: string[] } | null = null;
async function listModels(name: string, p: Prov): Promise<{ id: string; created: number }[]> {
  const url = p.type === 'anthropic' ? `${base(p)}/v1/models?limit=1000` : `${base(p)}/models`;
  const res = await fetch(url, { headers: authHeaders(p), signal: AbortSignal.timeout(isLocal(p) ? 2000 : 8000) });
  if (!res.ok) throw new Error(`${res.status} ${clip(String(errText(await res.text())), 80)}`);
  const j: any = await res.json();
  const arr: any[] = j.data || j.models || [];
  return arr.map((m) => ({
    id: String(m.id ?? m.name ?? '').replace(/^models\//, ''),
    created: typeof m.created === 'number' ? m.created : m.created_at ? Date.parse(m.created_at) / 1000 : 0,
  })).filter((m) => m.id);
}
async function allModels(force = false) {
  if (modelCache && !force && Date.now() - modelCache.at < 10 * 60_000) return modelCache;
  const ps = provs(); const names = Object.keys(ps).filter((n) => usable(ps[n]));
  spin.start(`loading models from ${names.join(', ')}`);
  const errs: string[] = []; const items: { label: string; created: number }[] = [];
  await Promise.all(names.map(async (n) => {
    try { for (const m of await listModels(n, ps[n])) items.push({ label: `${n}/${m.id}`, created: m.created }); }
    catch (e: any) { if (!isLocal(ps[n])) errs.push(`${n}: ${e.name === 'TimeoutError' ? 'timeout' : e.message}`); }
  }));
  spin.stop();
  items.sort((a, b) => b.created - a.created || a.label.localeCompare(b.label));
  modelCache = { at: Date.now(), items, errs };
  return modelCache;
}
function setModel(label: string) {
  const i = label.indexOf('/');
  cfg.provider = label.slice(0, i); cfg.model = label.slice(i + 1);
  cfg.recent = [label, ...cfg.recent.filter((r) => r !== label)].slice(0, 8);
  saveCfg();
  line(`${green('●')} model ${bold(modelLabel())}`);
}
async function chooseModel(query: string) {
  if (query.includes('/') && provs()[query.slice(0, query.indexOf('/'))] && !query.endsWith('/')) {
    const exact = (await allModels()).items.find((m) => m.label === query);
    if (exact || !/\s/.test(query)) return setModel(query);
  }
  const { items, errs } = await allModels(query === '!');
  if (query === '!') query = '';
  for (const e of errs) line(gray(`  ${e}`));
  if (!items.length) {
    line(yellow('  no models found. Set an API key (e.g. /key openrouter sk-...) or add a provider: /provider add'));
    return;
  }
  const recent = cfg.recent.filter((r) => items.some((m) => m.label === r));
  const ordered = [...recent, ...items.map((m) => m.label).filter((l) => !recent.includes(l))];
  const pickd = await pick('model', ordered, query, (l) => (recent.includes(l) ? '★' : ''));
  if (pickd) setModel(pickd);
}

// ─── terminal input ──────────────────────────────────────────────────────────
type Key = { name?: string; ctrl?: boolean; meta?: boolean; shift?: boolean; sequence?: string };
let handler: ((s: string | undefined, k: Key) => void) | null = null;
const queue: string[] = [];
const hist: string[] = [];
const COMMANDS: Record<string, string> = {
  '/model': 'pick a model (search, arrows, Enter) — "/model !" refreshes',
  '/think': 'reasoning effort: auto | low | medium | high | xhigh | max',
  '/fast': 'toggle Anthropic fast mode (Opus, ~2.5x output speed, pricier)',
  '/provider': 'list providers · /provider add <name> <url> [key] [openai|anthropic] · /provider rm <name>',
  '/key': 'save an API key: /key <provider> <key>',
  '/safe': 'toggle confirmation before shell commands',
  '/undo': 'revert file changes made by the last request',
  '/clear': 'start a new conversation',
  '/help': 'show this help',
  '/exit': 'quit',
};

function isPrintable(s: string | undefined, k: Key) {
  return !!s && !k.ctrl && !k.meta && !/^[\x00-\x1f\x7f]/.test(s) && !s.startsWith('\x1b');
}

const editor = {
  chars: [] as string[], pos: 0, row: 0, hi: -1, draft: [] as string[],
  pasting: false, lastKey: 0, resolve: null as ((v: string | null) => void) | null, lastCtrlC: 0,
  read(): Promise<string | null> {
    line(gray(`${modelLabel()} · think ${cfg.effort}${cfg.fast ? ' · fast' : ''}${cfg.safe ? ' · safe' : ''}`));
    this.row = 0; this.hi = -1;
    return new Promise((res) => { this.resolve = res; handler = (s, k) => this.key(s, k); this.render(); });
  },
  text() { return this.chars.join(''); },
  set(t: string) { this.chars = Array.from(t); this.pos = this.chars.length; },
  insert(t: string) {
    const cs = Array.from(t.replace(/\r\n?/g, '\n').replace(/\t/g, '  '));
    this.chars.splice(this.pos, 0, ...cs); this.pos += cs.length;
  },
  render() {
    const cols = process.stdout.columns || 80;
    const lines: string[][] = [[]];
    for (const ch of this.chars) ch === '\n' ? lines.push([]) : lines[lines.length - 1].push(ch);
    let o = '', row = 0, idx = 0, cr = 0, cc = 0;
    lines.forEach((ln, li) => {
      const wdt = 2 + strWidth(ln.join(''));
      if (this.pos >= idx && this.pos <= idx + ln.length) {
        const cw = 2 + strWidth(ln.slice(0, this.pos - idx).join(''));
        cr = row + Math.floor(cw / cols); cc = cw % cols;
      }
      o += (li ? '\r\n' : '') + (li ? '  ' : cyan('› ')) + ln.join('');
      if (wdt % cols === 0) o += ' \r';
      row += Math.floor(wdt / cols) + 1; idx += ln.length + 1;
    });
    const up = row - 1 - cr;
    w((this.row ? `\x1b[${this.row}A` : '') + '\r\x1b[J' + o + (up ? `\x1b[${up}A` : '') + '\r' + (cc ? `\x1b[${cc}C` : ''));
    this.row = cr;
  },
  finish(v: string | null) {
    this.pos = this.chars.length; this.render(); w('\r\n'); atBOL = true; this.row = 0;
    handler = runKey; const r = this.resolve; this.resolve = null; r?.(v);
  },
  submit() {
    const t = this.text();
    if (!t.trim()) return;
    if (hist[hist.length - 1] !== t) hist.push(t);
    this.finish(t); this.chars = []; this.pos = 0;
  },
  key(s: string | undefined, k: Key) {
    const now = Date.now(); const fast = now - this.lastKey < 8; this.lastKey = now;
    const n = k.name;
    if (n === 'paste-start') { this.pasting = true; return; }
    if (n === 'paste-end') { this.pasting = false; this.render(); return; }
    if (this.pasting) { if (n === 'return' || n === 'enter') this.insert('\n'); else if (s) this.insert(s); return; }
    if (k.ctrl && n === 'c') {
      if (this.chars.length) { this.chars = []; this.pos = 0; }
      else if (now - this.lastCtrlC < 1500) return this.finish(null);
      else { this.lastCtrlC = now; w('\r\x1b[J' + gray('  press Ctrl+C again to exit') + '\x1b[0G'); this.row = 0; atBOL = false; line(); }
      return this.render();
    }
    if (k.ctrl && n === 'd') { if (!this.chars.length) return this.finish(null); this.chars.splice(this.pos, 1); return this.render(); }
    if (n === 'return' && !k.meta && !k.ctrl && !fast) {
      if (this.chars[this.pos - 1] === '\\') { this.chars.splice(this.pos - 1, 1, '\n'); return this.render(); }
      return this.submit();
    }
    if (n === 'return' || n === 'enter') { this.insert('\n'); return this.render(); }
    if (n === 'backspace') { if (this.pos > 0) { this.chars.splice(--this.pos, 1); } }
    else if (n === 'delete') this.chars.splice(this.pos, 1);
    else if (n === 'left') this.pos = Math.max(0, this.pos - 1);
    else if (n === 'right') this.pos = Math.min(this.chars.length, this.pos + 1);
    else if (n === 'home' || (k.ctrl && n === 'a')) this.pos = this.lineStart();
    else if (n === 'end' || (k.ctrl && n === 'e')) this.pos = this.lineEnd();
    else if (k.ctrl && n === 'u') { const st = this.lineStart(); this.chars.splice(st, this.pos - st); this.pos = st; }
    else if (k.ctrl && n === 'k') this.chars.splice(this.pos, this.lineEnd() - this.pos);
    else if ((k.ctrl && n === 'w') || (k.meta && n === 'backspace')) {
      let st = this.pos; while (st > 0 && this.chars[st - 1] === ' ') st--; while (st > 0 && !/[\s]/.test(this.chars[st - 1])) st--;
      this.chars.splice(st, this.pos - st); this.pos = st;
    }
    else if (k.ctrl && n === 'l') { w('\x1b[2J\x1b[H'); this.row = 0; }
    else if (n === 'up' || n === 'down') this.vertical(n === 'up' ? -1 : 1);
    else if (n === 'escape') { this.chars = []; this.pos = 0; }
    else if (n === 'tab') this.complete();
    else if (isPrintable(s, k)) this.insert(s!);
    else return;
    this.render();
  },
  lineStart() { let i = this.pos; while (i > 0 && this.chars[i - 1] !== '\n') i--; return i; },
  lineEnd() { let i = this.pos; while (i < this.chars.length && this.chars[i] !== '\n') i++; return i; },
  vertical(d: number) {
    const st = this.lineStart(), col = this.pos - st;
    if (d < 0 && st > 0) { let ps = st - 1; while (ps > 0 && this.chars[ps - 1] !== '\n') ps--; this.pos = Math.min(ps + col, st - 1); return; }
    const en = this.lineEnd();
    if (d > 0 && en < this.chars.length) { const ne = (() => { let i = en + 1; while (i < this.chars.length && this.chars[i] !== '\n') i++; return i; })(); this.pos = Math.min(en + 1 + col, ne); return; }
    if (!hist.length) return;
    if (this.hi === -1) { if (d > 0) return; this.draft = [...this.chars]; this.hi = hist.length; }
    this.hi = Math.max(0, Math.min(hist.length, this.hi + d));
    if (this.hi === hist.length) { this.chars = [...this.draft]; this.pos = this.chars.length; this.hi = -1; }
    else this.set(hist[this.hi]);
  },
  complete() {
    const t = this.text();
    if (!t.startsWith('/') || t.includes(' ')) return;
    const m = Object.keys(COMMANDS).filter((c) => c.startsWith(t));
    if (m.length === 1) this.set(m[0] + ' ');
    else if (m.length > 1) { w('\r\x1b[J' + gray('  ' + m.join('  ')) + '\r\n'); this.row = 0; }
  },
};

function runKey(s: string | undefined, k: Key) {
  if (k.name === 'escape' || (k.ctrl && k.name === 'c')) { ctrl?.abort(); return; }
  if (k.name === 'return' && editor.chars.length) { queue.push(editor.text()); editor.chars = []; editor.pos = 0; return; }
  if (k.name === 'backspace') { if (editor.pos > 0) editor.chars.splice(--editor.pos, 1); return; }
  if (isPrintable(s, k)) editor.insert(s!);
}

function confirm(q: string): Promise<boolean> {
  return new Promise((res) => {
    spin.stop(); line(`${yellow('?')} ${q} ${gray('[y/N]')}`);
    const prev = handler;
    handler = (s, k) => {
      handler = prev;
      const yes = (s || '').toLowerCase() === 'y' || (s || '') === 'н';
      line(yes ? green('  yes') : gray('  no'));
      if (k.ctrl && k.name === 'c') ctrl?.abort();
      res(yes);
    };
  });
}

function pick(title: string, items: string[], query: string, tag: (s: string) => string = () => ''): Promise<string | null> {
  return new Promise((resolve) => {
    let q = Array.from(query), sel = 0, top = 0, drawn = 0, list = items;
    const filter = () => {
      const qs = q.join('').toLowerCase().trim();
      if (!qs) return items;
      const toks = qs.split(/\s+/);
      const hit = items.filter((it) => toks.every((t) => it.toLowerCase().includes(t)));
      if (hit.length) return hit;
      const flat = qs.replace(/\s+/g, '');
      return items.filter((it) => { let j = 0; const l = it.toLowerCase(); for (const ch of l) if (ch === flat[j]) j++; return j === flat.length; });
    };
    const H = () => Math.max(3, Math.min(14, (process.stdout.rows || 24) - 5));
    const draw = () => {
      const cols = process.stdout.columns || 80, h = H();
      if (sel < top) top = sel; if (sel >= top + h) top = sel - h + 1;
      const rows = [`${cyan('?')} ${bold(title)} ${cyan('›')} ${q.join('')}${gray('▏')}`];
      list.slice(top, top + h).forEach((it, i) => {
        const on = top + i === sel; const t = tag(it);
        const txt = clip(it, cols - 6);
        rows.push(on ? `${cyan('❯')} ${cyan(txt)} ${yellow(t)}` : `  ${txt} ${yellow(t)}`);
      });
      rows.push(gray(`  ${list.length}/${items.length} · type to search · ↑↓ PgUp PgDn · Enter · Esc`));
      w((drawn > 1 ? `\x1b[${drawn - 1}A` : '') + '\r\x1b[J' + rows.join('\r\n'));
      drawn = rows.length;
    };
    const done = (v: string | null) => {
      w((drawn > 1 ? `\x1b[${drawn - 1}A` : '') + '\r\x1b[J\x1b[?25h'); atBOL = true;
      handler = prev; resolve(v);
    };
    const prev = handler;
    handler = (s, k) => {
      const n = k.name;
      if (n === 'escape' || (k.ctrl && n === 'c')) return done(null);
      if (n === 'return') return done(list[sel] ?? null);
      if (n === 'up') sel = Math.max(0, sel - 1);
      else if (n === 'down') sel = Math.min(list.length - 1, sel + 1);
      else if (n === 'pageup') sel = Math.max(0, sel - H());
      else if (n === 'pagedown') sel = Math.min(list.length - 1, sel + H());
      else if (n === 'backspace') { q.pop(); list = filter(); sel = 0; }
      else if (k.ctrl && n === 'u') { q = []; list = filter(); sel = 0; }
      else if (isPrintable(s, k)) { q.push(...Array.from(s!)); list = filter(); sel = 0; }
      draw();
    };
    w('\x1b[?25l'); list = filter(); draw();
  });
}

// ─── commands ────────────────────────────────────────────────────────────────
async function command(input: string): Promise<boolean> {
  const [cmd, ...args] = input.trim().split(/\s+/);
  const arg = input.trim().slice(cmd.length).trim();
  switch (cmd) {
    case '/exit': case '/quit': case '/q': return false;
    case '/help': case '/?':
      for (const [c, d] of Object.entries(COMMANDS)) line(`  ${cyan(c.padEnd(10))} ${d}`);
      line(gray('  Esc stops the agent · Enter while it works queues a message · Ctrl+J or \\+Enter = new line · ↑↓ history'));
      break;
    case '/clear': case '/new':
      history = []; SYSTEM = systemPrompt(); usage.in = usage.out = usage.cache = 0;
      line(gray('  new conversation'));
      break;
    case '/model': case '/m': await chooseModel(arg); break;
    case '/think': case '/effort':
      if (!arg) { const v = await pick('effort', EFFORTS, '', (e) => (e === cfg.effort ? '●' : '')); if (v) cfg.effort = v; }
      else if (EFFORTS.includes(arg)) cfg.effort = arg;
      else { line(red(`  use one of: ${EFFORTS.join(' ')}`)); break; }
      saveCfg(); line(`${green('●')} effort ${bold(cfg.effort)}`);
      break;
    case '/fast': cfg.fast = !cfg.fast; saveCfg(); line(`${green('●')} fast mode ${cfg.fast ? 'on' : 'off'}${cur()?.type !== 'anthropic' ? gray(' (only affects Anthropic)') : ''}`); break;
    case '/safe': cfg.safe = !cfg.safe; saveCfg(); line(`${green('●')} confirm shell commands: ${cfg.safe ? 'on' : 'off'}`); break;
    case '/undo': {
      const snap = undoStack.pop();
      if (!snap) { line(gray('  nothing to undo')); break; }
      for (const [abs, data] of snap) {
        if (data === null) { try { fs.unlinkSync(abs); } catch {} } else fs.writeFileSync(abs, data);
        line(`  ${yellow('↺')} ${relp(abs)}${data === null ? gray(' (deleted)') : ''}`);
      }
      history.push({ role: 'user', text: `[the user reverted your file changes: ${[...snap.keys()].map(relp).join(', ')}]` });
      break;
    }
    case '/key': {
      const [name, key] = args;
      if (!name || !key) { line(red('  usage: /key <provider> <key>')); break; }
      cfg.providers[name] = { ...cfg.providers[name], key };
      if (!PRESETS[name] && !cfg.providers[name].url) { line(red(`  unknown provider ${name} — /provider add first`)); delete cfg.providers[name]; break; }
      saveCfg(); modelCache = null; line(`${green('●')} key saved for ${name}`);
      if (!cfg.model) await chooseModel(name + ' ');
      break;
    }
    case '/provider': case '/providers': {
      if (args[0] === 'add') {
        const [, name, url, key, type] = args;
        if (!name || !url) { line(red('  usage: /provider add <name> <base-url> [key] [openai|anthropic]')); break; }
        const t: PType = type === 'anthropic' || type === 'openai' ? type : /anthropic/.test(url) ? 'anthropic' : 'openai';
        cfg.providers[name] = { ...cfg.providers[name], type: t, url, ...(key ? { key } : {}) };
        saveCfg(); modelCache = null; line(`${green('●')} provider ${name} (${t}) ${url}`);
        await chooseModel(name + ' ');
      } else if (args[0] === 'rm') {
        delete cfg.providers[args[1]]; saveCfg(); modelCache = null; line(gray(`  removed ${args[1]}`));
      } else {
        for (const [n, p] of Object.entries(provs())) {
          const st = keyOf(p) ? green('key') : isLocal(p) ? cyan('local') : gray(p.env ? `no key ($${p.env})` : 'no key');
          line(`  ${(n === cfg.provider ? green('● ') : '  ') + n.padEnd(11)} ${gray(p.type.padEnd(9))} ${st}  ${gray(p.url)}`);
        }
      }
      break;
    }
    default: line(red(`  unknown command ${cmd} — /help`));
  }
  return true;
}

// ─── main ────────────────────────────────────────────────────────────────────
let stdinText = '';
if (!process.stdin.isTTY && (opt.print || rest.length)) stdinText = await new Promise<string>((res) => {
  let d = ''; process.stdin.setEncoding('utf8'); process.stdin.on('data', (c) => (d += c)); process.stdin.on('end', () => res(d));
});
const firstPrompt = [rest.join(' '), stdinText.trim()].filter(Boolean).join('\n\n');

if (opt.print || !process.stdin.isTTY) {
  if (!firstPrompt) { console.error('fa: no prompt'); process.exit(1); }
  if (!cfg.model) { console.error('fa: no model — pass -m provider/model or run fa once and pick one with /model'); process.exit(1); }
  process.on('SIGINT', () => ctrl ? ctrl.abort() : process.exit(130));
  await runTurn(firstPrompt);
  process.exit(0);
}

readline.emitKeypressEvents(process.stdin);
process.stdin.setRawMode(true);
process.stdin.on('keypress', (s, k) => handler?.(s, k || {}));
w('\x1b[?2004h');
const restore = () => { try { w('\x1b[?2004l\x1b[?25h'); process.stdin.setRawMode(false); } catch {} };
process.on('exit', restore);

const home = os.homedir();
const shown = ROOT.startsWith(home) ? '~' + ROOT.slice(home.length) : ROOT;
line(`${bold(magenta('fa'))} ${gray(VERSION)}  ${shown.split(path.sep).join('/')}  ${gray('/help')}`);
if (!cfg.model) {
  if (Object.values(provs()).some(usable)) await chooseModel('');
  else line(yellow('  no API keys found. Set e.g. ANTHROPIC_API_KEY / OPENROUTER_API_KEY, or /key <provider> <key>'));
}

if (firstPrompt) queue.push(firstPrompt);
handler = runKey;
for (;;) {
  let input: string | null;
  if (queue.length) { input = queue.shift()!; line(`${cyan('›')} ${input.replace(/\n/g, '\n  ')}`); if (hist[hist.length - 1] !== input) hist.push(input); }
  else input = await editor.read();
  if (input === null) break;
  if (/^\/\S/.test(input.trim()) && !input.includes('\n')) { if (!(await command(input))) break; continue; }
  await runTurn(input);
}
restore();
process.exit(0);
