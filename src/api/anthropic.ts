// Anthropic Messages API (streaming, prompt caching, adaptive thinking, fast mode).
import { cfg, type Prov } from '../config.ts';
import { yellow } from '../ui/ansi.ts';
import { line } from '../ui/screen.ts';
import { TOOLS } from '../tools/index.ts';
import { conv, usage, agent, type Turn } from '../agent/state.ts';
import { onText, onThink, toolProgress, parseArgs } from '../agent/stream.ts';
import { post, sse, authHeaders, base } from './http.ts';

export async function callAnthropic(p: Prov, sig: AbortSignal, acc: Turn) {
  const official = /api\.anthropic\.com/.test(p.url);
  const msgs: any[] = [];
  const push = (role: string, blocks: any[]) => {
    const last = msgs[msgs.length - 1];
    if (last && last.role === role && role === 'user') last.content.push(...blocks); else msgs.push({ role, content: blocks });
  };
  for (const m of conv.history) {
    if (m.role === 'user') push('user', [{ type: 'text', text: m.text }]);
    else if (m.role === 'tool') push('user', [{ type: 'tool_result', tool_use_id: m.id, content: m.text || '(no output)', ...(m.err ? { is_error: true } : {}) }]);
    else {
      let blocks = m.blocks && m.prov === cfg.provider ? m.blocks : [
        ...(m.text ? [{ type: 'text', text: m.text }] : []),
        ...m.calls.map((c) => ({ type: 'tool_use', id: c.id, name: c.name, input: c.args ?? {} })),
      ];
      if (!blocks.length) blocks = [{ type: 'text', text: '(no response)' }];
      msgs.push({ role: 'assistant', content: blocks });
    }
  }
  // cache breakpoints: system (+tools before it) and the newest message
  const last = msgs[msgs.length - 1];
  if (last) { const lb = last.content.length - 1; last.content[lb] = { ...last.content[lb], cache_control: { type: 'ephemeral' } }; }
  const body: any = {
    model: cfg.model, max_tokens: cfg.maxTokens || 64000, stream: true, messages: msgs,
    system: [{ type: 'text', text: conv.system, cache_control: { type: 'ephemeral' } }],
    tools: TOOLS.map((t) => ({ name: t.name, description: t.description, input_schema: t.schema, ...(official ? { eager_input_streaming: true } : {}) })),
  };
  if (cfg.effort !== 'auto') { body.output_config = { effort: cfg.effort }; body.thinking = { type: 'adaptive', display: 'summarized' }; }
  const headers = authHeaders(p);
  if (cfg.fast && official) { body.speed = 'fast'; headers['anthropic-beta'] = 'fast-mode-2026-02-01'; }

  let res: Response;
  try { res = await post(`${base(p)}/v1/messages`, headers, body, sig); }
  catch (e: any) {
    if (!cfg.maxTokens && /max_tokens/.test(e.message)) { body.max_tokens = 8192; res = await post(`${base(p)}/v1/messages`, headers, body, sig); }
    else throw e;
  }
  const blocks: any[] = []; const raw: Record<number, string> = {};
  for await (const ev of sse(res)) {
    switch (ev.type) {
      case 'message_start': {
        const u = ev.message?.usage || {};
        usage.in += (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
        usage.cache += u.cache_read_input_tokens || 0; usage.out += u.output_tokens || 0;
        break;
      }
      case 'content_block_start': {
        const b = { ...ev.content_block }; blocks[ev.index] = b;
        if (b.type === 'tool_use') { raw[ev.index] = ''; toolProgress(b.name, ''); }
        break;
      }
      case 'content_block_delta': {
        const b = blocks[ev.index], d = ev.delta;
        if (d.type === 'text_delta') { b.text = (b.text || '') + d.text; acc.text += d.text; onText(d.text); }
        else if (d.type === 'thinking_delta') { b.thinking = (b.thinking || '') + d.thinking; onThink(d.thinking); }
        else if (d.type === 'signature_delta') b.signature = (b.signature || '') + d.signature;
        else if (d.type === 'input_json_delta') { raw[ev.index] += d.partial_json; agent.chars += d.partial_json.length; toolProgress(b.name, raw[ev.index]); }
        break;
      }
      case 'message_delta':
        if (ev.delta?.stop_reason) acc.stop = ev.delta.stop_reason;
        usage.out += ev.usage?.output_tokens || 0;
        break;
      case 'error': throw new Error(ev.error?.message || JSON.stringify(ev.error));
    }
  }
  const truncated = acc.stop === 'max_tokens';
  acc.blocks = blocks.filter(Boolean).map((b) => {
    if (b.type === 'text') return { type: 'text', text: b.text || '' };
    if (b.type === 'tool_use') {
      const r = parseArgs(b.name, raw[blocks.indexOf(b)] ?? '', truncated);
      acc.calls.push({ id: b.id, name: b.name, ...r });
      return { type: 'tool_use', id: b.id, name: b.name, input: r.args };
    }
    return b;
  }).filter((b) => !(b.type === 'text' && !b.text));
  if (acc.stop === 'refusal') line(yellow('  the model declined this request'));
}
