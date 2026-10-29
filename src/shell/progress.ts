// Reading live command output: last visible lines and progress percentages.
import { ANSI } from '../ui/ansi.ts';

// lines as a terminal would show them: \r overwrites, blank lines dropped
export function outputLines(buf: string): string[] {
  return buf.replace(ANSI, '').split(/\r?\n/)
    .map((l) => l.split('\r').filter((x) => x.trim()).pop() ?? '')
    .map((l) => l.replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '').trimEnd())
    .filter((l) => l.trim());
}

// "45%", "[3/10]", "12/40 files" → percent, newest line first
export function progressOf(lines: string[]): number | undefined {
  for (const l of [...lines].reverse()) {
    const pct = [...l.matchAll(/(\d{1,3}(?:\.\d+)?)\s?%/g)].pop();
    if (pct && Number(pct[1]) <= 100) return Number(pct[1]);
    const f = /(?:^|[\s(\[])(\d+)\s*\/\s*(\d+)(?=[\s)\]:]|$)/.exec(l);
    if (f) {
      const a = Number(f[1]), b = Number(f[2]);
      if (b > 1 && a <= b && b < 1e6) return (100 * a) / b;
    }
  }
  return undefined;
}
