import type { ModelMessage } from 'ai';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { NotebookState } from './notebook.js';
import { exists, file as fsfile, write, uuid, lsMatching } from "./fsx.js";

export type SessionRecord = {
  id: string;
  createdAt: string;
  updatedAt: string;
  cwd: string;
  provider: string;
  model: string;
  title: string;
  inputTokens: number;
  outputTokens: number;
  /** Estimated USD, absent when the model has no known rate. */
  costUsd?: number;
  /** Task list and notes, so a resumed session keeps its plan. */
  notebook?: NotebookState;
  messages: ModelMessage[];
};

/** Resolved per call so tests can point WINDCODE_HOME at a temp directory. */
const root = () => join(process.env['WINDCODE_HOME'] ?? homedir(), '.windcode');
const dir = () => join(root(), 'sessions');

const file = (id: string) => join(dir(), `${id}.json`);

export function newId(): string {
  return uuid();
}

export async function save(rec: SessionRecord): Promise<void> {
  await write(file(rec.id), JSON.stringify({ ...rec, updatedAt: new Date().toISOString() }, null, 2));
}

export async function load(id: string): Promise<SessionRecord | undefined> {
  if (!exists(file(id))) return undefined;
  try {
    return fsfile.json<SessionRecord>(file(id));
  } catch {
    return undefined;
  }
}

export async function list(limit = 20): Promise<SessionRecord[]> {
  const found: SessionRecord[] = [];
  // Bun.Glob throws ENOENT on a directory that does not exist yet, which is the
  // normal state on a fresh install.
  try {
    for (const name of lsMatching(dir(), '.json')) {
      const rec = await load(name.replace(/\.json$/, ''));
      if (rec) found.push(rec);
    }
  } catch {
    return [];
  }
  return found.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, limit);
}

export async function latest(cwd?: string): Promise<SessionRecord | undefined> {
  const all = await list(100);
  return cwd ? all.find((r) => r.cwd === cwd) : all[0];
}

/** Resolves a full id or a unique prefix, so users can type the first few chars. */
export async function resolveId(prefix: string): Promise<string | undefined> {
  if (exists(file(prefix))) return prefix;
  const matches = (await list(100)).filter((r) => r.id.startsWith(prefix));
  return matches.length === 1 ? matches[0]!.id : undefined;
}

export function titleOf(messages: ModelMessage[]): string {
  const first = messages.find((m) => m.role === 'user');
  const text = typeof first?.content === 'string' ? first.content : '';
  return text.length > 60 ? `${text.slice(0, 60)}...` : text || 'untitled';
}

const MAX_HISTORY = 200;

/** Per-directory file, hashed because a path is not a safe filename. */
const historyFile = (cwd: string) =>
  join(root(), 'history', `${createHash('sha256').update(cwd).digest('hex').slice(0, 16)}.json`);

export async function loadHistory(cwd = process.cwd()): Promise<string[]> {
  if (!exists(historyFile(cwd))) return [];
  try {
    const parsed: unknown = fsfile.json(historyFile(cwd));
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/** Appends unless it repeats the previous entry, keeping the newest MAX_HISTORY. */
export async function appendHistory(prompt: string, cwd = process.cwd()): Promise<string[]> {
  const text = prompt.trim();
  if (!text) return loadHistory(cwd);
  const existing = await loadHistory(cwd);
  if (existing.at(-1) === text) return existing;
  const next = [...existing, text].slice(-MAX_HISTORY);
  await write(historyFile(cwd), JSON.stringify(next, null, 2));
  return next;
}

export { dir as sessionsDir, root as shiroHome };
