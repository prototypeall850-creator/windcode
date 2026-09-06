import * as readline from 'node:readline';
import { dim, bold, red, yellow, cyan, green } from '../util/ansi.js';
import { loadConfig, writeConfigFile, resolveModel, configPath, type Config } from '../config.js';
import { presetById, fetchModels } from '../providers.js';
import { parseCommand, HELP, type CommandAction } from '../commands.js';
import * as store from '../store.js';
import { usageLine } from '../pricing.js';
import { renderSkills, type Skill } from '../skills.js';
import type { Memory } from '../memory.js';
import type { PluginHost } from '../plugins.js';
import type { AgentEvent, Session } from '../session.js';
import type { AgentVariant } from '../agents.js';
import { resolveAgent, isThinkingLevel, VARIANTS } from '../agents.js';
import { askApproval, askQuestion, printBanner } from './render.js';

// ---------------------------------------------------------------------------
// Interactive REPL over the Session engine — readline-based, keyboard-
// friendly for Termux (no exotic key bindings).
// ---------------------------------------------------------------------------

export interface ReplOptions {
  session: Session;
  config: Config;
  record: store.SessionRecord;
  skills: Skill[];
  memory?: Memory;
  plugins?: PluginHost;
  agentVariant: AgentVariant;
  onExit?: () => void;
}

export async function startRepl(opts: ReplOptions): Promise<void> {
  const { session, record, plugins } = opts;
  let cfg = opts.config;
  let agentVariant = opts.agentVariant;
  let closed = false;

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: dim('windcode › '),
  });

  const persistNow = () => persist();

  function persist(): void {
    record.messages = session.messages;
    record.title = store.titleOf(session.messages);
    record.inputTokens = session.inputTokens;
    record.outputTokens = session.outputTokens;
    record.notebook = session.notebook.state();
    store.save(record);
  }

  let abort: AbortController | null = null;
  let running = false;

  rl.on('SIGINT', () => {
    if (running && abort) {
      abort.abort();
      console.log(yellow('\n  (membatalkan turn…)'));
    } else {
      persistNow();
      console.log(dim('\n  sampai jumpa!'));
      rl.close();
      process.exit(0);
    }
  });

  const providerLine = () => {
    const preset = presetById(cfg.provider);
    return `${preset?.label ?? cfg.provider}/${cfg.model}`;
  };

  printBanner(providerLine(), process.cwd(), session.activeTools(), Boolean(plugins?.plugins.length));

  async function runTurn(text: string): Promise<void> {
    running = true;
    abort = new AbortController();
    try {
      for await (const ev of session.send(text)) {
        renderEvent(ev);
      }
      console.log('');
      persist();
    } catch (err) {
      console.log(red(`\n  error: ${err instanceof Error ? err.message : String(err)}`));
      persist();
    } finally {
      running = false;
      abort = null;
      rl.prompt();
    }
  }

  function renderEvent(ev: AgentEvent): void {
    switch (ev.type) {
      case 'text':
        process.stdout.write(ev.text);
        break;
      case 'reasoning':
        process.stdout.write(dim(ev.text));
        break;
      case 'tool-start':
        break;
      case 'tool-call':
        console.log(cyan(`  ⚙ ${ev.name} ${summarizeInput(ev.input)}`));
        break;
      case 'tool-output':
        process.stdout.write(dim(ev.chunk));
        break;
      case 'tool-result':
        break;
      case 'tool-error':
        console.log(red(`  ✕ ${ev.name}: ${short(String(ev.error), 200)}`));
        break;
      case 'tool-denied':
        console.log(yellow(`  ⊘ ${ev.name} ditolak user`));
        break;
      case 'compacted':
        console.log(dim(`  ⌁ konteks dipadatkan (${ev.before} → ${ev.after} pesan)`));
        break;
      case 'notice':
        console.log(yellow(`  ℹ ${ev.text}`));
        break;
      case 'error':
        console.log(red(`  error: ${ev.error instanceof Error ? ev.error.message : String(ev.error)}`));
        break;
      case 'done':
        break;
    }
  }

  function summarizeInput(input: unknown): string {
    const s = typeof input === 'string' ? input : JSON.stringify(input) ?? '';
    return short(s, 140);
  }

  async function listModelsInteractive(): Promise<void> {
    const preset = presetById(cfg.provider);
    if (!preset) return;
    console.log(dim(`\nMengambil daftar model dari ${preset.label}…`));
    const result = await fetchModels(preset, cfg.apiKey ?? '');
    if (result.warning) console.log(dim(`  (${result.warning})`));
    const models = result.models;
    if (models.length === 0) {
      console.log(red('  tidak ada model yang dilaporkan endpoint.'));
      return;
    }
    models.slice(0, 40).forEach((m, i) => console.log(`  ${i + 1}. ${m}`));
    if (models.length > 40) console.log(dim(`  … dan ${models.length - 40} lagi`));
    const raw = await new Promise<string>((resolve) =>
      rl.question(dim('model id (nomor atau ketik manual, kosongkan untuk batal): '), (a) => resolve(a.trim())),
    );
    if (!raw) return;
    const n = parseInt(raw, 10);
    const modelId = Number.isInteger(n) && n >= 1 && n <= Math.min(models.length, 40) ? models[n - 1]! : raw;
    cfg = { ...cfg, model: modelId };
    writeConfigFile({ model: modelId });
    session.setModel(resolveModel(cfg));
    record.model = modelId;
    console.log(green(`✓ model: ${modelId}`));
  }

  async function switchAgent(arg: string): Promise<void> {
    if (!arg) {
      console.log(`  agent: ${agentVariant.name}  thinking: ${agentVariant.thinking}`);
      console.log(dim(`  pilihan: ${VARIANTS.map((v) => v.name).join(', ')}  (/agent <nama>)`));
      return;
    }
    const next = resolveAgent(arg, agentVariant.thinking);
    session.setAgent(next);
    agentVariant = next;
    writeConfigFile({ agent: next.name });
    console.log(green(`✓ agent: ${next.name}`));
  }

  async function switchThinking(arg: string): Promise<void> {
    if (!arg || !isThinkingLevel(arg)) {
      console.log(`  thinking: ${agentVariant.thinking}  (pilihan: off | brief | deep)` );
      return;
    }
    const next = { ...agentVariant, thinking: isThinkingLevel(arg) ? arg : agentVariant.thinking };
    session.setAgent(next);
    agentVariant = next;
    console.log(green(`✓ thinking: ${next.thinking}`));
  }

  async function handleCommand(action: CommandAction): Promise<boolean> {
    switch (action.type) {
      case 'none':
        return true;
      case 'exit':
        persistNow();
        console.log(dim('  sampai jumpa!'));
        rl.close();
        closed = true;
        opts.onExit?.();
        process.exit(0);
      case 'info':
        console.log(action.text);
        return true;
      case 'prompt':
        await runTurn(action.text);
        return true;
      case 'clear':
        session.reset();
        console.log(dim('  konteks dikosongkan.'));
        return true;
      case 'compact': {
        console.log(dim('  memadatkan konteks…'));
        const { before, after } = await session.summarize();
        console.log(dim(`  ⌁ ${before} → ${after} pesan`));
        persist();
        return true;
      }
      case 'tools': {
        const names = session.activeTools();
        console.log(bold(`\nTools aktif (${names.length}):`));
        console.log('  ' + names.join(', '));
        console.log('');
        return true;
      }
      case 'cost':
        console.log(usageLine(record.model, session.inputTokens, session.outputTokens));
        return true;
      case 'sessions': {
        const list = await store.list(10);
        if (list.length === 0) console.log(dim('  belum ada sesi tersimpan.'));
        list.forEach((s: store.SessionRecord) =>
          console.log(`  ${s.id}  ${dim(`${s.messages.length} pesan — ${s.title}`)}`),
        );
        return true;
      }
      case 'save':
        persistNow();
        console.log(green(`✓ sesi ${record.id} tersimpan.`));
        return true;
      case 'provider':
        console.log(`  provider: ${providerLine()}`);
        console.log(dim(`  config: ${configPath()}`));
        console.log(dim('  ganti provider: keluar lalu `windcode login <provider>`, atau /model untuk ganti model.'));
        return true;
      case 'models':
        await listModelsInteractive();
        return true;
      case 'init':
        await runTurn('/init placeholder');
        return true;
      case 'context':
        console.log(`  ${session.messages.length} pesan ≈ ${session.estimatedTokens()} token`);
        return true;
      case 'todos': {
        const todos = session.notebook.state().todos;
        if (todos.length === 0) {
          console.log(dim('  daftar tugas kosong.'));
        } else {
          todos.forEach((t) =>
            console.log(`  [${t.status === 'done' ? 'x' : t.status === 'in_progress' ? '~' : ' '}] ${t.content}`),
          );
        }
        return true;
      }
      case 'notes': {
        const notes = opts.memory ? await opts.memory.load() : [];
        if (notes.length === 0) console.log(dim('  belum ada memory untuk proyek ini.'));
        notes.forEach((n) => console.log(`  ${dim(n.createdAt.slice(0, 10))} ${n.text}`));
        return true;
      }
      case 'memory':
        console.log(dim(`  memory: ${opts.memory ? 'aktif' : 'nonaktif'} — /notes untuk lihat isi.`));
        return true;
      case 'skills':
        console.log(renderSkills(opts.skills));
        return true;
      case 'plugins':
        console.log(`  plugins: ${plugins ? plugins.plugins.map((p) => p.name).join(', ') : '(tidak ada)'}`);
        return true;
      case 'agent':
        await switchAgent(action.agent ?? '');
        return true;
      case 'think':
        await switchThinking(action.level ?? '');
        return true;
      case 'model':
        cfg = { ...cfg, model: action.model };
        writeConfigFile({ model: action.model });
        session.setModel(resolveModel(cfg));
        record.model = action.model;
        console.log(green(`✓ model: ${action.model}`));
        return true;
      case 'resume': {
        const id = await store.resolveId(action.id);
        const rec = id ? await store.load(id) : undefined;
        if (!rec) {
          console.log(red(`  sesi "${action.id}" tidak ditemukan.`));
          return true;
        }
        session.replace(rec.messages);
        record.id = rec.id;
        record.notebook = rec.notebook;
        session.notebook.restore(rec.notebook);
        console.log(green(`✓ sesi ${rec.id} dimuat (${rec.messages.length} pesan).`));
        return true;
      }
      case 'unknown':
        console.log(red(`  perintah tidak dikenal: /${action.name} (coba /help)`));
        return true;
      default:
        void (action satisfies CommandAction);
        return true;
    }
  }

  rl.prompt();
  rl.on('line', async (line) => {
    const input = line.trim();
    if (!input) {
      rl.prompt();
      return;
    }
    try {
      const action = parseCommand(input);
      const handled = await handleCommand(action);
      if (handled && closed) return;
      if (action.type !== 'prompt') persist();
    } catch (err) {
      console.log(red(`  error: ${err instanceof Error ? err.message : String(err)}`));
    }
    if (!closed) rl.prompt();
  });

  rl.on('close', () => {
    process.exit(0);
  });
}

function short(s: string, max: number): string {
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length > max ? one.slice(0, max) + '…' : one;
}

// Approval UI re-exports so index.ts wires the same way the TUI does.
export { askApproval, askQuestion };
void loadConfig;
