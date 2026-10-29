#!/usr/bin/env node
// fa-sync: tiny account + settings sync server for fa. Zero dependencies, Node 22.18+.
//   node server/fa-sync.ts            listens on 127.0.0.1:8771, data in ./fa-sync-data
//   FA_SYNC_PORT=8771 FA_SYNC_DATA=/var/lib/fa-sync node fa-sync.ts
// Passwords are stored as scrypt hashes; settings (with API keys) as plain JSON files
// readable only by the service user. Put it behind HTTPS (nginx).
//   POST /register {user, pass}     → {token}
//   POST /login    {user, pass}     → {token}         404 unknown user, 401 wrong password
//   POST /logout                     (Bearer user:token)
//   GET  /data                       → {data, updated} (data null before the first push)
//   PUT  /data     {data}           → {updated}
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const PORT = Number(process.env.FA_SYNC_PORT) || 8771;
const HOST = process.env.FA_SYNC_HOST || '127.0.0.1';
const DATA = path.resolve(process.env.FA_SYNC_DATA || 'fa-sync-data');
const MAX_BODY = 1 << 20;
const MAX_TOKENS = 20;
fs.mkdirSync(DATA, { recursive: true, mode: 0o700 });

interface Account { user: string; salt: string; hash: string; tokens: string[]; data: any; updated: number; created: number }

const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
const fileOf = (user: string) => path.join(DATA, sha(user.toLowerCase()) + '.json');
const load = (user: string): Account | null => { try { return JSON.parse(fs.readFileSync(fileOf(user), 'utf8')); } catch { return null; } };
function store(a: Account) {
  const f = fileOf(a.user);
  fs.writeFileSync(f + '.tmp', JSON.stringify(a), { mode: 0o600 });
  fs.renameSync(f + '.tmp', f);
}
const hashPass = (pass: string, salt: string) => crypto.scryptSync(pass, salt, 32).toString('hex');
function newToken(a: Account) {
  const t = crypto.randomBytes(32).toString('hex');
  a.tokens = [...a.tokens, sha(t)].slice(-MAX_TOKENS);
  return t;
}

// at most 20 login/register attempts per IP per 10 minutes
const tries = new Map<string, { n: number; t: number }>();
function limited(ip: string) {
  const now = Date.now(), e = tries.get(ip);
  if (!e || now - e.t > 600_000) { tries.set(ip, { n: 1, t: now }); return false; }
  return ++e.n > 20;
}

function body(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => { size += c.length; if (size > MAX_BODY) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch { reject(new Error('bad json')); } });
    req.on('error', reject);
  });
}

function authed(req: http.IncomingMessage): Account | null {
  const m = /^Bearer ([^:\s]+):([0-9a-f]{64})$/.exec(req.headers.authorization || '');
  if (!m) return null;
  const a = load(m[1]);
  return a && a.tokens.includes(sha(m[2])) ? a : null;
}

const server = http.createServer(async (req, res) => {
  const send = (code: number, j: any) => { res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(j)); };
  const ip = String(req.headers['x-real-ip'] || req.socket.remoteAddress || '');
  const url = (req.url || '/').split('?')[0].replace(/\/+$/, '') || '/';
  try {
    if (req.method === 'GET' && url === '/') return send(200, { ok: true, service: 'fa-sync' });
    if (req.method === 'POST' && (url === '/register' || url === '/login')) {
      if (limited(ip)) return send(429, { error: 'too many attempts, try again in 10 minutes' });
      const { user, pass } = await body(req);
      if (typeof user !== 'string' || !/^[\w.@+-]{2,64}$/.test(user)) return send(400, { error: 'login: 2-64 characters, letters, digits and _ . @ + -' });
      if (typeof pass !== 'string' || pass.length < 4 || pass.length > 256) return send(400, { error: 'password: at least 4 characters' });
      let a = load(user);
      if (url === '/register') {
        if (a) return send(409, { error: 'this login is taken' });
        const salt = crypto.randomBytes(16).toString('hex');
        a = { user, salt, hash: hashPass(pass, salt), tokens: [], data: null, updated: 0, created: Date.now() };
      } else {
        if (!a) return send(404, { error: 'no such account' });
        if (!crypto.timingSafeEqual(Buffer.from(hashPass(pass, a.salt), 'hex'), Buffer.from(a.hash, 'hex'))) return send(401, { error: 'wrong password' });
      }
      const token = newToken(a);
      store(a);
      return send(200, { token, user: a.user });
    }
    const a = authed(req);
    if (!a) return send(401, { error: 'not signed in' });
    if (req.method === 'POST' && url === '/logout') {
      const t = /:([0-9a-f]{64})$/.exec(req.headers.authorization || '')![1];
      a.tokens = a.tokens.filter((x) => x !== sha(t)); store(a);
      return send(200, { ok: true });
    }
    if (req.method === 'GET' && url === '/data') return send(200, { data: a.data, updated: a.updated });
    if (req.method === 'PUT' && url === '/data') {
      const { data } = await body(req);
      if (!data || typeof data !== 'object' || Array.isArray(data)) return send(400, { error: 'data must be an object' });
      a.data = data; a.updated = Math.max(Date.now(), a.updated + 1); store(a);
      return send(200, { updated: a.updated });
    }
    send(404, { error: 'not found' });
  } catch (e: any) {
    send(e.message === 'too large' ? 413 : 400, { error: e.message });
  }
});
server.listen(PORT, HOST, () => console.log(`fa-sync on ${HOST}:${PORT}, data in ${DATA}`));
