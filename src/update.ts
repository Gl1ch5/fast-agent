// Self-update: download the latest fa.ts from GitHub and replace this file.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { VERSION, REPO_RAW } from './version.ts';
import { ROOT } from './env.ts';
import { cfg, saveCfg } from './config.ts';
import { bold, green, red, yellow } from './ui/ansi.ts';
import { line, spin } from './ui/screen.ts';
import { leaveTui } from './ui/tui.ts';
import { cmpVer } from './util.ts';

const selfPath = () => fileURLToPath(import.meta.url);

async function fetchLatest(timeout: number) {
  const res = await fetch(`${REPO_RAW}/fa.ts`, { signal: AbortSignal.timeout(timeout), headers: { 'cache-control': 'no-cache' } });
  if (!res.ok) throw new Error(`download failed: ${res.status}`);
  const src = await res.text();
  const v = /const VERSION = '([^']+)'/.exec(src)?.[1];
  if (!v || !src.startsWith('#!')) throw new Error('the downloaded file does not look like fa');
  return { v, src };
}

// quiet check, at most twice a day; the footer shows when a newer version exists
export function checkUpdates() {
  if (Date.now() - (cfg.lastCheck || 0) < 12 * 3600_000) return;
  fetchLatest(5000).then(({ v }) => { cfg.latest = v; cfg.lastCheck = Date.now(); saveCfg(); }).catch(() => {});
}

// true when the file was replaced
export async function update(): Promise<boolean> {
  const self = selfPath();
  if (path.basename(self) !== 'fa.ts') { line(yellow('running from src/ — update with git pull && node build.ts'), { ind: 2 }); return false; }
  if (fs.existsSync(path.join(path.dirname(self), '.git'))) { line(yellow('running from a git checkout — update with git pull'), { ind: 2 }); return false; }
  spin.start('Checking for updates');
  try {
    const { v, src } = await fetchLatest(20000);
    spin.stop();
    cfg.latest = v; cfg.lastCheck = Date.now(); saveCfg();
    if (cmpVer(v, VERSION) <= 0) { line(`fa ${VERSION} is the latest version`, { mark: green('✓ '), ind: 2 }); return false; }
    fs.writeFileSync(self + '.new', src);
    fs.renameSync(self + '.new', self);
    line(`updated fa ${VERSION} → ${bold(v)}`, { mark: green('✓ '), ind: 2 });
    return true;
  } catch (e: any) {
    spin.stop();
    line(red(`update failed: ${e.message}`), { mark: red('✗ '), ind: 2 });
    return false;
  }
}

// start the new version in place of this process
export function restart(): never {
  leaveTui(false);
  const r = spawnSync(process.execPath, [selfPath(), '-C', ROOT], { stdio: 'inherit' });
  process.exit(r.status ?? 0);
}
