import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { SESSIONS_DIR, ensureWindcodeDir } from './util/paths.js';
import type { ModelMessage } from 'ai';
import type { TodoItem } from './agent/tools/types.js';

// ---------------------------------------------------------------------------
// Sessions: one JSON file per conversation in ~/.windcode/sessions/.
// ---------------------------------------------------------------------------

export interface Session {
  id: string;
  createdAt: string;
  updatedAt: string;
  cwd: string;
  providerId: string;
  modelId: string;
  messages: ModelMessage[];
  todos: TodoItem[];
}

export function newSessionId(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const rand = Math.random().toString(36).slice(2, 6);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}_${rand}`;
}

export function createSession(cwd: string, providerId: string, modelId: string): Session {
  const now = new Date().toISOString();
  return {
    id: newSessionId(),
    createdAt: now,
    updatedAt: now,
    cwd,
    providerId,
    modelId,
    messages: [],
    todos: [],
  };
}

export function saveSession(session: Session): void {
  ensureWindcodeDir();
  session.updatedAt = new Date().toISOString();
  writeFileSync(
    join(SESSIONS_DIR, `${session.id}.json`),
    JSON.stringify(session, null, 2),
    'utf8',
  );
}

export function sessionFilePath(id: string): string {
  return join(SESSIONS_DIR, `${id}.json`);
}

export function loadSession(id: string): Session | null {
  const file = sessionFilePath(id);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as Session;
  } catch {
    return null;
  }
}

export function listSessions(): { id: string; updatedAt: string; messages: number; preview: string }[] {
  ensureWindcodeDir();
  const out: { id: string; updatedAt: string; messages: number; preview: string }[] = [];
  for (const file of readdirSync(SESSIONS_DIR)) {
    if (!file.endsWith('.json')) continue;
    try {
      const s = JSON.parse(readFileSync(join(SESSIONS_DIR, file), 'utf8')) as Session;
      const firstUser = s.messages.find((m) => m.role === 'user');
      const preview =
        typeof firstUser?.content === 'string'
          ? firstUser.content.slice(0, 60)
          : Array.isArray(firstUser?.content)
            ? firstUser.content
                .filter((c: any) => c.type === 'text')
                .map((c: any) => c.text)
                .join(' ')
                .slice(0, 60)
            : '(lanjutan)';
      out.push({ id: s.id, updatedAt: s.updatedAt, messages: s.messages.length, preview });
    } catch {
      /* skip corrupt session files */
    }
  }
  return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
