// Minimal ANSI helpers — no dependency, works on Termux/Linux/Windows Terminal.
// All helpers degrade gracefully when color is disabled (piped output, NO_COLOR).

const enabled =
  process.env.NO_COLOR === undefined && process.env.TERM !== 'dumb';

function wrap(code: string, text: string): string {
  return enabled ? `\x1b[${code}m${text}\x1b[0m` : text;
}

export const dim = (t: string) => wrap('2', t);
export const bold = (t: string) => wrap('1', t);
export const red = (t: string) => wrap('31', t);
export const green = (t: string) => wrap('32', t);
export const yellow = (t: string) => wrap('33', t);
export const blue = (t: string) => wrap('34', t);
export const magenta = (t: string) => wrap('35', t);
export const cyan = (t: string) => wrap('36', t);

export function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;]*m/g, '');
}
