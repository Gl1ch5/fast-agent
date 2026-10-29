// First-run splash with an animated gradient logo, and the banner at the top of the transcript.
import { accent, bold, gray, gradient, shimmer, center, boxed } from './ansi.ts';
import { M } from './modal.ts';
import { log, req, ui } from './screen.ts';
import { VERSION } from '../version.ts';
import { ROOT } from '../env.ts';
import { tildify } from '../util.ts';

const LOGO = [
  '███████╗ █████╗ ',
  '██╔════╝██╔══██╗',
  '█████╗  ███████║',
  '██╔══╝  ██╔══██║',
  '██║     ██║  ██║',
  '╚═╝     ╚═╝  ╚═╝',
];

// resolves true to start setup, false when skipped
export function welcome(): Promise<boolean> {
  const t0 = Date.now();
  return new Promise((resolve) => {
    M.modal = {
      title: '', full: true, anim: true,
      render(W, H) {
        const t = (Date.now() - t0) / 1000;
        const shown = Math.min(LOGO.length, Math.floor(t * 14));
        const body = LOGO.map((l, i) => (i < shown ? gradient(l, t * 2.5 + i * 0.35) : ''));
        body.push('', t > 0.45 ? bold('Welcome to fa') : '', t > 0.6 ? gray(`fast coding agent · v${VERSION}`) : '', '', '');
        body.push(t > 0.9 ? shimmer('Press Enter to set up your provider and models', ui.tick) : '');
        body.push(t > 0.9 ? gray('esc to skip') : '');
        const top = Math.max(0, Math.floor((H - body.length) / 2));
        return { rows: [...Array(top).fill(''), ...body.map((r) => center(r, W))] };
      },
      key(_s, k) {
        if (k.ctrl && k.name === 'c') process.exit(0);
        if (k.name === 'return' || k.name === 'escape') { M.modal = null; req(); resolve(k.name === 'return'); }
      },
    };
    req();
  });
}

export function banner() {
  const W = Math.min(64, Math.max(24, (process.stdout.columns || 80) - 1));
  const rows = [
    `${accent('✻')} ${bold('Welcome to fa')} ${gray('v' + VERSION)}`,
    '',
    gray(`cwd  ${tildify(ROOT)}`),
    gray('/ for commands · /setup to configure · /model to switch'),
  ];
  for (const r of boxed(rows, W, '', accent)) log.push({ s: r, clip: true });
  log.push({ s: '' });
  req();
}
