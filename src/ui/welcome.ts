// First-run splash with an animated gradient logo, and the banner at the top of the transcript.
import { accent, bold, gray, gradient, shimmer, center } from './ansi.ts';
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

// resolves 'setup', 'login' (load settings from an account) or null when skipped
export function welcome(): Promise<'setup' | 'login' | null> {
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
        body.push(t > 0.9 ? gray('L  sign in to load your settings  ·  esc to skip') : '');
        const top = Math.max(0, Math.floor((H - body.length) / 2));
        return { rows: [...Array(top).fill(''), ...body.map((r) => center(r, W))] };
      },
      key(s, k) {
        if (k.ctrl && k.name === 'c') process.exit(0);
        const v = k.name === 'return' ? 'setup' : k.name === 'l' || s === 'д' || s === 'Д' ? 'login' : k.name === 'escape' ? null : undefined;
        if (v !== undefined) { M.modal = null; req(); resolve(v); }
      },
    };
    req();
  });
}

// one quiet line at the top of the transcript
export function banner() {
  log.push({ s: `${accent('✻')} ${bold('fa')} ${gray(`v${VERSION}  ·  ${tildify(ROOT)}`)}`, clip: true });
  log.push({ s: '' });
  req();
}
