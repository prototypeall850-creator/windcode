import { z } from 'zod';
import { tool } from 'ai';
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  rmSync,
  renameSync,
  statSync,
  readdirSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { approve, printDenied, isSensitivePath } from '../permissions.js';
import { previewDiff } from './fs-helpers.js';
import { resolveInCwd, relFromCwd, checkReadable } from './fs-helpers.js';
import type { ToolContext } from './types.js';

// ---------------------------------------------------------------------------
// edit-plus set — richer file operations. Every mutation is validated fully
// before anything is written (atomic multi_edit / apply_patch).
// ---------------------------------------------------------------------------

export function buildEditPlusTools(ctx: ToolContext): Record<string, any> {
  const read_many_files = tool({
    description:
      'Read up to 20 files in one call. Each file gets its own optional offset/limit ' +
      'window. Failures are reported per file without aborting the batch.',
    inputSchema: z.object({
      files: z
        .array(
          z.object({
            path: z.string(),
            offset: z.number().int().min(1).optional(),
            limit: z.number().int().min(1).optional(),
          }),
        )
        .min(1)
        .max(20),
    }),
    execute: async ({ files }) => {
      const blocks: string[] = [];
      for (const f of files) {
        const abs = resolveInCwd(ctx.cwd, f.path);
        const err = checkReadable(ctx.cwd, abs);
        if (err) {
          blocks.push(`=== ${relFromCwd(ctx.cwd, abs)} ===\nERROR: ${err}`);
          continue;
        }
        const content = readFileSync(abs, 'utf8');
        const lines = content.split('\n');
        const start = (f.offset ?? 1) - 1;
        const slice = lines.slice(start, start + (f.limit ?? 2000));
        const pad = String(start + slice.length + 1).length;
        const numbered = slice
          .map((l, i) => `${String(start + i + 1).padStart(pad)}| ${l}`)
          .join('\n');
        blocks.push(`=== ${relFromCwd(ctx.cwd, abs)} ===\n${numbered || '(kosong)'}`);
      }
      return blocks.join('\n\n');
    },
  });

  const list_dir = tool({
    description:
      'Tree view of a directory honouring .gitignore, with depth control. ' +
      'Capped at 300 entries.',
    inputSchema: z.object({
      path: z.string().optional().describe('Directory to list (default: project root)'),
      depth: z.number().int().min(1).max(6).optional().describe('Recursion depth (default 3)'),
    }),
    execute: async ({ path, depth }) => {
      const root = resolveInCwd(ctx.cwd, path ?? '.');
      if (!existsSync(root)) return `ERROR: direktori tidak ditemukan: ${path ?? '.'}`;
      const SKIP = new Set(['.git', 'node_modules', '__pycache__', '.venv', 'dist', 'build']);
      const lines: string[] = [];
      let count = 0;
      const CAP = 300;
      const maxDepth = depth ?? 3;
      const walk = (dir: string, prefix: string, level: number) => {
        if (level > maxDepth || count >= CAP) return;
        let entries: string[];
        try {
          entries = readdirSync(dir).sort();
        } catch {
          return;
        }
        entries.forEach((entry, idx) => {
          if (count >= CAP) return;
          if (SKIP.has(entry)) return;
          const abs = join(dir, entry);
          if (isSensitivePath(entry)) {
            lines.push(`${prefix}${entry} (dilewati: sensitif)`);
            return;
          }
          let isDir = false;
          try {
            isDir = statSync(abs).isDirectory();
          } catch {
            return;
          }
          const last = idx === entries.length - 1;
          lines.push(`${prefix}${last ? '└── ' : '├── '}${entry}${isDir ? '/' : ''}`);
          count++;
          if (isDir) walk(abs, prefix + (last ? '    ' : '│   '), level + 1);
        });
      };
      walk(root, '', 1);
      const rel = relFromCwd(ctx.cwd, root);
      const head = count >= CAP ? `${rel}/ (dipotong di 300 entri)` : `${rel}/`;
      return [head, ...lines].join('\n');
    },
  });

  const multi_edit = tool({
    description:
      'Apply several sequential exact find-and-replace edits to ONE file in a single ' +
      'atomic approval. All old_strings are validated first; nothing is written if ' +
      'any of them fails.',
    inputSchema: z.object({
      path: z.string(),
      edits: z
        .array(
          z.object({
            old_string: z.string().describe('Exact text to replace'),
            new_string: z.string().describe('Replacement text'),
          }),
        )
        .min(1)
        .max(20),
    }),
    execute: async ({ path, edits }) => {
      const abs = resolveInCwd(ctx.cwd, path);
      const err = checkReadable(ctx.cwd, abs);
      if (err) return `ERROR: ${err}`;
      let content = readFileSync(abs, 'utf8');

      // validate all edits against a rolling preview before writing anything
      for (let i = 0; i < edits.length; i++) {
        const { old_string } = edits[i];
        const count = content.split(old_string).length - 1;
        if (count === 0) {
          return `ERROR: edit #${i + 1}: old_string tidak ditemukan. Tidak ada yang ditulis.`;
        }
        if (count > 1) {
          return `ERROR: edit #${i + 1}: old_string muncul ${count} kali (tidak ambigu). Tidak ada yang ditulis.`;
        }
        content = content.replace(old_string, () => edits[i].new_string);
      }

      const rel = relFromCwd(ctx.cwd, abs);
      const ok = await approve(ctx, {
        title: `multi_edit ${rel} (${edits.length} edit)`,
        detail: `write:${rel}`,
        diff: previewDiff(abs, readFileSync(abs, 'utf8'), content),
        allowPattern: `write:${rel}`,
      });
      if (!ok) return printDenied();
      writeFileSync(abs, content, 'utf8');
      return `OK: ${edits.length} edit diterapkan ke ${rel}`;
    },
  });

  const apply_patch = tool({
    description:
      'Apply one multi-file envelope of Add/Update/Move/Delete operations atomically. ' +
      'Everything is validated before any write. `update` replaces full file content.',
    inputSchema: z.object({
      actions: z
        .array(
          z.object({
            op: z.enum(['add', 'update', 'move', 'delete']),
            path: z.string().describe('Target path (source path for move)'),
            new_path: z.string().optional().describe('Destination path (move only)'),
            content: z.string().optional().describe('Full content (add/update only)'),
          }),
        )
        .min(1)
        .max(20),
    }),
    execute: async ({ actions }) => {
      // validation pass
      const previews: { title: string; old: string; next: string; abs: string }[] = [];
      for (let i = 0; i < actions.length; i++) {
        const a = actions[i];
        const abs = resolveInCwd(ctx.cwd, a.path);
        const rel = relFromCwd(ctx.cwd, abs);
        if (isSensitivePath(rel)) return `ERROR: aksi #${i + 1} menyentuh file sensitif. Tidak ada yang ditulis.`;
        switch (a.op) {
          case 'add': {
            if (a.content === undefined) return `ERROR: aksi #${i + 1} (add) butuh content.`;
            if (existsSync(abs)) return `ERROR: aksi #${i + 1}: ${rel} sudah ada. Tidak ada yang ditulis.`;
            previews.push({ title: `add ${rel}`, old: '', next: a.content, abs });
            break;
          }
          case 'update': {
            if (a.content === undefined) return `ERROR: aksi #${i + 1} (update) butuh content.`;
            const err = checkReadable(ctx.cwd, abs);
            if (err) return `ERROR: aksi #${i + 1}: ${err}. Tidak ada yang ditulis.`;
            previews.push({ title: `update ${rel}`, old: readFileSync(abs, 'utf8'), next: a.content, abs });
            break;
          }
          case 'move': {
            if (!a.new_path) return `ERROR: aksi #${i + 1} (move) butuh new_path.`;
            if (!existsSync(abs)) return `ERROR: aksi #${i + 1}: sumber ${rel} tidak ada.`;
            const target = resolveInCwd(ctx.cwd, a.new_path);
            if (existsSync(target)) return `ERROR: aksi #${i + 1}: target sudah ada.`;
            previews.push({ title: `move ${rel} -> ${relFromCwd(ctx.cwd, target)}`, old: '', next: '', abs: target });
            break;
          }
          case 'delete': {
            if (!existsSync(abs)) return `ERROR: aksi #${i + 1}: ${rel} tidak ada.`;
            if (statSync(abs).isDirectory()) return `ERROR: aksi #${i + 1}: ${rel} adalah direktori.`;
            previews.push({ title: `delete ${rel}`, old: readFileSync(abs, 'utf8'), next: '', abs });
            break;
          }
        }
      }

      const ok = await approve(ctx, {
        title: `apply_patch (${actions.length} aksi)`,
        detail: actions.map((a) => `${a.op}:${a.path}`).join(', '),
        diff: previews.length === 1 ? previewDiff(previews[0].abs, previews[0].old, previews[0].next) : undefined,
        allowPattern: 'apply-patch *',
      });
      if (!ok) return printDenied();

      // write pass — validation already succeeded
      const done: string[] = [];
      for (const a of actions) {
        const abs = resolveInCwd(ctx.cwd, a.path);
        switch (a.op) {
          case 'add':
            mkdirSync(dirname(abs), { recursive: true });
            writeFileSync(abs, a.content!, 'utf8');
            done.push(`add ${relFromCwd(ctx.cwd, abs)}`);
            break;
          case 'update':
            writeFileSync(abs, a.content!, 'utf8');
            done.push(`update ${relFromCwd(ctx.cwd, abs)}`);
            break;
          case 'move': {
            const target = resolveInCwd(ctx.cwd, a.new_path!);
            mkdirSync(dirname(target), { recursive: true });
            renameSync(abs, target);
            done.push(`move ${relFromCwd(ctx.cwd, abs)} -> ${relFromCwd(ctx.cwd, target)}`);
            break;
          }
          case 'delete':
            rmSync(abs);
            done.push(`delete ${relFromCwd(ctx.cwd, abs)}`);
            break;
        }
      }
      return `OK:\n${done.map((d) => `- ${d}`).join('\n')}`;
    },
  });

  const move_file = tool({
    description: 'Rename or move a file. Refuses a missing source or an occupied target.',
    inputSchema: z.object({
      path: z.string().describe('Source path'),
      new_path: z.string().describe('Destination path'),
    }),
    execute: async ({ path, new_path }) => {
      const abs = resolveInCwd(ctx.cwd, path);
      const target = resolveInCwd(ctx.cwd, new_path);
      if (!existsSync(abs)) return `ERROR: sumber tidak ada: ${path}`;
      if (existsSync(target)) return `ERROR: target sudah ada: ${new_path}`;
      const ok = await approve(ctx, {
        title: `move_file ${relFromCwd(ctx.cwd, abs)} -> ${relFromCwd(ctx.cwd, target)}`,
        detail: `write:${relFromCwd(ctx.cwd, abs)}`,
        allowPattern: 'move-file *',
      });
      if (!ok) return printDenied();
      mkdirSync(dirname(target), { recursive: true });
      renameSync(abs, target);
      return `OK: dipindah ke ${relFromCwd(ctx.cwd, target)}`;
    },
  });

  const delete_file = tool({
    description: 'Delete a single file (not directories) and report its size.',
    inputSchema: z.object({ path: z.string() }),
    execute: async ({ path }) => {
      const abs = resolveInCwd(ctx.cwd, path);
      if (!existsSync(abs)) return `ERROR: file tidak ada: ${path}`;
      const st = statSync(abs);
      if (st.isDirectory()) return 'ERROR: path adalah direktori — delete_file hanya untuk file.';
      const rel = relFromCwd(ctx.cwd, abs);
      if (isSensitivePath(rel)) return 'ERROR: file sensitif tidak bisa dihapus lewat agent.';
      const ok = await approve(ctx, {
        title: `delete_file ${rel} (${(st.size / 1024).toFixed(1)}KB)`,
        detail: `delete:${rel}`,
        allowPattern: 'delete-file *',
      });
      if (!ok) return printDenied();
      rmSync(abs);
      return `OK: ${rel} dihapus`;
    },
  });

  return { read_many_files, list_dir, multi_edit, apply_patch, move_file, delete_file };
}
