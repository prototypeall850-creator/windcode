import { z } from 'zod';
import { tool } from 'ai';
import type { ToolContext } from './types.js';

// ---------------------------------------------------------------------------
// net set — web_fetch, opt-in. Public HTTPS pages only, HTML → plain text,
// capped so one page can't eat the context window.
// ---------------------------------------------------------------------------

const FETCH_CAP = 30_000;

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<(br|hr)\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|tr|section|article|pre|blockquote)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim();
}

export function buildNetTools(_ctx: ToolContext): Record<string, any> {
  const web_fetch = tool({
    description:
      'Fetch a public HTTPS page and return its text content (HTML converted to ' +
      'readable text, capped at 30,000 characters). Opt-in tool set.',
    inputSchema: z.object({
      url: z.string().url().describe('Absolute https:// URL'),
    }),
    execute: async ({ url }) => {
      if (!url.startsWith('https://')) {
        return 'ERROR: hanya https:// yang diizinkan.';
      }
      let res: Response;
      try {
        res = await fetch(url, {
          redirect: 'follow',
          signal: AbortSignal.timeout(20_000),
          headers: { 'User-Agent': 'windcode/0.1 (coding agent)' },
        });
      } catch (e) {
        return `ERROR: fetch gagal: ${(e as Error).message}`;
      }
      if (!res.ok) return `ERROR: HTTP ${res.status} ${res.statusText}`;
      const type = res.headers.get('content-type') ?? '';
      const raw = await res.text();
      const text = type.includes('html') ? htmlToText(raw) : raw;
      const capped =
        text.length > FETCH_CAP ? text.slice(0, FETCH_CAP) + '\n...[terpotong di 30.000 karakter]' : text;
      return `URL: ${res.url || url}\n\n${capped || '(halaman kosong)'}`;
    },
  });

  return { web_fetch };
}
