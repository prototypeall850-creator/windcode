// Node port of the Bun file/process APIs shiro-neko's engine relies on.
// Same call shapes, Node underneath — so the ported engine files stay 1:1
// readable against the upstream repo.
import { spawn as nodeSpawn, spawnSync, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';

export const file = {
  text(p: string): string {
    return readFileSync(p, 'utf8');
  },
  json<T = unknown>(p: string): T {
    return JSON.parse(readFileSync(p, 'utf8')) as T;
  },
  exists(p: string): boolean {
    return existsSync(p);
  },
  bytes(p: string, start = 0, end?: number): Uint8Array {
    const buf = readFileSync(p);
    return new Uint8Array(buf.subarray(start, end));
  },
};

export function write(p: string, data: string | Uint8Array): void {
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, data);
}

export const exists = existsSync;
export const uuid = (): string => randomUUID();
export { readFileSync, rmSync, statSync, readdirSync, mkdirSync };

/** Files matching a suffix under dir (non-recursive, like Bun.Glob '*.json'). */
export function lsMatching(dir: string, suffix: string): string[] {
  try {
    return readdirSync(dir).filter((f) => f.endsWith(suffix));
  } catch {
    return [];
  }
}

export interface SpawnResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

/** Fire-and-collect spawn, argv array form (no shell). */
export function spawnCollect(
  cmd: string[],
  opts: { cwd?: string; stdin?: string; timeoutMs?: number; env?: NodeJS.ProcessEnv } = {},
): Promise<SpawnResult> {
  return new Promise((resolve, reject) => {
    let child: ChildProcess;
    try {
      child = nodeSpawn(cmd[0]!, cmd.slice(1), {
        cwd: opts.cwd,
        env: opts.env,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (err) {
      resolve({ exitCode: 127, stdout: '', stderr: String(err) });
      return;
    }
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (d) => (stdout += d.toString()));
    child.stderr?.on('data', (d) => (stderr += d.toString()));
    if (opts.stdin !== undefined) child.stdin?.write(opts.stdin);
    child.stdin?.end();
    const timer =
      opts.timeoutMs !== undefined
        ? setTimeout(() => child.kill('SIGTERM'), opts.timeoutMs)
        : undefined;
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      resolve({ exitCode: code, stdout, stderr });
    });
    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      reject(err);
    });
  });
}

/** Drain all of stdin (pipelines: echo "prompt" | windcode -p ...). */
export function readStdinAll(): Promise<string> {
  return new Promise((resolve, reject) => {
    if (process.stdin.isTTY) {
      resolve('');
      return;
    }
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => (data += c));
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}

const SPECIAL_GLOB_CHARS = '.+^${}()|[]\\'.split('');

/** Bun.Glob replacement: fnmatch-style glob with ** support. */
export function globToRegex(pattern: string): (rel: string) => boolean {
  let re = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]!;
    if (c === '*') {
      if (pattern[i + 1] === '*') {
        if (pattern[i + 2] === '/') {
          re += '(?:.*/)?';
          i += 2;
        } else {
          re += '.*';
          i += 1;
        }
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else if (SPECIAL_GLOB_CHARS.includes(c)) {
      re += '\\' + c;
    } else {
      re += c;
    }
  }
  const compiled = new RegExp('^' + re + '$');
  return (rel: string) => compiled.test(rel);
}

export type { ChildProcess };
export { spawnSync };
