// HTTP plumbing shared by the API clients: SSE parsing, retries, auth headers.
import { clip } from '../ui/ansi.ts';
import { spin } from '../ui/screen.ts';
import { sleep } from '../util.ts';
import { keyOf, type Prov } from '../config.ts';

export async function* sse(res: Response): AsyncGenerator<any> {
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

export function errText(t: string) {
  try { const j = JSON.parse(t); return j.error?.message || j.message || j.error || t; } catch { return t.slice(0, 500); }
}

export async function post(url: string, headers: Record<string, string>, body: any, sig: AbortSignal): Promise<Response> {
  for (let a = 0; ; a++) {
    let res: Response;
    try {
      res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: sig });
    } catch (e: any) {
      if (sig.aborted) throw e;
      if (a >= 3) throw new Error(`${e.message}${e.cause ? ': ' + (e.cause.code || e.cause.message) : ''} (${url})`);
      spin.start(`Network error, retry ${a + 1}/3`); await sleep(1000 * 2 ** a, sig); continue;
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

export function authHeaders(p: Prov): Record<string, string> {
  const k = keyOf(p);
  if (p.type === 'anthropic') return { ...(k ? { 'x-api-key': k } : {}), 'anthropic-version': '2023-06-01', ...p.headers };
  return { ...(k ? { authorization: `Bearer ${k}` } : {}), ...p.headers };
}
export const base = (p: Prov) => p.url.replace(/\/+$/, '');
