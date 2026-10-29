// OpenAI-compatible /chat/completions (streaming tool calls, reasoning text).
import { cfg, type Prov } from '../config.ts';
import { TOOLS } from '../tools/index.ts';
import { conv, usage, agent, type Turn } from '../agent/state.ts';
import { onText, onThink, toolProgress, parseArgs } from '../agent/stream.ts';
import { post, sse, authHeaders, base } from './http.ts';

export async function callOpenAI(p: Prov, sig: AbortSignal, acc: Turn) {
  const msgs: any[] = [{ role: 'system', content: conv.system }];
  for (const m of conv.history) {
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
      usage.last = ch.usage.prompt_tokens || usage.last; usage.in += ch.usage.prompt_tokens || 0; usage.out += ch.usage.completion_tokens || 0; usage.cache += c;
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
      if (tc.function?.arguments) { s.args += tc.function.arguments; agent.chars += tc.function.arguments.length; }
      toolProgress(s.name, s.args);
    }
    if (choice.finish_reason) acc.stop = choice.finish_reason;
  }
  slots.filter(Boolean).forEach((s, i) => acc.calls.push({ id: s.id || `call_${Date.now()}_${i}`, name: s.name, ...parseArgs(s.name, s.args, acc.stop === 'length') }));
}
