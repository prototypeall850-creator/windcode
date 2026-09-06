import { z } from 'zod';
import { tool } from 'ai';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { approve, printDenied, isSensitivePath } from '../permissions.js';
import {
  resolveInCwd,
  relFromCwd,
  checkReadable,
  numberLines,
  MAX_READ_LINES,
} from './fs-helpers.js';
import type { ToolContext, ToolDefinition } from './types.js';

// ---------------------------------------------------------------------------
// core set — always on. Without read, edit, and bash the agent is not an agent.
// ---------------------------------------------------------------------------

const BASH_TIMEOUT_MS = 120_000;
const OUTPUT_CAP = 10_000;

function shellCommand(): { cmd: string; args: string[] } {
  return process.platform === 'win32'
    ? { cmd: 'cmd.exe', args: ['/d', '/s', '/c'] }
    : { cmd: '/bin/sh', args: ['-c'] };
}

interface BashResult {
  exitCode: number | null;
  output: string;
  timedOut: boolean;
}

function runCommand(ctx: ToolContext, command: string, timeoutMs: number): Promise<BashResult> {
  return new Promise((resolveRun) => {
    const { cmd, args } = shellCommand();
    const child = spawn(cmd, [...args, command], { cwd: ctx.cwd });

    let out = '';
    let truncated = false;
    const append = (chunk: string) => {
      ctx.ui.onCommandOutput(chunk);
      if (out.length < OUTPUT_CAP) {
        out += chunk;
      } else if (!truncated) {
        truncated = true;
        out += '\n...[output terpotong]';
      }
    };
    child.stdout.on('data', (d) => append(d.toString()));
    child.stderr.on('data', (d) => append(d.toString()));

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 2000);
    }, timeoutMs);

    child.on('close', (exitCode) => {
      clearTimeout(timer);
      resolveRun({ exitCode, output: out.trimEnd(), timedOut });
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolveRun({ exitCode: null, output: `gagal menjalankan: ${err.message}`, timedOut: false });
    });
  });
}

export function buildCoreTools(ctx: ToolContext): Record<string, any> {
  const read_file = tool({
    description:
      'Read a text file with 1-based line numbers. Use offset/limit to page through ' +
      'large files. Refuses sensitive files (.env/.pem/.key) and binaries.',
    inputSchema: z.object({
      path: z.string().describe('Path relative to the project root'),
      offset: z.number().int().min(1).optional().describe('1-based first line to read'),
      limit: z.number().int().min(1).max(MAX_READ_LINES).optional().describe('Max lines to read'),
    }),
    execute: async ({ path, offset, limit }) => {
      const abs = resolveInCwd(ctx.cwd, path);
      const err = checkReadable(ctx.cwd, abs);
      if (err) return `ERROR: ${err}`;
      const content = readFileSync(abs, 'utf8');
      const numbered = numberLines(content, offset ?? 1, limit ?? MAX_READ_LINES);
      return numbered || '(file kosong)';
    },
  });

  const write_file = tool({
    description:
      'Create a new file or fully rewrite an existing one. Parent directories are ' +
      'created automatically. Requires user approval and shows a diff for rewrites.',
    inputSchema: z.object({
      path: z.string().describe('Path relative to the project root'),
      content: z.string().describe('Full file content'),
    }),
    execute: async ({ path, content }) => {
      const abs = resolveInCwd(ctx.cwd, path);
      if (isSensitivePath(relFromCwd(ctx.cwd, abs))) {
        return 'ERROR: menulis file sensitif (.env/.pem/.key) lewat agent tidak diizinkan';
      }
      const exists = existsSync(abs);
      const old = exists ? readFileSync(abs, 'utf8') : '';
      if (
        exists &&
        old.replace(/\s+/g, '') === content.replace(/\s+/g, '') &&
        old !== content
      ) {
        return 'WARNING: konten hasil rewrite identik setelah whitespace dihapus — ' +
          'kemungkinan salah. Tidak ada yang ditulis. Gunakan edit_file bila maksudnya edit kecil.';
      }
      const ok = await approve(ctx, {
        title: `write_file ${relFromCwd(ctx.cwd, abs)}${exists ? ' (rewrite)' : ' (baru)'}`,
        detail: `write:${relFromCwd(ctx.cwd, abs)}`,
        allowPattern: `write:${relFromCwd(ctx.cwd, abs)}`,
      });
      if (!ok) return printDenied();
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, content, 'utf8');
      const lines = content.split('\n').length;
      return `OK: ${exists ? 'menulis ulang' : 'membuat'} ${relFromCwd(ctx.cwd, abs)} (${lines} baris)`;
    },
  });

  const edit_file = tool({
    description:
      'Exact-match find-and-replace in one file. The old string must match exactly ' +
      'once; ambiguous matches are rejected with the match count.',
    inputSchema: z.object({
      path: z.string().describe('Path relative to the project root'),
      old_string: z.string().describe('Exact text to replace'),
      new_string: z.string().describe('Replacement text'),
    }),
    execute: async ({ path, old_string, new_string }) => {
      const abs = resolveInCwd(ctx.cwd, path);
      const err = checkReadable(ctx.cwd, abs);
      if (err) return `ERROR: ${err}`;
      const content = readFileSync(abs, 'utf8');
      const count = content.split(old_string).length - 1;
      if (count === 0) return 'ERROR: old_string tidak ditemukan di file. Periksa kembali teksnya.';
      if (count > 1) {
        return `ERROR: old_string ditemukan ${count} kali — tidak ambigu. Perluas konteks teksnya agar unik.`;
      }
      const updated = content.replace(old_string, () => new_string);
      const { previewDiff } = await import('./fs-helpers.js');
      const ok = await approve(ctx, {
        title: `edit_file ${relFromCwd(ctx.cwd, abs)}`,
        detail: `write:${relFromCwd(ctx.cwd, abs)}`,
        diff: previewDiff(abs, content, updated),
        allowPattern: `write:${relFromCwd(ctx.cwd, abs)}`,
      });
      if (!ok) return printDenied();
      writeFileSync(abs, updated, 'utf8');
      return `OK: 1 substitusi di ${relFromCwd(ctx.cwd, abs)}`;
    },
  });

  const glob = tool({
    description:
      'Find files by glob pattern (supports **, *, ?, {a,b}). Skips .git and ' +
      'node_modules. Returns up to 200 paths.',
    inputSchema: z.object({
      pattern: z.string().describe('Glob pattern, e.g. src/**/*.ts'),
      path: z.string().optional().describe('Base directory (default: project root)'),
    }),
    execute: async ({ pattern, path }) => {
      const { globSearch } = await import('./search.js');
      const base = resolveInCwd(ctx.cwd, path ?? '.');
      const results = globSearch(base, pattern);
      if (results.length === 0) return 'Tidak ada file yang cocok.';
      return results.map((r) => relFromCwd(ctx.cwd, r)).join('\n');
    },
  });

  const grep = tool({
    description:
      'Search file contents with a regex. Uses ripgrep when installed, otherwise a ' +
      'built-in JS search. Returns up to 200 matches with line numbers.',
    inputSchema: z.object({
      pattern: z.string().describe('Regular expression'),
      path: z.string().optional().describe('File or directory to search (default: project root)'),
      include: z.string().optional().describe('Glob filter, e.g. *.ts'),
    }),
    execute: async ({ pattern, path, include }) => {
      const { grepSearch } = await import('./search.js');
      const base = resolveInCwd(ctx.cwd, path ?? '.');
      const err = base !== ctx.cwd && isSensitivePath(relFromCwd(ctx.cwd, base))
        ? 'pencarian pada file sensitif tidak diizinkan'
        : null;
      if (err) return `ERROR: ${err}`;
      const results = grepSearch(base, pattern, include);
      return results;
    },
  });

  const bash = tool({
    description:
      'Run a shell command and stream its output. Destructive commands are refused ' +
      'by a guard; other commands need approval once (or use "always allow"). ' +
      'Timeout 120s. On Windows runs under cmd.exe, otherwise /bin/sh.',
    inputSchema: z.object({
      command: z.string().describe('The shell command to run'),
      timeout_ms: z
        .number()
        .int()
        .min(1000)
        .max(600_000)
        .optional()
        .describe('Timeout override (default 120000ms, max 600000ms)'),
    }),
    execute: async ({ command, timeout_ms }) => {
      const ok = await approve(ctx, {
        title: 'bash',
        detail: command,
        allowPattern: command.split(/\s+/)[0] + ' *',
      });
      if (!ok) return printDenied();
      ctx.ui.onToolStart('bash', command);
      const res = await runCommand(ctx, command, timeout_ms ?? BASH_TIMEOUT_MS);
      ctx.ui.onToolEnd('bash', `exit=${res.exitCode ?? '?'}`);
      const suffix = res.timedOut ? '\n[timeout — proses dihentikan]' : '';
      return `exit=${res.exitCode ?? '?'}${suffix}\n${res.output || '(tanpa output)'}`;
    },
  });

  return { read_file, write_file, edit_file, glob, grep, bash };
}
