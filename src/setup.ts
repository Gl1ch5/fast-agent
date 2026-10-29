// Setup wizard and model switching: provider → key → models (pick a few) → effort.
import { cfg, saveCfg, provs, keyOf, isLocal, usable, DEFAULT_MODEL, EFFORTS, modelLabel, type PType } from './config.ts';
import { accent, bold, gray, green, red, yellow, clip } from './ui/ansi.ts';
import { line, gap } from './ui/screen.ts';
import { pick, ask, loading, type Item } from './ui/modal.ts';
import { listModels } from './api/models.ts';
import { login } from './sync.ts';

const STEPS = ['Provider', 'Models', 'Effort'];
const stepLine = (i: number) => (i < 0 ? '' : STEPS.map((s, j) => (j < i ? green('● ') + gray(s) : j === i ? accent('● ') + bold(s) : gray('○ ' + s))).join(gray('  ─  ')));

export function saved() { const e = saveCfg(); if (e) line(red(e), { ind: 2 }); }

export function setModel(label: string, quiet = false) {
  const i = label.indexOf('/');
  cfg.provider = label.slice(0, i); cfg.model = label.slice(i + 1);
  if (!cfg.models.includes(label)) cfg.models.push(label);
  saved();
  if (!quiet) line(`model ${bold(modelLabel())}`, { mark: green('✓ '), ind: 2 });
}

function provHint(n: string) {
  const p = provs()[n];
  if (isLocal(p)) return 'local';
  if (p.key) return '✓ key saved';
  if (keyOf(p)) return `✓ key from $${p.env}`;
  return p.env ? `needs key ($${p.env})` : 'needs key';
}

export async function chooseProvider(step = -1): Promise<string | null> {
  const ps = provs();
  const names = Object.keys(ps).sort((a, b) => Number(usable(ps[b])) - Number(usable(ps[a])));
  const items: Item[] = names.map((n) => ({ value: n, label: n, hint: provHint(n), tag: n === cfg.provider ? green('●') : '' }));
  items.push({ value: '+', label: '+ custom provider', hint: 'any OpenAI- or Anthropic-compatible API' });
  const v = await pick({ title: 'Provider', step: stepLine(step), desc: 'Where should fa send requests?', initial: cfg.provider, full: step >= 0 }, items);
  if (!v) return null;
  if (v === '+') return customProvider(step);
  const p = ps[v];
  if (!keyOf(p) && !isLocal(p)) {
    const k = await ask({ title: `${v} · API key`, step: stepLine(step), full: step >= 0, mask: true,
      desc: `Paste your ${v} API key. It is stored in ~/.fa/config.json.${p.env ? `\nOr set $${p.env} and restart.` : ''}` });
    if (!k) return null;
    cfg.providers[v] = { ...cfg.providers[v], key: k }; saved();
  }
  return v;
}

async function customProvider(step: number): Promise<string | null> {
  const full = step >= 0, st = stepLine(step);
  const name = (await ask({ title: 'Custom provider', step: st, full, desc: 'Short name for this provider', placeholder: 'my-server' }))?.replace(/[\s/]+/g, '-');
  if (!name) return null;
  const url = await ask({ title: 'Custom provider', step: st, full, desc: 'Base URL', placeholder: 'http://localhost:8080/v1  or  https://api.example.com' });
  if (!url) return null;
  const type: PType | null = await pick({ title: 'API format', step: st, full, search: false }, [
    { value: 'openai', label: 'OpenAI-compatible', hint: '/chat/completions' },
    { value: 'anthropic', label: 'Anthropic-compatible', hint: '/v1/messages' },
  ]);
  if (!type) return null;
  const key = await ask({ title: 'API key', step: st, full, mask: true, allowEmpty: true, desc: 'Leave empty if the server needs no key' });
  if (key === null) return null;
  cfg.providers[name] = { ...cfg.providers[name], type, url, ...(key ? { key } : {}) };
  saved();
  return name;
}

// pick the models of one provider that /model will offer
export async function chooseModelsFor(name: string, step = -1): Promise<boolean> {
  const p = provs()[name];
  const full = step >= 0, st = stepLine(step);
  let ids: string[] = [], err = '';
  try { ids = (await loading(name, `Loading models from ${name}…`, listModels(p))).map((m) => m.id); }
  catch (e: any) { err = e.name === 'TimeoutError' ? 'timeout' : e.message; }
  let chosen: string[] | null;
  if (!ids.length) {
    const v = await ask({ title: `Models · ${name}`, step: st, full,
      desc: `${err ? red(clip(err, 200)) + '\n' : ''}Couldn't list models. Enter model id(s), comma-separated.`, initial: DEFAULT_MODEL[name] || '' });
    chosen = v ? v.split(/[,\s]+/).filter(Boolean) : null;
  } else {
    const pre = cfg.models.filter((m) => m.startsWith(name + '/')).map((m) => m.slice(name.length + 1));
    if (!pre.length && DEFAULT_MODEL[name] && ids.includes(DEFAULT_MODEL[name])) pre.push(DEFAULT_MODEL[name]);
    // models already in /model come first, so adding one more is a single tick
    const sorted = [...ids.filter((id) => pre.includes(id)), ...ids.filter((id) => !pre.includes(id))];
    chosen = await pick({ title: `Models · ${name}`, step: st, full, multi: true, selected: pre, initial: pre[0],
      desc: `${ids.length} models available. Tick the ones you want in /model, untick to remove.` }, sorted);
  }
  if (!chosen || !chosen.length) return false;
  const labels = chosen.map((id) => `${name}/${id}`);
  cfg.models = [...cfg.models.filter((m) => !m.startsWith(name + '/')), ...labels];
  const curLabel = `${cfg.provider}/${cfg.model}`;
  if (labels.includes(curLabel)) { saved(); return true; }
  const def = labels.length === 1 ? labels[0] : await pick({ title: 'Default model', step: st, full, search: false, desc: 'Which one should fa use now?' }, labels);
  setModel(def || labels[0], true);
  return true;
}

export async function chooseEffort(step = -1): Promise<boolean> {
  const v = await pick({ title: 'Reasoning effort', step: stepLine(step), full: step >= 0, search: false, initial: cfg.effort,
    desc: 'How hard should the model think? Change any time with /think.' },
  EFFORTS.map(([e, d]) => ({ value: e, label: e, hint: d, tag: e === cfg.effort ? green('●') : '' })));
  if (!v) return false;
  cfg.effort = v; saved();
  return true;
}

export async function setup(first = false): Promise<boolean> {
  const name = await chooseProvider(0);
  if (!name || !(await chooseModelsFor(name, 1))) { if (first) line(yellow('setup skipped — run /setup any time'), { ind: 2 }); return false; }
  await chooseEffort(2);
  cfg.setupDone = true; saved();
  gap();
  line(`${bold('Ready')}  ${modelLabel()} ${gray('· effort ' + cfg.effort)}`, { mark: green('✓ '), ind: 2 });
  line(gray(`models: ${cfg.models.join(', ')}  ·  /model to switch, /models to add more`), { ind: 2 });
  return true;
}

export async function manageModels() {
  const n = await chooseProvider();
  if (n && (await chooseModelsFor(n))) line(`models: ${cfg.models.join(', ')}`, { mark: green('✓ '), ind: 2 });
}

export async function chooseModel(query: string) {
  const q = query.trim();
  if (q.includes('/') && !/\s/.test(q) && provs()[q.slice(0, q.indexOf('/'))] && !q.endsWith('/')) return setModel(q);
  const curLabel = `${cfg.provider}/${cfg.model}`;
  const labels = [...cfg.models];
  if (cfg.model && !labels.includes(curLabel)) labels.unshift(curLabel);
  if (!labels.length) return manageModels();
  const items: Item[] = labels.map((l) => ({ value: l, label: l, tag: l === curLabel ? green('●') : '' }));
  items.push({ value: '+', label: '+ add or remove models…' });
  const v = await pick({ title: 'Model', query: q, initial: curLabel, search: true }, items);
  if (v === '+') return manageModels();
  if (v) setModel(v);
}

export async function chooseKey() {
  const ps = provs();
  const n = await pick({ title: 'API key', desc: 'Which provider?' }, Object.keys(ps).map((k) => ({ value: k, label: k, hint: provHint(k) })));
  if (!n) return;
  const k = await ask({ title: `${n} · API key`, mask: true, desc: `Paste your ${n} API key` });
  if (!k) return;
  cfg.providers[n] = { ...cfg.providers[n], key: k }; saved();
  line(`key saved for ${n}`, { mark: green('✓ '), ind: 2 });
}

// sign in (or create an account) and sync settings; true when signed in
export async function signIn(step = -1, arg = ''): Promise<boolean> {
  const full = step >= 0;
  const desc = 'Your providers, API keys, models and preferences are kept on the sync server\nand appear on every machine where you sign in.';
  const user = arg || (await ask({ title: 'Account · login', full, desc, initial: cfg.sync?.user || '' }));
  if (!user) return false;
  const pass = await ask({ title: 'Account · password', full, mask: true, desc: `Password for ${bold(user)}` });
  if (!pass) return false;
  let how: 'pulled' | 'pushed';
  try { how = await loading('Account', 'Signing in…', login(user, pass, false)); }
  catch (e: any) {
    if (e.status !== 404) { line(red(`sign-in failed: ${e.message}`), { mark: red('✗ '), ind: 2 }); return false; }
    const again = await ask({ title: 'New account', full, mask: true, desc: `There is no account ${bold(user)} yet.\nType the password again to create it.` });
    if (!again) return false;
    if (again !== pass) { line(red('passwords do not match'), { mark: red('✗ '), ind: 2 }); return false; }
    try { how = await loading('Account', 'Creating account…', login(user, pass, true)); }
    catch (e2: any) { line(red(`could not create the account: ${e2.message}`), { mark: red('✗ '), ind: 2 }); return false; }
  }
  line(`signed in as ${bold(user)} · ${how === 'pulled' ? 'settings loaded from your account' : 'settings uploaded to your account'}`, { mark: green('✓ '), ind: 2 });
  if (cfg.setupDone) line(gray(`${modelLabel()} · models: ${cfg.models.join(', ') || 'none'}`), { ind: 2, clip: true });
  return true;
}
