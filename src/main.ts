#!/usr/bin/env node
// fa — fast agent. Entry point: print mode (-p / pipes) or the full-screen TUI.
import { opt, rest } from './env.ts';
import { cfg } from './config.ts';
import { accent, bold, gray, green, yellow } from './ui/ansi.ts';
import { line, gap } from './ui/screen.ts';
import { editor, queue, hist } from './ui/input.ts';
import { startTui, leaveTui } from './ui/tui.ts';
import { welcome, banner } from './ui/welcome.ts';
import { conv, agent } from './agent/state.ts';
import { runTurn } from './agent/loop.ts';
import { systemPrompt } from './prompt.ts';
import { command } from './commands.ts';
import { setup, signIn } from './setup.ts';
import { update, checkUpdates } from './update.ts';
import { pull, flushSync } from './sync.ts';

conv.system = systemPrompt();

if (opt.update) { await update(); process.exit(0); }

let stdinText = '';
if (!process.stdin.isTTY && (opt.print || rest.length)) stdinText = await new Promise<string>((res) => {
  let d = ''; process.stdin.setEncoding('utf8'); process.stdin.on('data', (c) => (d += c)); process.stdin.on('end', () => res(d));
});
const firstPrompt = [rest.join(' '), stdinText.trim()].filter(Boolean).join('\n\n');

if (opt.print || !process.stdin.isTTY || !process.stdout.isTTY) {
  if (!firstPrompt) { console.error('fa: no prompt'); process.exit(1); }
  if (!cfg.model) { console.error('fa: no model — pass -m provider/model or run fa once to set it up'); process.exit(1); }
  process.on('SIGINT', () => (agent.ctrl ? agent.ctrl.abort() : process.exit(130)));
  await runTurn(firstPrompt);
  process.exit(0);
}

startTui();
banner();
checkUpdates();
if (cfg.sync) pull().then((got) => { if (got) line(gray(`settings synced from ${cfg.sync!.user}`), { mark: green('↓ '), ind: 2 }); }, (e) => line(yellow(`sync: ${e.message}`), { ind: 2 }));
if (!cfg.setupDone) {
  const w = await welcome();
  if (w === 'login' && (await signIn(0)) && cfg.setupDone) line(`${bold('Ready')}  ${gray('/model to switch')}`, { mark: green('✓ '), ind: 2 });
  else if (w) await setup(true);
  else line(gray('setup skipped — run /setup any time'), { ind: 2 });
}

if (firstPrompt) queue.push(firstPrompt);
for (;;) {
  const input = queue.length ? queue.shift()! : await editor.read();
  if (input === null) break;
  if (hist[hist.length - 1] !== input) hist.push(input);
  const isCmd = /^\/\S/.test(input.trim()) && !input.includes('\n');
  gap();
  line(isCmd ? gray(input) : input.trim(), { mark: accent('› '), ind: 2, kind: 'user' });
  if (isCmd) { if (!(await command(input))) break; continue; }
  await runTurn(input);
}
leaveTui();
await flushSync();
process.exit(0);
