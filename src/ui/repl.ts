import * as readline from 'node:readline';
import { bold, dim, red, yellow, cyan } from '../util/ansi.js';
import { loadConfig, saveConfig, getProvider, type WindcodeConfig } from '../config.js';
import { runAgentTurn, friendlyError } from '../agent/loop.js';
import { TOOL_SETS, resolveToolSets } from '../agent/tools/index.js';
import type { ToolContext } from '../agent/tools/types.js';
import { createSession, saveSession, loadSession, listSessions, type Session } from '../session.js';
import { printBanner, printHelp, askApproval, askQuestion } from './render.js';

// ---------------------------------------------------------------------------
// Interactive REPL. One ToolContext lives for the whole session; the agent
// loop consumes it per turn. ctrl-c cancels the running turn, not the session.
// ---------------------------------------------------------------------------

export interface ReplOptions {
  config: WindcodeConfig;
  providerId: string;
  modelId: string;
  yolo: boolean;
  resumeId?: string;
  onExit?: () => void;
}

export async function startRepl(opts: ReplOptions): Promise<void> {
  let { providerId, modelId } = opts;
  let config = opts.config;
  let yolo = opts.yolo;
  const allowlist = new Set<string>();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: dim('windcode › '),
  });

  const resumed: Session | null = opts.resumeId ? loadSession(opts.resumeId) : null;
  if (opts.resumeId && !resumed) {
    console.log(red(`Sesi "${opts.resumeId}" tidak ditemukan — mulai sesi baru.`));
  }
  const session: Session =
    resumed ?? createSession(process.cwd(), providerId, modelId);
  if (resumed) {
    providerId = resumed.providerId || providerId;
    modelId = resumed.modelId || modelId;
    console.log(dim(`Melanjutkan sesi ${resumed.id} (${resumed.messages.length} pesan).`));
  }

  const todos = session.todos;

  const ctx: ToolContext = {
    cwd: process.cwd(),
    headless: false,
    yolo,
    allowlist,
    todos,
    ui: {
      onToolStart: () => {},
      onToolEnd: () => {},
      onCommandOutput: (chunk) => process.stdout.write(dim(chunk)),
      requestApproval: (req) => askApproval(rl, req),
      askUser: (q, o) => askQuestion(rl, q, o),
    },
  };

  const providerName = getProvider(providerId)?.name ?? providerId;
  const activeSets = ['core', ...resolveToolSets(config.toolSets)];
  printBanner(providerName, modelId, ctx.cwd, activeSets, yolo);

  let abort: AbortController | null = null;
  let running = false;

  rl.on('SIGINT', () => {
    if (running && abort) {
      abort.abort();
      console.log(yellow('\n  (membatalkan turn…)'));
    } else {
      console.log(dim('\n  sampai jumpa!'));
      rl.close();
      process.exit(0);
    }
  });

  const save = () => {
    session.providerId = providerId;
    session.modelId = modelId;
    session.todos = todos;
    saveSession(session);
  };

  const showModels = async () => {
    console.log(bold('\nProvider terdaftar:'));
    for (const p of ['zen', 'ollama', 'openrouter', 'groq', 'cerebras', 'github-models', 'google', 'anthropic', 'openai']) {
      const def = getProvider(p);
      if (!def) continue;
      const free = def.models.some((m) => m.free) ? yellow(' [punya model gratis]') : '';
      console.log(`  ${p.padEnd(15)} ${def.name}${free}`);
    }
    const raw = await new Promise<string>((resolve) =>
      rl.question(dim('provider/model (mis. zen/big-pickle, kosongkan untuk batal): '), (a) => resolve(a.trim())),
    );
    if (!raw) return;
    const slash = raw.indexOf('/');
    if (slash === -1) {
      modelId = raw;
    } else {
      providerId = raw.slice(0, slash);
      modelId = raw.slice(slash + 1);
      if (!getProvider(providerId)) {
        console.log(red(`Provider "${providerId}" tidak dikenal.`));
        return;
      }
    }
    config.defaultProvider = providerId;
    config.defaultModel = modelId;
    saveConfig(config);
    console.log(cyan(`✓ model sekarang: ${providerId}/${modelId}`));
  };

  const handleSlash = async (line: string): Promise<boolean> => {
    const [cmd, ...args] = line.split(/\s+/);
    switch (cmd) {
      case '/help':
        printHelp();
        return true;
      case '/model':
        await showModels();
        return true;
      case '/tools':
        console.log(bold('\nTool sets:'));
        for (const s of TOOL_SETS) {
          const active = s.id === 'core' || config.toolSets.includes(s.id);
          console.log(`  ${active ? cyan('●') : dim('○')} ${s.id.padEnd(10)} ${s.description}`);
        }
        console.log(dim('\n  ubah via "toolSets" di ~/.windcode/config.json\n'));
        return true;
      case '/sessions': {
        const list = listSessions().slice(0, 10);
        if (list.length === 0) console.log(dim('  belum ada sesi tersimpan.'));
        list.forEach((s, i) => console.log(`  ${i + 1}. ${s.id}  ${dim(`${s.messages} pesan — ${s.preview}`)}`));
        return true;
      }
      case '/resume': {
        const target = args[0] ?? listSessions()[0]?.id;
        if (!target) {
          console.log(dim('  tidak ada sesi untuk dilanjutkan.'));
          return true;
        }
        const s = loadSession(target);
        if (!s) {
          console.log(red(`  sesi "${target}" tidak ditemukan.`));
          return true;
        }
        session.id = s.id;
        session.messages = s.messages;
        session.todos = s.todos ?? [];
        todos.splice(0, todos.length, ...(s.todos ?? []));
        console.log(cyan(`✓ sesi ${s.id} dimuat (${session.messages.length} pesan).`));
        return true;
      }
      case '/yolo':
        yolo = !yolo;
        ctx.yolo = yolo;
        console.log(yellow(`  yolo ${yolo ? 'ON — auto-approve non-destruktif' : 'OFF'}`));
        return true;
      case '/clear':
        session.messages = [];
        todos.splice(0, todos.length);
        console.log(dim('  konteks dikosongkan, sesi baru dimulai.'));
        return true;
      case '/exit':
      case '/quit':
        save();
        console.log(dim('  sampai jumpa!'));
        rl.close();
        opts.onExit?.();
        process.exit(0);
      default:
        console.log(red(`  perintah tidak dikenal: ${cmd} (coba /help)`));
        return true;
    }
  };

  rl.prompt();
  rl.on('line', async (line) => {
    const input = line.trim();
    if (!input) {
      rl.prompt();
      return;
    }
    if (input.startsWith('/')) {
      await handleSlash(input);
      save();
      rl.prompt();
      return;
    }

    running = true;
    abort = new AbortController();
    try {
      session.messages.push({ role: 'user', content: input });
      console.log('');
      await runAgentTurn({
        config,
        providerId,
        modelId,
        messages: session.messages,
        ctx,
        signal: abort.signal,
      });
      console.log('\n');
      save();
    } catch (err) {
      const e = friendlyError(err);
      console.log(red(`\n  error: ${e.message}\n`));
      // keep the user message out if the turn failed before any response
      save();
    } finally {
      running = false;
      abort = null;
      rl.prompt();
    }
  });

  rl.on('close', () => {
    process.exit(0);
  });
}
