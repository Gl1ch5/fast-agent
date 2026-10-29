// Keypress shape from node:readline.
export type Key = { name?: string; ctrl?: boolean; meta?: boolean; shift?: boolean; sequence?: string };

export function isPrintable(s: string | undefined, k: Key) {
  return !!s && !k.ctrl && !k.meta && !/^[\x00-\x1f\x7f]/.test(s) && !s.startsWith('\x1b');
}
