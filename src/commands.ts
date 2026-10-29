// Slash commands. COMMANDS drives both /help and the suggestion popup.
import fs from 'node:fs';
import { cfg, provs, keyOf, isLocal, cur, EFFORTS, type PType } from './config.ts';
import { accent, bold, cyan, gray, green, red, yellow, pad } from './ui/ansi.ts';
import { line, gap, log, ui, req } from './ui/screen.ts';
import { pick, confirm } from './ui/modal.ts';
import { banner } from './ui/welcome.ts';
import { conv, usage } from './agent/state.ts';
import { systemPrompt } from './prompt.ts';
import { undoStack, relp } from './tools/sandbox.ts';
import { saved, setup, chooseModel, manageModels, chooseModelsFor, chooseKey } from './setup.ts';
import { update, restart } from './update.ts';

export const COMMANDS: [string, string][] = [
  ['/model', 'switch model'],
  ['/models', 'add or remove models'],
  ['/setup', 'set up provider, models and effort'],
  ['/think', 'reasoning effort: auto · low · medium · high · xhigh · max'],
  ['/fast', 'toggle Anthropic fast mode'],
  ['/provider', 'list providers · add <name> <url> [key] [openai|anthropic] · rm <name>'],
  ['/key', 'set an API key'],
  ['/safe', 'ask before every shell command'],
  ['/undo', 'revert file changes from the last request'],
  ['/clear', 'start a new conversation'],
  ['/update', 'update fa to the latest version'],
  ['/help', 'commands and keys'],
  ['/exit', 'quit'],
];

const ok = (s: string) => line(s, { mark: green('✓ '), ind: 2 });
// false = quit
export async function command(input: string): Promise<boolean> {
  const [cmd, ...args] = input.trim().split(/\s+/);
  const arg = input.trim().slice(cmd.length).trim();
  switch (cmd) {
    case '/exit': case '/quit': case '/q': return false;
    case '/help': case '/?':
      gap();
      for (const [c, d] of COMMANDS) line(`${pad(accent(c), 11)} ${d}`, { ind: 2 });
      line(gray('Esc stops the agent · Enter while it works queues a message · Ctrl+J or \\+Enter = new line'), { ind: 2 });
      line(gray('↑↓ history · Tab completes a command · mouse wheel, PgUp/PgDn or Shift+↑↓ scroll · Shift+drag selects text · Ctrl+L redraw · Ctrl+C ×2 quit'), { ind: 2 });
      break;
    case '/clear': case '/new':
      conv.history = []; conv.system = systemPrompt(); usage.in = usage.out = usage.cache = 0;
      log.length = 0; ui.scroll = 0; banner();
      line(gray('new conversation'), { ind: 2 });
      break;
    case '/model': case '/m': await chooseModel(arg); break;
    case '/models': await manageModels(); break;
    case '/setup': await setup(); break;
    case '/think': case '/effort': {
      let v: string | null = arg;
      if (!v) v = await pick({ title: 'Reasoning effort', search: false, initial: cfg.effort },
        EFFORTS.map(([e, d]) => ({ value: e, label: e, hint: d, tag: e === cfg.effort ? green('●') : '' })));
      if (!v) break;
      if (!EFFORTS.some(([e]) => e === v)) { line(red(`use one of: ${EFFORTS.map(([e]) => e).join(' ')}`), { ind: 2 }); break; }
      cfg.effort = v; saved(); ok(`effort ${bold(cfg.effort)}`);
      break;
    }
    case '/fast': cfg.fast = !cfg.fast; saved(); ok(`fast mode ${cfg.fast ? 'on' : 'off'}${cur()?.type !== 'anthropic' ? gray(' (only affects Anthropic)') : ''}`); break;
    case '/safe': cfg.safe = !cfg.safe; saved(); ok(`confirm shell commands: ${cfg.safe ? 'on' : 'off'}`); break;
    case '/undo': {
      const snap = undoStack.pop();
      if (!snap) { line(gray('nothing to undo'), { ind: 2 }); break; }
      for (const [abs, data] of snap) {
        if (data === null) { try { fs.unlinkSync(abs); } catch {} } else fs.writeFileSync(abs, data);
        line(`${relp(abs)}${data === null ? gray(' (deleted)') : ''}`, { mark: yellow('↺ '), ind: 2 });
      }
      conv.history.push({ role: 'user', text: `[the user reverted your file changes: ${[...snap.keys()].map(relp).join(', ')}]` });
      break;
    }
    case '/key': {
      const [name, key] = args;
      if (!name) { await chooseKey(); break; }
      if (!key) { line(red('usage: /key <provider> <key>'), { ind: 2 }); break; }
      if (!provs()[name]) { line(red(`unknown provider ${name} — /provider add first`), { ind: 2 }); break; }
      cfg.providers[name] = { ...cfg.providers[name], key };
      saved(); ok(`key saved for ${name}`);
      break;
    }
    case '/provider': case '/providers': {
      if (args[0] === 'add') {
        const [, name, url, key, type] = args;
        if (!name || !url) { line(red('usage: /provider add <name> <base-url> [key] [openai|anthropic]'), { ind: 2 }); break; }
        const t: PType = type === 'anthropic' || type === 'openai' ? type : /anthropic/.test(url) ? 'anthropic' : 'openai';
        cfg.providers[name] = { ...cfg.providers[name], type: t, url, ...(key ? { key } : {}) };
        saved(); ok(`provider ${name} (${t}) ${url}`);
        await chooseModelsFor(name);
      } else if (args[0] === 'rm') {
        delete cfg.providers[args[1]];
        cfg.models = cfg.models.filter((m) => !m.startsWith(args[1] + '/'));
        saved(); line(gray(`removed ${args[1]}`), { ind: 2 });
      } else {
        gap();
        for (const [n, p] of Object.entries(provs())) {
          const st = keyOf(p) ? green('key') : isLocal(p) ? cyan('local') : gray(p.env ? `no key ($${p.env})` : 'no key');
          line(`${(n === cfg.provider ? green('● ') : '  ') + n.padEnd(11)} ${gray(p.type.padEnd(9))} ${st}  ${gray(p.url)}`, { ind: 2, clip: true });
        }
        line(gray('/setup or /models to pick models · /provider add <name> <url> [key] [openai|anthropic]'), { ind: 2 });
      }
      break;
    }
    case '/update': case '/upgrade':
      if (await update()) { if (await confirm('Restart fa now to use the new version?', 'Restart now', 'Later')) restart(); }
      break;
    default: line(red(`unknown command ${cmd} — type / to see commands`), { ind: 2 });
  }
  req();
  return true;
}
