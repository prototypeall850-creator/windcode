import * as readline from 'node:readline';
import { bold, dim, red, green, yellow, cyan } from '../util/ansi.js';
import { diffStat, type DiffLine } from '../util/diff.js';
import type { ApprovalRequest } from '../agent/tools/types.js';

// ---------------------------------------------------------------------------
// Terminal rendering helpers shared by the REPL and one-shot mode.
// ---------------------------------------------------------------------------

export function printBanner(providerName: string, modelId: string, cwd: string, toolSets: string[], yolo: boolean): void {
  console.log(bold('windcode') + dim(` v0.1.0 — ${providerName}/${modelId}`));
  console.log(dim(`  cwd: ${cwd}  |  tools: ${toolSets.join(', ')}${yolo ? '  |  YOLO: auto-approve' : ''}`));
  console.log(dim('  /help untuk daftar perintah. ctrl-c untuk keluar.\n'));
}

export function printHelp(): void {
  console.log(bold('\nSlash commands'));
  console.log('  /help              daftar perintah ini');
  console.log('  /model [p/m]       lihat / ganti model (mis. /model zen/big-pickle)');
  console.log('  /tools             tool sets yang aktif + isinya');
  console.log('  /sessions          daftar sesi tersimpan');
  console.log('  /resume [id]       lanjutkan sesi lain');
  console.log('  /yolo              toggle auto-approve non-destruktif');
  console.log('  /clear             mulai sesi baru (kosongkan konteks)');
  console.log('  /exit, /quit       keluar\n');
}

export function formatDiff(lines: DiffLine[]): string {
  const out = lines.map((l) => {
    if (l.type === 'add') return green(`  + ${l.text}`);
    if (l.type === 'del') return red(`  - ${l.text}`);
    return dim(`    ${l.text}`);
  });
  return out.join('\n');
}

export async function askApproval(
  rl: readline.Interface,
  req: ApprovalRequest,
): Promise<'y' | 'a' | 'n'> {
  console.log(yellow(`\n  ⚠ ${req.title}`));
  if (req.detail && req.detail !== req.title) {
    console.log(dim(`    ${req.detail}`));
  }
  if (req.diff && req.diff.length > 0) {
    console.log(dim(`    ${diffStat(req.diff)}`));
    console.log(formatDiff(req.diff));
  }
  while (true) {
    const answer = await new Promise<string>((resolve) =>
      rl.question(yellow('  izinkan? [y]a / [a]lways / [n]o: '), (a) => resolve(a.trim().toLowerCase())),
    );
    if (answer === 'y' || answer === 'a' || answer === 'n') return answer;
    if (answer === '') return 'n';
    console.log(dim('  jawab y, a, atau n.'));
  }
}

export async function askQuestion(
  rl: readline.Interface,
  question: string,
  options?: string[],
): Promise<string> {
  console.log(cyan(`\n  ❓ ${question}`));
  if (options && options.length > 0) {
    options.forEach((o, i) => console.log(`    ${i + 1}. ${o}`));
    while (true) {
      const raw = await new Promise<string>((resolve) =>
        rl.question(cyan('  pilih nomor / ketik jawaban lain: '), (a) => resolve(a.trim())),
      );
      const n = parseInt(raw, 10);
      if (Number.isInteger(n) && n >= 1 && n <= options.length) return options[n - 1];
      if (raw) return raw;
    }
  }
  const answer = await new Promise<string>((resolve) =>
    rl.question(cyan('  jawaban: '), (a) => resolve(a.trim())),
  );
  return answer || '(tanpa jawaban)';
}
