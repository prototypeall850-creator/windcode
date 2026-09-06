import * as readline from 'node:readline';
import { bold, dim, red, green, yellow, cyan } from '../util/ansi.js';

// ---------------------------------------------------------------------------
// Terminal prompts shared by the REPL and headless mode. These use their own
// readline interface because they can fire mid-turn, before the REPL's
// interface exists.
// ---------------------------------------------------------------------------

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function question(q: string): Promise<string> {
  return new Promise((resolve) => rl.question(q, (a) => resolve(a.trim())));
}

export function printBanner(providerLine: string, cwd: string, tools: string[], hasPlugins: boolean): void {
  console.log(bold('windcode') + dim(` v0.2.0 — ${providerLine}`));
  console.log(dim(`  cwd: ${cwd}  |  tools: ${tools.length} aktif${hasPlugins ? '  |  plugins: on' : ''}`));
  console.log(dim('  /help untuk daftar perintah. ctrl-c batal turn / keluar.\n'));
}

export type ApprovalAnswer = 'once' | 'always' | 'deny';

/** y = once, a = always (whitelist the suggested pattern), n/esc = deny. */
export async function askApproval(req: {
  title: string;
  detail?: string;
  suggestion?: string;
}): Promise<ApprovalAnswer> {
  console.log(yellow(`\n  ⚠ butuh izin: ${req.title}`));
  if (req.detail) console.log(dim(`    ${req.detail}`));
  if (req.suggestion) console.log(dim(`    [a] akan mengizinkan pola: ${req.suggestion}`));
  while (true) {
    const raw = await question(yellow('  izinkan? [y]a / [a]lways / [n]o: '));
    if (raw === 'y' || raw === 'Y' || raw === '') return 'once';
    if (raw === 'a' || raw === 'A') return 'always';
    if (raw === 'n' || raw === 'N') return 'deny';
    console.log(dim('  jawab y, a, atau n.'));
  }
}

/** Used by the `ask` tool. Undefined = user skipped (model proceeds with its guess). */
export async function askQuestion(
  questionText: string,
  options?: string[],
): Promise<string | undefined> {
  console.log(cyan(`\n  ❓ ${questionText}`));
  if (options && options.length > 0) {
    options.forEach((o, i) => console.log(`    ${i + 1}. ${o}`));
    while (true) {
      const raw = await question(cyan('  pilih nomor / ketik jawaban lain (kosongkan = lewati): '));
      if (!raw) return undefined;
      const n = parseInt(raw, 10);
      if (Number.isInteger(n) && n >= 1 && n <= options.length) return options[n - 1];
      return raw;
    }
  }
  const answer = await question(cyan('  jawaban (kosongkan = lewati): '));
  return answer || undefined;
}

export function printDenied(note?: string): string {
  return note ? `DENIED: ${note}` : 'DENIED: user menolak aksi ini';
}
