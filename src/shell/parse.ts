// Turns a raw shell command into a short, readable label:
//   cd app && npm install express cors 2>&1 | tail -5
//   → in app · npm install express cors | tail
// Handles quotes, $( ), redirects, heredocs, &&, ||, |, ; and newlines.
import { bold, gray, dim, clip } from '../ui/ansi.ts';

type Tok = { w?: string; op?: string; redir?: string; hd?: boolean };

export function shTokens(cmd: string): Tok[] {
  const t: Tok[] = [];
  let cur = '', has = false, i = 0, redir = '';
  const push = () => {
    if (has) { if (redir) { if (redir !== 'skip') t.push({ redir: cur }); redir = ''; } else t.push({ w: cur }); }
    cur = ''; has = false;
  };
  while (i < cmd.length) {
    const c = cmd[i], ahead = cmd.slice(i, i + 64);
    if (c === "'") { const j = cmd.indexOf("'", i + 1); cur += cmd.slice(i + 1, j < 0 ? undefined : j); has = true; i = j < 0 ? cmd.length : j + 1; continue; }
    if (c === '"') {
      let j = i + 1;
      while (j < cmd.length && cmd[j] !== '"') { if (cmd[j] === '\\') j++; j++; }
      cur += cmd.slice(i + 1, j).replace(/\\(.)/g, '$1'); has = true; i = j + 1; continue;
    }
    if (c === '\\' && i + 1 < cmd.length) { if (cmd[i + 1] !== '\n') { cur += cmd[i + 1]; has = true; } i += 2; continue; }
    if (c === '$' && cmd[i + 1] === '(') {
      let d = 0, j = i;
      for (; j < cmd.length; j++) { if (cmd[j] === '(') d++; else if (cmd[j] === ')' && --d === 0) break; }
      cur += cmd.slice(i, j + 1); has = true; i = j + 1; continue;
    }
    if (c === ' ' || c === '\t') { push(); i++; continue; }
    if (c === '#' && !has) { const j = cmd.indexOf('\n', i); i = j < 0 ? cmd.length : j; continue; }
    if ('|&;<>\n'.includes(c) || (!has && /^\d+[<>]/.test(ahead))) {
      push();
      const hd = /^<<-?[ \t]*(['"]?)([\w.-]+)\1/.exec(ahead);
      if (hd) {
        // skip the heredoc body up to its terminator line
        const nl = cmd.indexOf('\n', i);
        let end = cmd.length;
        if (nl >= 0) {
          const re = new RegExp(`^[ \\t]*${hd[2].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[ \\t]*$`, 'm');
          const m = re.exec(cmd.slice(nl + 1));
          if (m) end = nl + 1 + m.index + m[0].length;
        }
        // keep whatever follows the marker on the same line (e.g. "> file")
        const tailLine = cmd.slice(i + hd[0].length, nl < 0 ? cmd.length : nl);
        t.push({ hd: true });
        t.push(...shTokens(tailLine).filter((x) => !x.op));
        i = end; continue;
      }
      const dup = /^\d*[<>]&\d+/.exec(ahead);
      if (dup) { i += dup[0].length; continue; }
      const here = /^<<</.exec(ahead);
      if (here) { redir = 'skip'; i += 3; continue; }
      const rd = /^(&>>?|\d*>>?|\d*<)/.exec(ahead);
      if (rd) { redir = rd[0].includes('>') ? '>' : 'skip'; i += rd[0].length; continue; }
      const op = /^(\|\||&&|\|&|;;|[|;&\n])/.exec(ahead)![0];
      t.push({ op: op === '\n' || op === ';;' ? ';' : op === '|&' ? '|' : op });
      i += op.length; continue;
    }
    cur += c; has = true; i++;
  }
  push();
  return t;
}

const short = (p: string) => clip(p.replace(/^\.\//, ''), 40);
const quoted = (s: string) => dim(`"${clip(s.split('\n')[0], 40)}"`);
const host = (u: string) => { try { const x = new URL(u); return clip(x.host + (x.pathname === '/' ? '' : x.pathname), 50); } catch { return clip(u, 50); } };
const WRAPPERS = new Set(['sudo', 'time', 'nohup', 'env', 'command', 'exec', 'nice']);
const BODY = new Set(['do', 'then', 'else', '{', '(']);     // prefixes in front of a real command
const CLOSE = new Set(['done', 'fi', 'esac', '}', ')']);    // block ends: nothing to show

function segLabel(words: string[], out: string, heredoc: boolean): string | null {
  const ws = [...words];
  while (ws.length && BODY.has(ws[0])) ws.shift();
  if (ws.length && CLOSE.has(ws[0])) return null;
  if (ws[0] === 'for' || ws[0] === 'select') {
    const inAt = ws.indexOf('in');
    const items = inAt > 0 ? ws.slice(inAt + 1) : [];
    return `${bold(ws[0])} ${ws[1] ?? ''}${items.length ? ' in ' + (items.length > 3 ? `${items[0]}…${items[items.length - 1]}` : items.join(' ')) : ''}`;
  }
  if (ws[0] === 'while' || ws[0] === 'until' || ws[0] === 'if' || ws[0] === 'elif') {
    const cond = segLabel(ws.slice(1).filter((x) => x !== '[' && x !== ']' && x !== '!'), '', false);
    return `${bold(ws[0])} ${cond ?? ''}`;
  }
  while (ws.length && /^[A-Za-z_]\w*=/.test(ws[0])) ws.shift();
  while (ws.length && WRAPPERS.has(ws[0])) ws.shift();
  if (!ws.length) return out ? `${bold('write')} ${short(out)}` : null;
  const prog = ws[0].split(/[\\/]/).pop()!.replace(/\.(exe|cmd|bat)$/i, '');
  const a = ws.slice(1), pos = a.filter((x) => !x.startsWith('-'));
  const P = bold(prog);
  const to = out ? ` ${gray('→')} ${short(out)}` : '';
  const list = (xs: string[], n = 3) => xs.slice(0, n).map(short).join(' ') + (xs.length > n ? gray(` +${xs.length - n}`) : '');
  switch (prog) {
    case 'git': {
      const sub = pos[0] ?? '';
      if (sub === 'commit') {
        const mi = a.findIndex((x) => /^-[a-z]*m$/.test(x) || x === '--message');
        return `${P} commit${mi >= 0 && a[mi + 1] ? ' ' + quoted(a[mi + 1]) : ''}`;
      }
      if (sub === 'clone') return `${P} clone ${host(pos[1] ?? '')}`;
      return `${P} ${list(pos, 3)}${to}`;
    }
    case 'npm': case 'pnpm': case 'yarn': case 'bun': case 'pip': case 'pip3': case 'uv': case 'cargo': case 'go': case 'composer': case 'gem': {
      const sub = pos[0] ?? (prog === 'yarn' ? 'install' : '');
      if (/^(i|install|add|ci)$/.test(sub)) return `${P} install${pos.length > 1 ? ' ' + list(pos.slice(1), 4) : ''}`;
      if (sub === 'run' || sub === 'run-script') return `${P} run ${pos[1] ?? ''}`;
      if (sub === 'pip' && pos[1] === 'install') return `${P} pip install ${list(pos.slice(2), 4)}`;
      return `${P} ${list(pos, 2)}${to}`;
    }
    case 'npx': case 'bunx': case 'pnpx': return `${P} ${list(pos, 2)}`;
    case 'curl': case 'wget': case 'Invoke-WebRequest': case 'iwr': {
      const u = a.find((x) => /^https?:\/\//.test(x));
      return `${P} ${u ? host(u) : ''}${to}`;
    }
    case 'cat': case 'type': case 'Get-Content': case 'gc':
      if (out) return `${bold('write')} ${short(out)}${heredoc ? gray(' (heredoc)') : ''}`;
      return `${bold('read')} ${list(pos)}`;
    case 'head': case 'tail': case 'less': case 'more': case 'wc':
      return pos.length ? `${P} ${list(pos)}` : P;
    case 'echo': case 'printf': case 'Write-Output':
      return out ? `${bold('write')} ${short(out)}` : `${P} ${quoted(a.join(' '))}`;
    case 'tee': return `${bold('write')} ${list(pos)}`;
    case 'rm': case 'del': case 'Remove-Item': case 'rmdir': return `${bold('delete')} ${list(pos)}`;
    case 'mkdir': case 'md': case 'touch': return `${P} ${list(pos)}`;
    case 'mv': case 'cp': case 'move': case 'copy': case 'Copy-Item': case 'Move-Item':
      return pos.length >= 2 ? `${P} ${list(pos.slice(0, -1), 2)} ${gray('→')} ${short(pos[pos.length - 1])}` : `${P} ${list(pos)}`;
    case 'grep': case 'rg': case 'ag': case 'findstr': case 'Select-String': {
      const pi = a.findIndex((x) => x === '-e' || x === '--regexp');
      const pat = pi >= 0 ? a[pi + 1] : pos[0];
      const rest = pi >= 0 ? pos : pos.slice(1);
      return `${bold('search')} ${quoted(pat ?? '')}${rest.length ? ' in ' + list(rest, 2) : ''}`;
    }
    case 'find': case 'fd': {
      const ni = a.findIndex((x) => x === '-name' || x === '-iname');
      return `${bold('find')} ${ni >= 0 ? quoted(a[ni + 1] ?? '') + ' in ' : ''}${short(pos[0] ?? '.')}`;
    }
    case 'ls': case 'dir': case 'Get-ChildItem': case 'gci': case 'tree': return `${bold('list')} ${pos.length ? list(pos) : '.'}`;
    case 'sed': return a.some((x) => /^-i/.test(x)) ? `${bold('edit')} ${short(pos[pos.length - 1] ?? '')}` : `${P} ${list(pos.slice(1), 2)}`;
    case 'python': case 'python3': case 'py': case 'node': case 'deno': case 'ruby': case 'perl': case 'php': {
      if (a[0] === '-c' || a[0] === '-e') return `${P} ${gray('-c')} ${quoted(a[1] ?? '')}`;
      if (a[0] === '-m') return `${P} -m ${list(a.slice(1), 3)}`;
      return `${P} ${list(pos, 3)}${to}`;
    }
    case 'cd': case 'pushd': case 'Set-Location': return null;
    case 'true': case ':': return null;
    default: return `${P}${pos.length ? ' ' + list(pos, 3) : ''}${to}`;
  }
}

export function shellLabel(cmd: string): string {
  const first = cmd.trim().split('\n')[0];
  if (/^(case|function)\b/.test(first)) return clip(first, 80);
  let toks: Tok[];
  try { toks = shTokens(cmd); } catch { return clip(first, 80); }
  const parts: string[] = [];
  let seg: string[] = [], out = '', hd = false, joiner = '', cdDir = '';
  const flush = (op: string) => {
    if (seg.length || out) {
      if ((seg[0] === 'cd' || seg[0] === 'pushd' || seg[0] === 'Set-Location') && !parts.length) cdDir = seg[1] ?? '~';
      else {
        const l = segLabel(seg, out, hd);
        if (l) parts.push((parts.length ? gray(joiner) : '') + l);
      }
    }
    seg = []; out = ''; hd = false;
    joiner = op === '|' ? ' | ' : op === '&&' ? ' → ' : op === '||' ? ' || ' : op === '&' ? ' & ' : ' ; ';
  };
  for (const t of toks) {
    if (t.w !== undefined) seg.push(t.w);
    else if (t.redir !== undefined) out = t.redir;
    else if (t.hd) hd = true;
    else if (t.op) flush(t.op);
  }
  flush('');
  const label = parts.join('') || clip(first, 80);
  return (cdDir ? gray(`in ${short(cdDir)} · `) : '') + label;
}
