import type { z } from 'zod';
import type { DiffLine } from '../../util/diff.js';

// ---------------------------------------------------------------------------
// Shared contracts between the UI layer, the permission system, and the tools.
// The agent loop builds a ToolContext once per run; tools receive it via closure.
// ---------------------------------------------------------------------------

export type ToolSetName = 'core' | 'edit-plus' | 'git' | 'net' | 'agent';

export type ApprovalAnswer = 'y' | 'a' | 'n';

export interface ApprovalRequest {
  title: string;
  /** Command line or short detail shown under the title. */
  detail?: string;
  /** Colored diff preview for file mutations. */
  diff?: DiffLine[];
  /** Pattern stored in the session allowlist when the user answers "a". */
  allowPattern?: string;
}

export interface TodoItem {
  content: string;
  status: 'pending' | 'in_progress' | 'done';
}

export interface ToolUI {
  /** Status line when a tool starts, e.g. `bash: git status`. */
  onToolStart(name: string, summary: string): void;
  onToolEnd(name: string, summary: string): void;
  /** Live stdout/stderr chunks from bash. */
  onCommandOutput(chunk: string): void;
  requestApproval(req: ApprovalRequest): Promise<ApprovalAnswer>;
  /** Used by the `ask` tool to pause the turn for the user. */
  askUser(question: string, options?: string[]): Promise<string>;
}

export interface ToolContext {
  cwd: string;
  /** One-shot mode: no interactive prompt available for `ask`. */
  headless: boolean;
  /** Auto-approve non-destructive actions (guard still refuses). */
  yolo: boolean;
  allowlist: Set<string>;
  ui: ToolUI;
  /** Shared todo state, rendered into the system prompt each step. */
  todos: TodoItem[];
  /** True inside a `task` sub-agent; prevents nested sub-agents. */
  isSubagent?: boolean;
  /** Model routing, so the `task` tool can spawn sub-agents on the same model. */
  runtime?: { config: unknown; providerId: string; modelId: string };
}

export type ToolResult = string;

export interface ToolDefinition {
  name: string;
  description: string;
  set: ToolSetName;
  parameters: z.ZodTypeAny;
  execute(input: any, ctx: ToolContext): Promise<ToolResult>;
}

export function toolError(message: string): string {
  return `ERROR: ${message}`;
}
