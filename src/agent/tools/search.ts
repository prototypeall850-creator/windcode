import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative, basename, dirname, sep } from 'node:path';
import { spawnSync } from 'node:child_process';

// ---------------------------------------------------------------------------
// glob + grep engines. Dependency-free: glob is a small pattern matcher and
// grep shells out to ripgrep when present, falling back to a JS scanner.
// ---------------------------------------------------------------------------

const SKIP_DIRS = new Set(['.git', 'node_modules', '__pycache__', '.venv', 'dist', 'build']);

const MAX_RESULTS = 200;

function globToRegex(pattern: string): RegExp {
  let re = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '*') {
      if (pattern[i + 1] === '*') {
        // ** crosses directory boundaries
        if (pattern[i + 2] === '/') {
          re += '(?:.*/)?';
          i += 2;
        } else {
          re += '.*';
          i++;
        }
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else if (c === '{') {
      const end = pattern.indexOf('}', i);
      const body = pattern
        .slice(i + 1, end)
        .split(',')
        .map((s) => s.replace(/[.+^${}()|[\]\\]/g, '\\$&'))
        .join('|');
      re += `(?:${body})`;
      i = end;
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${re}$`);
}

/** Parse .gitignore into a list of simple matchers (covers the common cases). */
function loadGitignore(dir: string): RegExp[] {
  const rules: RegExp[] = [];
  let cur = dir;
  for (let depth = 0; depth < 5; depth++) {
    const f = join(cur, '.gitignore');
    if (existsSync(f)) {
      for (const line of readFileSync(f, 'utf8').split('\n')) {
        const entry = line.trim();
        if (!entry || entry.startsWith('#') || entry === '!') continue;
        const negated = entry.startsWith('!');
        const pat = entry.replace(/^!/, '').replace(/\/$/, '');
        try {
          const re = globToRegex(pat.includes('/') ? pat : `**/${pat}`);
          if (!negated) rules.push(re);
        } catch {
          /* ignore malformed pattern */
        }
      }
    }
    const parent = dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return rules;
}

function walk(root: string, visit: (abs: string, rel: string) => boolean | void): void {
  const stack: string[] = [root];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    const ignores = loadGitignore(dir);
    for (const entry of entries) {
      const abs = join(dir, entry);
      const rel = relative(root, abs).split(sep).join('/');
      let st;
      try {
        st = statSync(abs);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        if (SKIP_DIRS.has(entry)) continue;
        if (ignores.some((re) => re.test(rel))) continue;
        stack.push(abs);
      } else {
        if (ignores.some((re) => re.test(rel))) continue;
        if (visit(abs, rel) === false) return;
      }
    }
  }
}

export function globSearch(root: string, pattern: string): string[] {
  const re = globToRegex(pattern);
  const out: string[] = [];
  walk(root, (abs, rel) => {
    if (re.test(rel)) {
      out.push(abs);
      if (out.length >= MAX_RESULTS) return false;
    }
    return;
  });
  return out.sort();
}

function isBinary(buf: Buffer): boolean {
  return buf.subarray(0, 1024).includes(0);
}

export function grepSearch(root: string, pattern: string, include?: string): string {
  let re: RegExp;
  try {
    re = new RegExp(pattern, 'i');
  } catch (e) {
    return `ERROR: regex tidak valid: ${(e as Error).message}`;
  }
  const includeRe = include ? globToRegex(include.replace(/^\*\*/, '**')) : null;

  // try ripgrep first
  const rg = spawnSync(
    'rg',
    [
      '-n',
      '--no-heading',
      '--color',
      'never',
      '-S',
      '--max-count',
      '20',
      '--glob',
      '!{.git,node_modules,dist,build}/**',
      ...(include ? ['--glob', include] : []),
      pattern,
      root,
    ],
    { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 },
  );
  if (rg.status === 0 && rg.stdout) {
    const lines = rg.stdout.trimEnd().split('\n').slice(0, MAX_RESULTS);
    return lines.join('\n') || 'Tidak ada yang cocok.';
  }
  if (rg.error && (rg.error as NodeJS.ErrnoException).code !== 'ENOENT' && rg.status !== 1) {
    // ripgrep exists but failed; fall through to JS search
  }

  // JS fallback
  const out: string[] = [];
  const targets: string[] = [];
  const rootStat = statSync(root);
  if (rootStat.isFile()) {
    targets.push(root);
  } else {
    walk(root, (abs, rel) => {
      if (!includeRe || includeRe.test(basename(rel))) targets.push(abs);
      return;
    });
  }
  for (const file of targets) {
    if (out.length >= MAX_RESULTS) break;
    let content: string;
    try {
      const buf = readFileSync(file);
      if (isBinary(buf)) continue;
      content = buf.toString('utf8');
    } catch {
      continue;
    }
    const lines = content.split('\n');
    for (let i = 0; i < lines.length && out.length < MAX_RESULTS; i++) {
      if (re.test(lines[i])) {
        const rel = relative(rootStat.isFile() ? dirname(root) : root, file).split(sep).join('/');
        out.push(`${rel}:${i + 1}: ${lines[i].trim().slice(0, 300)}`);
      }
    }
  }
  return out.join('\n') || 'Tidak ada yang cocok.';
}
