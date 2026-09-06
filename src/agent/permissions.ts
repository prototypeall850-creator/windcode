import { dim, red, green, yellow } from '../util/ansi.js';
import type { ApprovalRequest, ApprovalAnswer, ToolContext } from './tools/types.js';

// ---------------------------------------------------------------------------
// Permission model (mirrors shiro-neko's approach):
//  1. Guard rules refuse outright — even under --yolo, even if allowlisted.
//  2. Session allowlist patterns approve silently ("always allow" from earlier).
//  3. --yolo auto-approves whatever the guard didn't refuse.
//  4. Otherwise the UI prompts y/a/n; "a" adds the request's allowPattern.
// ---------------------------------------------------------------------------

/** Commands that are refused before anything else can vouch for them. */
const GUARD_PATTERNS: RegExp[] = [
  /\brm\s+(-[a-z-]*\s+)*-[a-z-]*[rf][a-z-]*\b.*\s\/(\s|$)/i, // rm -rf /
  /\brm\s+-[a-z]*r[fv]?[a-z]*\s+(~|\$HOME|\/(?!tmp|home\/[^/]+\/\S))\b/i,
  /\bmkfs(\.\w+)?\b/i,
  /\bdd\s+[^\n]*of=\/dev\/(sd|nvme|disk|mmcblk)/i,
  /:\(\)\s*\{.*\};\s*:/, // fork bomb
  /\b(shutdown|reboot|poweroff|halt)\b/i,
  /\bgit\s+push\b[^&|;]*\s--force(-if-includes)?\b/i,
  /\bgit\s+push\s+-f\b/i,
  /\bgit\s+reset\s+--hard\s+origin\b/i,
  /\bdrop\s+(table|database)\b/i,
  /\bchmod\s+-R\s+777\s+\/(\s|$)/,
  /\b(format|del|rd)\s+\/[sq]?\s*c:[\s\\/]/i, // windows: format c:, del /s c:\
  /\bRemove-Item\b[^|;&]*-Recurse[^|;&]*-Force[^|;&]*C:\\(\s|$)/i,
  />\s*\/dev\/(sd|nvme|disk)/,
];

export function guardVerdict(command: string): string | null {
  for (const re of GUARD_PATTERNS) {
    if (re.test(command)) return command;
  }
  return null;
}

/** Files the read tools refuse to open (secrets). */
export function isSensitivePath(path: string): boolean {
  const base = path.split(/[\\/]/).pop() ?? path;
  return base === '.env' || base.startsWith('.env.') || base.endsWith('.pem') || base.endsWith('.key');
}

/** Glob-ish allowlist match: `git *` matches `git status` but not `gitk x`. */
function allowMatch(pattern: string, subject: string): boolean {
  const re = new RegExp(
    '^' +
      pattern
        .split('*')
        .map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
        .join('.*') +
      '$',
  );
  return re.test(subject);
}

function isAllowed(ctx: ToolContext, pattern: string | undefined, subject: string): boolean {
  if (!pattern) return false;
  for (const p of ctx.allowlist) {
    if (allowMatch(p, subject)) return true;
  }
  return false;
}

/**
 * Central approval gate. Returns true when the action may proceed.
 * Every mutating tool must pass through here exactly once.
 */
export async function approve(
  ctx: ToolContext,
  req: ApprovalRequest,
): Promise<boolean> {
  const subject = req.detail ?? req.title;

  if (guardVerdict(subject)) {
    console.log(red(`  ✕ ditolak guard: perintah destruktif tidak diizinkan (${req.title})`));
    return false;
  }
  if (isAllowed(ctx, req.allowPattern, subject)) return true;
  if (ctx.yolo) {
    console.log(dim(`  ▸ yolo: auto-approve ${req.title}`));
    return true;
  }
  if (ctx.headless) {
    console.log(red(`  ✕ headless menolak "${req.title}" (jalankan dengan --yolo untuk auto-approve)`));
    return false;
  }

  const answer: ApprovalAnswer = await ctx.ui.requestApproval(req);
  if (answer === 'a' && req.allowPattern) {
    ctx.allowlist.add(req.allowPattern);
  }
  return answer === 'y' || answer === 'a';
}

export function printDenied(note?: string): string {
  return note ? `DENIED: ${note}` : 'DENIED: user menolak aksi ini';
}

// Small helpers used by the approval prompt UI itself
export const approvalHint = () => dim('  [y]a  [a]lways  [n]o');
export const approvalColors = { red, green, yellow };
