import { z } from 'zod';
import { tool } from 'ai';
import { existsSync, readFileSync, appendFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { projectMemoryFile } from '../../util/paths.js';
import type { ToolContext } from './types.js';

// ---------------------------------------------------------------------------
// agent set — self-state tools. todo_write and memory are approval-free
// (they only affect windcode's own state); ask pauses the turn for the user;
// task spawns a read-only sub-agent.
// ---------------------------------------------------------------------------

export function buildAgentTools(ctx: ToolContext): Record<string, any> {
  const todo_write = tool({
    description:
      'Replace the whole task list. Use it to plan multi-step work and keep the user ' +
      'informed. The list is shown in your system prompt on every later step.',
    inputSchema: z.object({
      todos: z
        .array(
          z.object({
            content: z.string().describe('The task, one actionable sentence'),
            status: z.enum(['pending', 'in_progress', 'done']).describe('Current state'),
          }),
        )
        .max(30),
    }),
    execute: async ({ todos }) => {
      ctx.todos.splice(0, ctx.todos.length, ...todos);
      const lines = todos.map((t) => `${t.status === 'done' ? '[x]' : t.status === 'in_progress' ? '[~]' : '[ ]'} ${t.content}`);
      return `OK, daftar tugas sekarang:\n${lines.join('\n') || '(kosong)'}`;
    },
  });

  const ask = tool({
    description:
      'Pause the turn to ask the user a question — use it when the request is ' +
      'ambiguous or a decision is theirs to make. Optionally offer numbered options.',
    inputSchema: z.object({
      question: z.string().describe('The question for the user'),
      options: z.array(z.string()).optional().describe('2-4 short options to choose from'),
    }),
    execute: async ({ question, options }) => {
      if (ctx.headless) {
        return 'ERROR: mode headless tidak punya user untuk ditanya. Ambil keputusan wajar dan lanjutkan.';
      }
      const answer = await ctx.ui.askUser(question, options);
      return `JAWABAN USER: ${answer}`;
    },
  });

  const task = tool({
    description:
      'Spawn a read-only sub-agent with its own context window to explore or review ' +
      'code, returning a single report. Use it for broad searches or reviews instead ' +
      'of flooding your own context with file dumps.',
    inputSchema: z.object({
      agent: z.enum(['explore', 'review', 'worker']).describe('explore: cari & petakan; review: audit; worker: kerjakan riset'),
      prompt: z.string().describe('Complete, self-contained instructions for the sub-agent'),
    }),
    execute: async ({ agent, prompt }) => {
      if (ctx.isSubagent) return 'ERROR: sub-agent tidak bisa menelurkan sub-agent lain.';
      const { runSubagent } = await import('../loop.js');
      return runSubagent(ctx, agent, prompt);
    },
  });

  const memoryFile = () => projectMemoryFile(ctx.cwd);

  const remember = tool({
    description:
      'Save a durable note about this project (decisions, conventions, gotchas) that ' +
      'persists across sessions.',
    inputSchema: z.object({ note: z.string().describe('One concise note') }),
    execute: async ({ note }) => {
      const file = memoryFile();
      mkdirSync(dirname(file), { recursive: true });
      appendFileSync(file, `- ${note}\n`, 'utf8');
      return `OK: note tersimpan di ${file}`;
    },
  });

  const recall = tool({
    description: 'Read all saved memory notes for this project.',
    inputSchema: z.object({}),
    execute: async () => {
      const file = memoryFile();
      if (!existsSync(file)) return '(belum ada memory untuk proyek ini)';
      const content = readFileSync(file, 'utf8').trim();
      return content || '(memory kosong)';
    },
  });

  const forget = tool({
    description: 'Clear all memory notes, or just the ones matching a substring.',
    inputSchema: z.object({
      match: z.string().optional().describe('Only remove notes containing this substring'),
    }),
    execute: async ({ match }) => {
      const file = memoryFile();
      if (!existsSync(file)) return '(belum ada memory untuk dihapus)';
      if (!match) {
        writeFileSync(file, '', 'utf8');
        return 'OK: semua memory dihapus.';
      }
      const kept = readFileSync(file, 'utf8')
        .split('\n')
        .filter((l) => l.trim() && !l.includes(match));
      writeFileSync(file, kept.length ? kept.join('\n') + '\n' : '', 'utf8');
      return `OK: memory yang cocok dihapus, ${kept.length} note tersisa.`;
    },
  });

  return { todo_write, ask, task, remember, recall, forget };
}
