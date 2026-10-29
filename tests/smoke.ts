// End-to-end check of print mode against a fake OpenAI-compatible server:
// write → edit with wrong indentation (fuzzy match) → shell → answer with <thought> reasoning
// split across chunks, then `-c` continues it.
//   node tests/smoke.ts            (tests fa.ts; FA_ENTRY=src/main.ts tests the sources)
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const entry = path.resolve(process.env.FA_ENTRY || 'fa.ts');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-smoke-'));
const home = path.join(tmp, 'home'), work = path.join(tmp, 'work');
fs.mkdirSync(home); fs.mkdirSync(work);

const call = (name: string, args: any) => ({ choices: [{ delta: { tool_calls: [{ index: 0, id: `c${Math.random().toString(36).slice(2, 8)}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] } }] });
const text = (t: string) => ({ choices: [{ delta: { content: t } }] });
const seen: any[] = [];

const server = http.createServer((req, res) => {
  let b = '';
  req.on('data', (c) => (b += c));
  req.on('end', () => {
    const body = JSON.parse(b || '{}');
    seen.push(body);
    const msgs: any[] = body.messages;
    const tools = msgs.filter((m) => m.role === 'tool').length;
    const users = msgs.filter((m) => m.role === 'user').length;
    let step: any;
    if (users > 1) step = text('continued');
    else if (tools === 0) step = call('write', { path: 'app.js', content: 'function add(a, b) {\n  return a - b;\n}\nconsole.log(add(2, 3));\n' });
    else if (tools === 1) step = call('edit', { path: 'app.js', edits: [{ old: '    return a - b;', new: '    return a + b;' }] });
    else if (tools === 2) step = call('shell', { command: 'node app.js' });
    else step = ['<tho', 'ught>checking the out', 'put</thou', `ght>\n\ndone: ${msgs[msgs.length - 1].content.trim().split('\n').pop()}`].map(text);
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    for (const s of [step].flat()) res.write(`data: ${JSON.stringify(s)}\n\n`);
    res.write(`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 1000, completion_tokens: 10 } })}\n\n`);
    res.end('data: [DONE]\n\n');
  });
});
await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
const port = (server.address() as any).port;
fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({
  provider: 'fake', model: 'm', effort: 'auto', fast: false, safe: false, setupDone: true, models: ['fake/m'],
  providers: { fake: { type: 'openai', url: `http://127.0.0.1:${port}/v1`, key: 'k' } },
}));

const run = async (...args: string[]) => {
  return new Promise<{ code: number | null; out: string }>((resolve) => {
    const p = spawn(process.execPath, [entry, '-C', work, ...args], { env: { ...process.env, FA_HOME: home }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    p.stdout.on('data', (d) => (out += d)); p.stderr.on('data', (d) => (out += d));
    p.on('close', (code) => resolve({ code, out }));
  });
};

try {
  const a = await run('-p', 'make add() in app.js correct');
  assert.equal(a.code, 0, a.out);
  assert.equal(fs.readFileSync(path.join(work, 'app.js'), 'utf8'), 'function add(a, b) {\n  return a + b;\n}\nconsole.log(add(2, 3));\n');
  assert.match(a.out, /done: 5/, a.out);
  assert.equal(fs.readdirSync(path.join(home, 'sessions')).length, 1, 'session saved');

  const b = await run('-c', '-p', 'and now?');
  assert.equal(b.code, 0, b.out);
  assert.match(b.out, /continued/, b.out);
  const last = seen[seen.length - 1].messages.filter((m: any) => m.role === 'user').map((m: any) => m.content);
  assert.deepEqual(last, ['make add() in app.js correct', 'and now?']);
  const said = seen[seen.length - 1].messages.filter((m: any) => m.role === 'assistant' && m.content).map((m: any) => m.content);
  assert.deepEqual(said, ['done: 5'], 'reasoning is not part of the answer');
  console.log('smoke ok');
} finally {
  server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
}
