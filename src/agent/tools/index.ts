import { z } from 'zod';
import { buildCoreTools } from './core.js';
import { buildEditPlusTools } from './editplus.js';
import { buildGitTools } from './git.js';
import { buildNetTools } from './net.js';
import { buildAgentTools } from './agent-tools.js';
import type { ToolContext, ToolSetName } from './types.js';

// ---------------------------------------------------------------------------
// Tool registry. Each set costs bytes on every request (name + description +
// schema), so selection accuracy drops as the list grows. Core is always on;
// everything else is opt-in via config toolSets.
// ---------------------------------------------------------------------------

export const TOOL_SETS: { id: ToolSetName; label: string; description: string }[] = [
  { id: 'core', label: 'core', description: 'read_file, write_file, edit_file, glob, grep, bash (selalu aktif)' },
  { id: 'edit-plus', label: 'edit-plus', description: 'multi_edit, apply_patch, read_many_files, list_dir, move_file, delete_file' },
  { id: 'git', label: 'git', description: 'git_status, git_diff, git_log, git_show, git_blame, git_branch, git_commit_message (read-only)' },
  { id: 'net', label: 'net', description: 'web_fetch (opt-in, akses https publik)' },
  { id: 'agent', label: 'agent', description: 'todo_write, ask, task (sub-agent), remember/recall/forget (memory)' },
];

export const VALID_SETS = TOOL_SETS.map((s) => s.id);

export function buildTools(
  ctx: ToolContext,
  enabledSets: ToolSetName[],
  opts: { headless: boolean },
): Record<string, any> {
  const sets = new Set<ToolSetName>(['core', ...enabledSets]);
  const tools: Record<string, any> = {
    ...buildCoreTools(ctx),
  };
  if (sets.has('edit-plus')) Object.assign(tools, buildEditPlusTools(ctx));
  if (sets.has('git')) Object.assign(tools, buildGitTools(ctx));
  if (sets.has('net')) Object.assign(tools, buildNetTools(ctx));
  if (sets.has('agent')) {
    const agentTools = buildAgentTools(ctx);
    if (opts.headless) delete agentTools.ask; // no user to answer in headless mode
    Object.assign(tools, agentTools);
  }
  return tools;
}

/** Runtime-validated set list from config (unknown names are dropped). */
export function resolveToolSets(raw: string[] | undefined): ToolSetName[] {
  return (raw ?? []).filter((s): s is ToolSetName =>
    (VALID_SETS as string[]).includes(s) && s !== 'core',
  );
}
