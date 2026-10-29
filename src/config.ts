// ~/.fa/config.json and provider presets.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { opt } from './env.ts';

export type PType = 'openai' | 'anthropic';
export interface Prov { type: PType; url: string; key?: string; env?: string; headers?: Record<string, string> }
export interface Cfg {
  provider: string; model: string; effort: string; fast: boolean; safe: boolean;
  maxTokens?: number; providers: Record<string, Partial<Prov>>;
  models: string[];        // "provider/model" labels picked during setup — what /model offers
  setupDone: boolean;
  latest?: string; lastCheck?: number;
}

export const PRESETS: Record<string, Prov> = {
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
export const DEFAULT_MODEL: Record<string, string> = { anthropic: 'claude-opus-5-5' };
export const EFFORTS: [string, string][] = [
  ['auto', 'provider default'],
  ['low', 'fastest, minimal reasoning'],
  ['medium', 'balanced'],
  ['high', 'deeper reasoning'],
  ['xhigh', 'extra deep (Anthropic)'],
  ['max', 'maximum reasoning, slowest'],
];

const CFG_DIR = process.env.FA_HOME || path.join(os.homedir(), '.fa');
const CFG_FILE = path.join(CFG_DIR, 'config.json');
export const cfg: Cfg = { provider: '', model: '', effort: 'auto', fast: false, safe: false, providers: {}, models: [], setupDone: false };
try { Object.assign(cfg, JSON.parse(fs.readFileSync(CFG_FILE, 'utf8'))); } catch {}
if (!Array.isArray(cfg.models)) cfg.models = [];
// configs from 0.1 already have a model: treat them as set up
if (!cfg.models.length && cfg.provider && cfg.model) { cfg.models = [`${cfg.provider}/${cfg.model}`]; cfg.setupDone = true; }

export function saveCfg(): string | null {
  try {
    fs.mkdirSync(CFG_DIR, { recursive: true });
    fs.writeFileSync(CFG_FILE, JSON.stringify(cfg, null, 2), { mode: 0o600 });
    return null;
  } catch (e: any) { return `can't save config: ${e.message}`; }
}

export function provs(): Record<string, Prov> {
  const out: Record<string, Prov> = {};
  for (const n of new Set([...Object.keys(PRESETS), ...Object.keys(cfg.providers)]))
    out[n] = { ...PRESETS[n], ...cfg.providers[n] } as Prov;
  return out;
}
export const keyOf = (p: Prov) => p.key || (p.env ? process.env[p.env] : '') || '';
export const isLocal = (p: Prov) => /\/\/(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(p.url || '');
export const usable = (p: Prov) => !!p.url && (!!keyOf(p) || isLocal(p));

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

export const cur = () => provs()[cfg.provider];
export const modelLabel = () => (cfg.provider && cfg.model ? `${cfg.provider}/${cfg.model}` : 'no model');
