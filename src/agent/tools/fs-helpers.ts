import { statSync, readFileSync, existsSync } from 'node:fs';
import { resolve, relative, isAbsolute } from 'node:path';
import { isSensitivePath } from '../permissions.js';
import { diffLines, type DiffLine } from '../../util/diff.js';
import { toolError } from './types.js';

export const MAX_FILE_BYTES = 256 * 1024;
export const MAX_READ_LINES = 2000;

/** Resolve a tool path against cwd and keep it inside the project. */
export function resolveInCwd(cwd: string, p: string): string {
  const abs = isAbsolute(p) ? p : resolve(cwd, p);
  return abs;
}

export function relFromCwd(cwd: string, abs: string): string {
  return relative(cwd, abs) || '.';
}

export function checkReadable(cwd: string, abs: string): string | null {
  if (isSensitivePath(relFromCwd(cwd, abs)) || isSensitivePath(abs)) {
    return 'file sensitif (.env/.pem/.key) tidak boleh dibaca oleh agent';
  }
  if (!existsSync(abs)) return `file tidak ditemukan: ${relFromCwd(cwd, abs)}`;
  const st = statSync(abs);
  if (st.isDirectory()) return 'path adalah direktori, bukan file';
  if (st.size > MAX_FILE_BYTES) {
    return `file terlalu besar (${(st.size / 1024).toFixed(0)}KB, batas ${MAX_FILE_BYTES / 1024}KB)`;
  }
  // crude binary sniff: NUL byte in the first 1KB
  const fd = readFileSync(abs);
  if (fd.subarray(0, 1024).includes(0)) return 'file biner — tidak bisa dibaca sebagai teks';
  return null;
}

export function numberLines(text: string, offset = 1, limit = MAX_READ_LINES): string {
  const lines = text.split('\n');
  const slice = lines.slice(offset - 1, offset - 1 + limit);
  const pad = String(offset + slice.length).length;
  return slice.map((l, i) => `${String(offset + i).padStart(pad)}| ${l}`).join('\n');
}

/** Build a diff preview for a prospective write/edit. */
export function previewDiff(abs: string, oldContent: string, newContent: string): DiffLine[] {
  return diffLines(oldContent, newContent);
}

export { toolError };
