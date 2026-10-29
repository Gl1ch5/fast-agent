// Process environment: platform flags, CLI arguments, working directory.
import fs from 'node:fs';
import path from 'node:path';
import { VERSION } from './version.ts';

export const IS_WIN = process.platform === 'win32';
export const TTY = !!process.stdout.isTTY;
export const w = (s: string) => process.stdout.write(s);

export const HELP = `fa ${VERSION} — fast one-file coding agent

usage: fa [options] [prompt]
  -p, --print          run the prompt non-interactively and exit
  -m, --model P/M      provider/model, e.g. anthropic/claude-opus-5-5
  -e, --effort LVL     auto | low | medium | high | xhigh | max
  -C, --cwd DIR        working directory (the agent is locked inside it)
      --safe           ask before every shell command
      --update         update fa to the latest version and exit
  -h, --help           this help

in the app: / shows commands, /setup configures providers and models,
Esc stops the agent, Ctrl+J or "\\" + Enter = new line`;

export const opt = { print: false, model: '', cwd: '', effort: '', safe: false, update: false };
export const rest: string[] = [];
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a === '-p' || a === '--print') opt.print = true;
  else if (a === '-m' || a === '--model') opt.model = process.argv[++i] ?? '';
  else if (a === '-e' || a === '--effort') opt.effort = process.argv[++i] ?? '';
  else if (a === '-C' || a === '--cwd') opt.cwd = process.argv[++i] ?? '';
  else if (a === '--safe') opt.safe = true;
  else if (a === '--update' || a === '--upgrade') opt.update = true;
  else if (a === '-h' || a === '--help') { console.log(HELP); process.exit(0); }
  else if (a === '-v' || a === '--version') { console.log(VERSION); process.exit(0); }
  else rest.push(a);
}

export const ROOT = fs.realpathSync(path.resolve(opt.cwd || process.cwd()));
process.chdir(ROOT);
