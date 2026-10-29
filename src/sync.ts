// Account sync: providers, keys, models and preferences follow you to every machine.
// Sign in with a login and password once per machine; after that every change is uploaded
// and newer settings are downloaded at start.
import crypto from 'node:crypto';
import { cfg, saveCfg, type Cfg } from './config.ts';
import { opt } from './env.ts';

export const SYNC_URL = process.env.FA_SYNC_URL || 'https://grzxk.ru/fa-sync';
// what is synced; everything else (update checks, the account itself) stays local
const SYNCED = ['provider', 'model', 'effort', 'fast', 'safe', 'maxTokens', 'providers', 'models'] as const;

const syncUrl = () => (cfg.sync?.url || SYNC_URL).replace(/\/+$/, '');
const subset = () => JSON.stringify(Object.fromEntries(SYNCED.map((k) => [k, cfg[k]])));
const digest = (s: string) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 32);

async function api(method: string, p: string, body?: any, url = syncUrl()): Promise<any> {
  const s = cfg.sync;
  const res = await fetch(url + p, {
    method, signal: AbortSignal.timeout(10000),
    headers: { 'content-type': 'application/json', ...(s?.token ? { authorization: `Bearer ${s.user}:${s.token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const j: any = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(j.error || `sync server: ${res.status}`), { status: res.status });
  return j;
}

// apply the synced fields of `d`; command-line -m / -e still win for this run
function apply(d: Partial<Cfg>) {
  const skip = [...(opt.model ? ['provider', 'model'] : []), ...(opt.effort ? ['effort'] : [])];
  for (const k of SYNCED) if (d[k] !== undefined && !skip.includes(k)) (cfg as any)[k] = d[k];
  if (!Array.isArray(cfg.models)) cfg.models = [];
  if (cfg.models.length && cfg.model) cfg.setupDone = true;
}

// 'pulled' = settings came from the account, 'pushed' = this machine's settings were uploaded
export async function login(user: string, pass: string, create: boolean, url = SYNC_URL): Promise<'pulled' | 'pushed'> {
  const r = await api('POST', create ? '/register' : '/login', { user, pass }, url.replace(/\/+$/, ''));
  cfg.sync = { user: r.user, token: r.token, at: 0, hash: '', ...(url !== SYNC_URL ? { url } : {}) };
  const remote = await api('GET', '/data');
  let how: 'pulled' | 'pushed' = 'pushed';
  if (remote.data) {
    const d: Partial<Cfg> = remote.data;
    if (cfg.setupDone) {
      // first sign-in on a configured machine: keep both sides
      d.providers = { ...cfg.providers, ...d.providers };
      d.models = [...new Set([...(d.models || []), ...cfg.models])];
    }
    apply(d);
    how = 'pulled';
  }
  saveCfg();
  await push(true);
  return how;
}

export async function logout() {
  try { await api('POST', '/logout'); } catch {}
  delete cfg.sync; saveCfg();
}

// download newer settings; true when something changed
export async function pull(): Promise<boolean> {
  const s = cfg.sync;
  if (!s?.token) return false;
  const r = await api('GET', '/data');
  if (!r.data || r.updated <= s.at) return false;
  const before = subset();
  apply(r.data);
  s.at = r.updated; s.hash = digest(subset());
  saveCfg();
  return before !== subset();
}

// upload when the synced fields changed since the last sync
export async function push(force = false) {
  const s = cfg.sync;
  if (!s?.token) return;
  const text = subset(), h = digest(text);
  if (!force && h === s.hash) return;
  const r = await api('PUT', '/data', { data: JSON.parse(text) });
  s.at = r.updated; s.hash = h;
  saveCfg();
}

let timer: ReturnType<typeof setTimeout> | null = null;
let pending: Promise<void> | null = null;
export const syncState = { error: '' };

// called by saveCfg: push a moment later, so a burst of changes is one upload
export function schedulePush() {
  if (!cfg.sync?.token || digest(subset()) === cfg.sync.hash) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    pending = push().then(() => { syncState.error = ''; }, (e) => { syncState.error = e.message; }).finally(() => { pending = null; });
  }, 800);
}

// before exit: send what is still waiting (at most a few seconds)
export async function flushSync() {
  if (timer) { clearTimeout(timer); timer = null; pending = push().catch(() => {}); }
  if (pending) await Promise.race([pending, new Promise((r) => setTimeout(r, 4000))]);
}
