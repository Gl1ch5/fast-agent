// GET /models for one provider, newest first.
import { clip } from '../ui/ansi.ts';
import { isLocal, type Prov } from '../config.ts';
import { authHeaders, base, errText } from './http.ts';

export async function listModels(p: Prov): Promise<{ id: string; created: number }[]> {
  const url = p.type === 'anthropic' ? `${base(p)}/v1/models?limit=1000` : `${base(p)}/models`;
  const res = await fetch(url, { headers: authHeaders(p), signal: AbortSignal.timeout(isLocal(p) ? 3000 : 10000) });
  if (!res.ok) throw new Error(`${res.status} ${clip(String(errText(await res.text())), 120)}`);
  const j: any = await res.json();
  const arr: any[] = j.data || j.models || [];
  return arr.map((m) => ({
    id: String(m.id ?? m.name ?? '').replace(/^models\//, ''),
    created: typeof m.created === 'number' ? m.created : m.created_at ? Date.parse(m.created_at) / 1000 : 0,
  })).filter((m) => m.id).sort((a, b) => b.created - a.created || a.id.localeCompare(b.id));
}
