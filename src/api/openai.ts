// OpenAI-compatible /chat/completions (streaming tool calls, reasoning text).
// Reasoning arrives as reasoning_content / reasoning / reasoning_details, or inside the text as
// <think>…</think> or Gemini's <thought>…</thought>; all of it is shown as thinking.
import { cfg, type Prov } from '../config.ts';
import { TOOLS } from '../tools/index.ts';
import { conv, usage, agent, type Turn } from '../agent/state.ts';
import { onThink, toolProgress, parseArgs, thinkTags } from '../agent/stream.ts';
import { post, sse, authHeaders, base } from './http.ts';

// OmniRoute (self-hosted gateway): known by its port or name, or by x-omniroute-* response headers
const omni = new Set<string>();
const isOmni = (p: Prov) => /omniroute|:20128\b/i.test(p.url) || omni.has(p.url);
// the first set of reasoning options a provider+model accepted (index into the tries below)
const accepted = new Map<string, number>();

export async function callOpenAI(p: Prov, sig: AbortSignal, acc: Turn) {
  const msgs: any[] = [{ role: 'system', content: conv.system }];
  for (const m of conv.history) {
    if (m.role === 'user') msgs.push({ role: 'user', content: m.text });
    else if (m.role === 'tool') msgs.push({ role: 'tool', tool_call_id: m.id, content: m.text || '(no output)' });
    else msgs.push({
      role: 'assistant', content: m.text || (m.calls.length ? null : '(no response)'),
      ...(m.calls.length ? { tool_calls: m.calls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args ?? {}) }, ...(c.extra ? { extra_content: c.extra } : {}) })) } : {}),
    });
  }
  const body: any = {
    model: cfg.model, stream: true, messages: msgs, stream_options: { include_usage: true },
    tools: TOOLS.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.schema } })),
  };
  if (cfg.maxTokens) body.max_tokens = cfg.maxTokens;
  // OpenAI takes low/medium/high; DeepSeek and OmniRoute also take max (a rejection falls back below)
  const effort = cfg.effort === 'auto' ? '' : ['xhigh', 'max'].includes(cfg.effort) && !isOmni(p) && !/deepseek/i.test(p.url) ? 'high' : cfg.effort;
  // ask for the reasoning text where the provider hides it by default
  const extra: any = {};
  if (/generativelanguage\.googleapis/.test(p.url)) extra.extra_body = { google: { thinking_config: { include_thoughts: true } } };
  if (/openrouter\.ai/.test(p.url)) extra.reasoning = effort ? { effort } : { enabled: true };
  else if (effort) extra.reasoning_effort = effort;
  if (isOmni(p)) {
    // Claude behind OmniRoute: readable (summarized) thinking instead of redacted, and thinking
    // on even with effort auto; Gemini behind it gets includeThoughts from OmniRoute itself
    extra._omnirouteCopilotReasoningSummary = 'summarized';
    if (!effort) extra.thinking = { type: 'adaptive' };
  }
  // a server that rejects the reasoning options gets the request with fewer of them, then none
  const { thinking, reasoning_effort, ...rest } = extra;
  const high = effort === 'max' || effort === 'xhigh' ? [{ ...extra, reasoning_effort: 'high' }] : [];
  const tries = [extra, ...high, rest, {}].filter((x, i, a) => i === 0 || x === high[0] || Object.keys(x).length < Object.keys(a[i - 1]).length);
  const key = `${p.url} ${cfg.model}`;
  let res!: Response;
  for (let n = Math.min(accepted.get(key) ?? 0, tries.length - 1); ; n++) {
    try { res = await post(`${base(p)}/chat/completions`, authHeaders(p), { ...body, ...tries[n] }, sig); accepted.set(key, n); break; }
    catch (e: any) { if (sig.aborted || n === tries.length - 1 || !/^4\d\d/.test(e.message)) throw e; }
  }
  if ([...res.headers.keys()].some((k) => k.startsWith('x-omniroute'))) omni.add(p.url);
  const tags = thinkTags();
  const slots: { id: string; name: string; args: string; extra?: any }[] = [];
  for await (const ch of sse(res)) {
    if (ch.error) throw new Error(ch.error.message || JSON.stringify(ch.error));
    if (ch.usage) {
      const c = ch.usage.prompt_tokens_details?.cached_tokens || ch.usage.prompt_cache_hit_tokens || 0;
      usage.last = ch.usage.prompt_tokens || usage.last; usage.in += ch.usage.prompt_tokens || 0; usage.out += ch.usage.completion_tokens || 0; usage.cache += c;
    }
    const choice = ch.choices?.[0];
    if (!choice) continue;
    const d = choice.delta || {};
    let think = d.reasoning_content ?? d.reasoning ?? d.reasoning_text ?? d.thinking;
    if (typeof think !== 'string' && Array.isArray(d.reasoning_details)) think = d.reasoning_details.map((r: any) => r.text || r.summary || '').join('');
    if (typeof think === 'string' && think) onThink(think);
    if (typeof d.content === 'string' && d.content) acc.text += tags.feed(d.content);
    for (const tc of d.tool_calls || []) {
      // no index, or every call at index 0 (Gemini): the same id continues a call, a new id starts one
      const byId = () => (tc.id ? (slots.findIndex((x) => x?.id === tc.id) + 1 || slots.length + 1) - 1 : Math.max(0, slots.length - 1));
      const i = typeof tc.index === 'number' && !(tc.id && slots[tc.index]?.id && slots[tc.index].id !== tc.id) ? tc.index : byId();
      const s = (slots[i] ||= { id: '', name: '', args: '' });
      if (tc.extra_content) s.extra = tc.extra_content;
      if (tc.id) s.id = tc.id;
      if (tc.function?.name) s.name = tc.function.name;
      if (tc.function?.arguments) { s.args += tc.function.arguments; agent.chars += tc.function.arguments.length; }
      toolProgress(s.name, s.args);
    }
    if (choice.finish_reason) acc.stop = choice.finish_reason;
  }
  acc.text += tags.flush();
  slots.filter(Boolean).forEach((s, i) => acc.calls.push({ id: s.id || `call_${Date.now()}_${i}`, name: s.name, ...parseArgs(s.name, s.args, acc.stop === 'length'), ...(s.extra ? { extra: s.extra } : {}) }));
}
