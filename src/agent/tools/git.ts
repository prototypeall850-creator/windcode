import { z } from 'zod';
import { tool } from 'ai';
import { spawnSync } from 'node:child_process';
import type { ToolContext } from './types.js';

// ---------------------------------------------------------------------------
// git set — read-only, approval-free. The agent can inspect a repo but never
// mutates it (git_commit_message only gathers data; the model writes the text).
// ---------------------------------------------------------------------------

const GIT_OUTPUT_CAP = 20_000;

function runGit(ctx: ToolContext, args: string[]): { ok: boolean; out: string } {
  const res = spawnSync('git', args, {
    cwd: ctx.cwd,
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
  });
  if (res.error) return { ok: false, out: `git tidak tersedia: ${(res.error as Error).message}` };
  if (res.status !== 0) {
    return { ok: false, out: res.stderr?.trim() || `git exit=${res.status}` };
  }
  const out = (res.stdout ?? '').trimEnd();
  return {
    ok: true,
    out: out.length > GIT_OUTPUT_CAP ? out.slice(0, GIT_OUTPUT_CAP) + '\n...[terpotong]' : out,
  };
}

export function buildGitTools(ctx: ToolContext): Record<string, any> {
  const git_status = tool({
    description:
      'Describe branch and per-file working tree status (modified/added/deleted/untracked).',
    inputSchema: z.object({}),
    execute: async () => {
      const branch = runGit(ctx, ['branch', '--show-current']);
      const status = runGit(ctx, ['status', '--porcelain']);
      if (!status.ok) return `ERROR: ${status.out}`;
      const desc = status.out
        ? status.out
            .split('\n')
            .map((l) => {
              const code = l.slice(0, 2);
              const file = l.slice(3);
              const meaning =
                code.includes('M') ? 'modified' : code.includes('A') ? 'added' : code.includes('D') ? 'deleted' : code.includes('??') ? 'untracked' : code.trim();
              return `${file} (${meaning})`;
            })
            .join('\n')
        : 'working tree bersih';
      return `branch: ${branch.ok ? branch.out : '?'}\n${desc}`;
    },
  });

  const git_diff = tool({
    description: 'Unified diff of uncommitted changes, optionally staged (--cached) or per path.',
    inputSchema: z.object({
      staged: z.boolean().optional().describe('Show staged changes instead of unstaged'),
      path: z.string().optional().describe('Limit diff to a path'),
    }),
    execute: async ({ staged, path }) => {
      const args = ['diff', '--no-color'];
      if (staged) args.push('--cached');
      if (path) args.push('--', path);
      const res = runGit(ctx, args);
      return res.ok ? res.out || '(tidak ada perubahan)' : `ERROR: ${res.out}`;
    },
  });

  const git_log = tool({
    description: 'Commit history: hash, date, author, subject — newest first (default 15, cap 40).',
    inputSchema: z.object({
      count: z.number().int().min(1).max(40).optional(),
    }),
    execute: async ({ count }) => {
      const res = runGit(ctx, [
        'log',
        `--pretty=format:%h | %ad | %an | %s`,
        '--date=short',
        `-n`,
        String(Math.min(count ?? 15, 40)),
      ]);
      return res.ok ? res.out : `ERROR: ${res.out}`;
    },
  });

  const git_show = tool({
    description: "Show one commit's message, author, and diff.",
    inputSchema: z.object({ ref: z.string().describe('Commit hash or ref') }),
    execute: async ({ ref }) => {
      const res = runGit(ctx, ['show', '--no-color', '--stat', ref]);
      const patch = runGit(ctx, ['show', '--no-color', ref, '--format=']);
      if (!res.ok) return `ERROR: ${res.out}`;
      const patchCapped =
        patch.ok && patch.out.length > GIT_OUTPUT_CAP
          ? patch.out.slice(0, GIT_OUTPUT_CAP) + '\n...[terpotong]'
          : patch.ok
            ? patch.out
            : '';
      return `${res.out}\n${patchCapped}`.trimEnd();
    },
  });

  const git_blame = tool({
    description: 'Who last changed each line of a file, with an optional 1-based line range.',
    inputSchema: z.object({
      path: z.string(),
      from: z.number().int().min(1).optional(),
      to: z.number().int().min(1).optional(),
    }),
    execute: async ({ path, from, to }) => {
      const args = ['blame', '--date=short'];
      if (from) args.push('-L', to ? `${from},${to}` : `${from},${from}`);
      args.push('--', path);
      const res = runGit(ctx, args);
      return res.ok ? res.out : `ERROR: ${res.out}`;
    },
  });

  const git_branch = tool({
    description: 'List local branches sorted by last commit; the current one is marked with *.',
    inputSchema: z.object({}),
    execute: async () => {
      const res = runGit(ctx, [
        'for-each-ref',
        '--sort=-committerdate',
        'refs/heads',
        '--format=%(refname:short) | %(committerdate:short)',
      ]);
      if (!res.ok) return `ERROR: ${res.out}`;
      const current = runGit(ctx, ['branch', '--show-current']);
      return res.out
        .split('\n')
        .map((l) => {
          const name = l.split('|')[0].trim();
          const mark = name === current.out ? '*' : ' ';
          return `${mark} ${l}`;
        })
        .join('\n');
    },
  });

  const git_commit_message = tool({
    description:
      'Gather staged diff and recent commit-message style so YOU can draft a commit ' +
      'message. This tool never commits — after drafting, ask the user or let them run git commit.',
    inputSchema: z.object({}),
    execute: async () => {
      const staged = runGit(ctx, ['diff', '--cached', '--no-color']);
      const style = runGit(ctx, ['log', '--pretty=format:%s', '-n', '10']);
      if (!staged.ok) return `ERROR: ${staged.out}`;
      const diff =
        staged.out.length > 8000 ? staged.out.slice(0, 8000) + '\n...[terpotong]' : staged.out;
      if (!diff) return 'Tidak ada perubahan yang di-stage. Minta user menjalankan `git add` dulu.';
      return [
        'RECENT_SUBJECTS:',
        style.ok ? style.out : '(n/a)',
        '',
        'STAGED_DIFF:',
        diff,
      ].join('\n');
    },
  });

  return {
    git_status,
    git_diff,
    git_log,
    git_show,
    git_blame,
    git_branch,
    git_commit_message,
  };
}
