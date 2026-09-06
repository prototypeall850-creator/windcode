import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';

// All windcode state lives in ~/.windcode — same layout on Termux, Linux, Windows.
export const WINDCODE_DIR = join(homedir(), '.windcode');

export const CONFIG_FILE = join(WINDCODE_DIR, 'config.json');
export const SESSIONS_DIR = join(WINDCODE_DIR, 'sessions');

export function ensureWindcodeDir(): void {
  mkdirSync(WINDCODE_DIR, { recursive: true });
  mkdirSync(SESSIONS_DIR, { recursive: true });
}

// Per-project memory, stored inside the project itself (gitignorable by the user).
export function projectMemoryFile(cwd: string): string {
  return join(cwd, '.windcode', 'memory.md');
}
