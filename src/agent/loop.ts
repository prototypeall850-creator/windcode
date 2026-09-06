import { streamText, stepCountIs, APICallError, type ModelMessage, type TextStreamPart } from 'ai';
import { dim, cyan, red } from '../util/ansi.js';
import { resolveModel } from '../llm/client.js';
import { buildTools, resolveToolSets } from './tools/index.js';
import { buildSystemPrompt, trimMessages } from './context.js';
import type { ToolContext, TodoItem } from './tools/types.js';
import type { WindcodeConfig } from '../config.js';

// ---------------------------------------------------------------------------
// The agent loop. One call = one user turn. Internally the AI SDK drives the
// multi-step cycle: model → tool calls → tool results → model … until the
// model answers in plain text (or the step cap is hit). We only observe the
// stream and route UI events.
// ---------------------------------------------------------------------------

const MAX_STEPS = 40;

export interface TurnOptions {
  config: WindcodeConfig;
  providerId: string;
  modelId: string;
  messages: ModelMessage[];
  ctx: ToolContext;
  signal?: AbortSignal;
  /** Suppress per-step status lines (used for sub-agents). */
  quiet?: boolean;
}

export async function runAgentTurn(opts: TurnOptions): Promise<void> {
  const { config, providerId, modelId, messages, ctx } = opts;
  ctx.runtime = { config, providerId, modelId };
  const model = resolveModel(config, providerId, modelId);
  const toolSets = resolveToolSets(config.toolSets);
  const tools = buildTools(ctx, toolSets, { headless: ctx.headless });

  const system = buildSystemPrompt({
    cwd: ctx.cwd,
    toolSetNames: ['core', ...toolSets],
    todos: ctx.todos,
  });

  const result = streamText({
    model,
    system,
    messages: trimMessages(messages),
    tools,
    stopWhen: stepCountIs(MAX_STEPS),
    abortSignal: opts.signal,
  });

  try {
    for await (const part of result.fullStream) {
      const p = part as TextStreamPart<any>;
      switch (p.type) {
        case 'text-delta':
          process.stdout.write(p.text);
          break;
        case 'tool-input-start':
          if (!opts.quiet) console.log(dim(`  ▸ ${p.toolName}…`));
          break;
        case 'tool-call':
          if (!opts.quiet) {
            const input = shorten(JSON.stringify((p as any).input));
            console.log(cyan(`  ⚙ ${p.toolName} ${input}`));
          }
          break;
        case 'tool-error':
          console.log(red(`  ✕ ${p.toolName}: ${shorten(String((p as any).error), 200)}`));
          break;
        case 'error':
          throw (p as any).error;
        default:
          break;
      }
    }
    const finish = await result.finishReason;
    if (finish === 'tool-calls') {
      // step cap reached mid-work; tell the user the turn stopped early
      if (!opts.quiet) {
        console.log(dim('\n  (berhenti: cap langkah tercapai — kirim "lanjut" untuk meneruskan)'));
      }
    }
  } catch (err) {
    throw friendlyError(err);
  }

  // append assistant + tool messages so the conversation can continue
  const response = await result.response;
  messages.push(...response.messages);
}

export function friendlyError(err: unknown): Error {
  // Surface provider detail (status + response body) so "gagal" is diagnosable.
  if (APICallError.isInstance(err)) {
    const status = err.statusCode ?? '?';
    const body = err.responseBody ? `\nBalasan server: ${shorten(err.responseBody.trim(), 300)}` : '';
    if (err.statusCode === 429 || /rate limit|quota exceeded|too many requests/i.test(err.message)) {
      return new Error(
        'Rate limit / kuota habis. Coba ganti model atau provider: /model provider/model ' +
          '(mis. /model zen/deepseek-v4-flash-free)',
      );
    }
    if (err.statusCode === 401 || err.statusCode === 403) {
      return new Error(
        `API key ditolak (HTTP ${status}). Cek key-nya: \`windcode login\` atau env var provider.${body}`,
      );
    }
    if (/model.*(not found|does not exist|invalid|unknown)/i.test(`${err.message} ${err.responseBody ?? ''}`)) {
      return new Error(
        `Model tidak dikenal endpoint-nya (HTTP ${status}). Lihat daftar yang valid: windcode models${body}`,
      );
    }
    return new Error(`Provider error HTTP ${status}: ${err.message}${body}`);
  }

  const e = err as { message?: string; statusCode?: number; name?: string };
  const msg = e?.message ?? String(err);
  if (e?.name === 'AbortError' || /abort/i.test(msg)) {
    return new Error('Dibatalkan.');
  }
  if (/fetch failed|ENOTFOUND|ECONNREFUSED|network/i.test(msg)) {
    return new Error(
      `Gagal menghubungi provider: ${msg}\nPeriksa koneksi, atau pakai /model untuk pindah provider.`,
    );
  }
  return new Error(msg);
}

function shorten(s: string, max = 120): string {
  return s.length > max ? s.slice(0, max) + '…' : s;
}

// ---------------------------------------------------------------------------
// Sub-agent: isolated messages, read-only tools, one report back.
// ---------------------------------------------------------------------------

const SUBAGENT_PROMPTS: Record<string, string> = {
  explore:
    'Kamu sub-agent eksplorasi. Peta kode yang diminta, laporkan path penting, ' +
    'simbol, dan alur singkat. Jangan mengubah apa pun.',
  review:
    'Kamu sub-agent review. Audit kode yang diminta: bug, risiko keamanan, dan ' +
    'desain. Laporkan temuan berurut prioritas. Jangan mengubah apa pun.',
  worker:
    'Kamu sub-agent pekerja riset. Kumpulkan informasi yang diminta dan laporkan ' +
    'ringkas. Jangan mengubah apa pun.',
};

export async function runSubagent(
  parentCtx: ToolContext,
  agentKind: string,
  prompt: string,
): Promise<string> {
  const rt = parentCtx.runtime as { config: WindcodeConfig; providerId: string; modelId: string } | undefined;
  if (!rt) {
    return 'ERROR: konfigurasi sub-agent tidak tersedia.';
  }
  const { config, providerId, modelId } = rt;

  const subCtx: ToolContext = {
    ...parentCtx,
    isSubagent: true,
    todos: [],
    // sub-agents only inspect: allowlist carries over, but no new approvals —
    // a sub-agent never prompts; refusal keeps the report honest.
    yolo: false,
    ui: {
      ...parentCtx.ui,
      onCommandOutput: () => {},
      requestApproval: async () => 'n',
      askUser: async () => '(tidak ada user untuk sub-agent)',
    },
  };

  const subMessages: ModelMessage[] = [
    { role: 'user', content: `${SUBAGENT_PROMPTS[agentKind] ?? SUBAGENT_PROMPTS.explore}\n\nTugas: ${prompt}` },
  ];

  const model = resolveModel(config, providerId, modelId);
  const readToolSets = resolveToolSets(['git']); // read-only extras only
  const tools = buildTools(subCtx, readToolSets, { headless: true });

  try {
    const result = streamText({
      model,
      system:
        'Kamu sub-agent read-only dengan tools inspeksi (read_file, read_many_files, ' +
        'glob, grep, list_dir, git). Bekerja mandiri, jangan bertanya, dan akhiri ' +
        'dengan satu laporan padat.',
      messages: subMessages,
      tools,
      stopWhen: stepCountIs(20),
    });
    for await (const part of result.fullStream) {
      void part; // consume silently
    }
    const response = await result.response;
    const text = response.messages
      .filter((m) => m.role === 'assistant')
      .map((m) =>
        typeof m.content === 'string'
          ? m.content
          : Array.isArray(m.content)
            ? m.content
                .filter((c: any) => c.type === 'text')
                .map((c: any) => c.text)
                .join('\n')
            : '',
      )
      .join('\n')
      .trim();
    return text || '(sub-agent tanpa laporan)';
  } catch (err) {
    return `ERROR sub-agent: ${friendlyError(err).message}`;
  }
}

export type { TodoItem };
