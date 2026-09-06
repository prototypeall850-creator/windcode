#!/usr/bin/env node
import { createRequire } from 'node:module';
import { Command } from 'commander';
import { bold, dim, red, yellow, green } from './util/ansi.js';
import {
  loadConfig,
  writeConfigFile,
  resolveModel,
  configPath,
  missingKeyMessage,
  readConfigFile,
} from './config.js';
import { PRESETS, presetById, fetchModels, DEFAULT_MODEL, DEFAULT_PRESET_ID } from './providers.js';
import { runOnboarding } from './onboarding.js';
import { Session } from './session.js';
import * as store from './store.js';
import { runHeadless } from './headless.js';
import { loadInstructions, INIT_PROMPT } from './instructions.js';
import { loadSkills } from './skills.js';
import { Memory } from './memory.js';
import { BUILTIN_PLUGINS, DEFAULT_ENABLED } from './plugins-builtin.js';
import { loadInstalledPlugins } from './registry.js';
import { createHost } from './plugins.js';
import { createCommitMessageTool } from './commit.js';
import { createTaskTool, type SubagentApproval } from './subagent.js';
import { connectMcp } from './mcp.js';
import { resolveAgent, isThinkingLevel } from './agents.js';
import { costOf } from './pricing.js';
import { startRepl } from './ui/repl.js';
import { readStdinAll } from './fsx.js';
import { askApproval, askQuestion } from './ui/render.js';
import { versionLine } from './version.js';
import type { ModelMessage } from 'ai';

const require = createRequire(import.meta.url);
const VERSION: string = require('../package.json').version;

const program = new Command();

program
  .name('windcode')
  .description('Agentic coding CLI — baca kode, edit, jalankan command, tanya kalau ragu.')
  .version(versionLine().replace('windcode ', ''), '-V, --version')
  .helpOption('-h, --help', 'tampilkan bantuan');

program
  .option('-p, --prompt [text]', 'mode headless: satu prompt lalu keluar (prompt juga dibaca dari stdin)')
  .option('--json', 'dengan -p: keluarkan satu JSON event per baris', false)
  .option('-m, --model <provider/model>', 'model yang dipakai (mis. zen/big-pickle)')
  .option('--provider <id>', 'preset provider (zen, openrouter, ollama, …)')
  .option('--yolo', 'auto-approve semua approval (guard plugin tetap aktif)', false)
  .option('--resume [sessionId]', 'lanjutkan sesi tersimpan (default: terakhir di cwd ini)')
  .option('--new', 'mulai sesi baru, abaikan resume', false)
  .option('--agent <nama>', 'varian agent (ask | explore | review | code)')
  .option('--think <level>', 'tingkat reasoning (off | brief | deep)')
  .option('--no-memory', 'jangan muat memory proyek')
  .option('--no-skills', 'jangan muat skills')
  .option('--no-instructions', 'jangan muat AGENTS.md-style instructions')
  .option('--no-mcp', 'jangan konek MCP servers')
  .option('--no-subagent', 'nonaktifkan tool task (sub-agent)')
  .action(async (options) => {
    await main(options);
  });

program
  .command('login')
  .description('Setup provider/API key (wizard)')
  .argument('[provider]', 'id provider (zen, ollama, openrouter, …)')
  .action(async (provider?: string) => {
    await runOnboarding(provider);
  });

program
  .command('models')
  .description('Daftar model dari endpoint provider aktif')
  .argument('[provider]', 'id provider (default: provider aktif)')
  .action(async (providerId?: string) => {
    const cfg = applyModelFlag(loadConfig(), undefined, providerId);
    const preset = presetById(cfg.provider);
    if (!preset) {
      console.log(red(`Provider tidak dikenal: ${cfg.provider}`));
      process.exitCode = 1;
      return;
    }
    console.log(bold(`\n${preset.label} (${cfg.baseURL ?? preset.baseURL})`));
    const result = await fetchModels(preset, cfg.apiKey ?? '');
    if (result.warning) console.log(dim(`⚠ ${result.warning}`));
    result.models.forEach((m) => console.log(`  ${m}`));
    console.log(dim(`\n  pakai: windcode -m ${cfg.provider}/<model>`));
  });

program
  .command('sessions')
  .description('Daftar sesi tersimpan')
  .action(async () => {
    const list = await store.list(20);
    if (list.length === 0) {
      console.log(dim('Belum ada sesi tersimpan.'));
      return;
    }
    for (const s of list) {
      const cost = s.costUsd !== undefined ? ` $${s.costUsd.toFixed(4)}` : '';
      console.log(`  ${s.id}  ${dim(`${s.messages.length} pesan — ${s.title}${cost}`)}`);
    }
  });

program
  .command('doctor')
  .description('Diagnosis: config, key, endpoint, validitas model aktif')
  .action(async () => {
    const cfg = loadConfig();
    const preset = presetById(cfg.provider);
    console.log(bold('\nwindcode doctor'));
    console.log(`  provider : ${cfg.provider}${preset ? ` (${preset.label})` : red(' (tidak dikenal!)')}`);
    console.log(`  model    : ${cfg.model}`);
    console.log(`  toolSets : ${cfg.toolSets ? cfg.toolSets.join(', ') : 'semua'}`);
    console.log(`  config   : ${configPath()}`);
    if (preset?.keyless) {
      console.log(green('  key      : tidak dibutuhkan (provider lokal)'));
    } else if (cfg.apiKey) {
      console.log(green(`  key      : ada (${cfg.apiKey.slice(0, 6)}…)`));
    } else {
      console.log(red('  key      : BELUM ADA — ' + missingKeyMessage(cfg.provider)));
    }
    try {
      const result = await fetchModels(preset!, cfg.apiKey ?? '');
      if (result.source === 'api') {
        console.log(green(`  endpoint : OK (${result.models.length} model)`));
        if (!result.models.includes(cfg.model)) {
          console.log(red(`  model    : "${cfg.model}" TIDAK ADA di endpoint — ini penyebab error chat!`));
          console.log(dim(`             pilih dari: windcode models ${cfg.provider}`));
          process.exitCode = 1;
        } else {
          console.log(green(`  model    : "${cfg.model}" terdaftar ✓`));
        }
      } else {
        console.log(yellow(`  endpoint : ${result.warning ?? 'tidak bisa dicek'}`));
      }
    } catch (err) {
      console.log(yellow(`  endpoint : gagal dicek (${err instanceof Error ? err.message : String(err)})`));
    }
    console.log('');
  });

program
  .command('config')
  .description('Lokasi & isi config')
  .action(() => {
    console.log(`config: ${configPath()}`);
    console.log(JSON.stringify(readConfigFile(), null, 2));
  });

await program.parseAsync(process.argv).catch((err) => {
  console.error(red(err instanceof Error ? err.message : String(err)));
  process.exit(1);
});

// ---------------------------------------------------------------------------

function applyModelFlag(
  cfg: ReturnType<typeof loadConfig>,
  modelFlag?: string,
  providerFlag?: string,
): ReturnType<typeof loadConfig> {
  let next = { ...cfg };
  if (providerFlag) {
    if (!presetById(providerFlag)) throw new Error(`Provider tidak dikenal: ${providerFlag}`);
    next = { ...next, provider: providerFlag, presetId: providerFlag, baseURL: presetById(providerFlag)?.baseURL };
  }
  if (modelFlag) {
    const slash = modelFlag.indexOf('/');
    if (slash > 0 && presetById(modelFlag.slice(0, slash))) {
      const provider = modelFlag.slice(0, slash);
      next = {
        ...next,
        provider,
        presetId: provider,
        model: modelFlag.slice(slash + 1),
        baseURL: presetById(provider)?.baseURL,
      };
    } else {
      next = { ...next, model: modelFlag };
    }
  }
  return next;
}

async function main(options: {
  prompt?: string | boolean;
  json?: boolean;
  model?: string;
  provider?: string;
  yolo?: boolean;
  resume?: string | boolean;
  new?: boolean;
  agent?: string;
  think?: string;
  memory?: boolean;
  skills?: boolean;
  instructions?: boolean;
  mcp?: boolean;
  subagent?: boolean;
}): Promise<void> {
  let cfg = loadConfig();
  cfg = applyModelFlag(cfg, options.model, options.provider);

  const preset = presetById(cfg.provider);
  if (!preset?.keyless && !cfg.apiKey) {
    console.log(yellow('Belum ada API key yang terdeteksi — kita setup dulu.'));
    await runOnboarding();
    cfg = loadConfig();
    cfg = applyModelFlag(cfg, options.model, options.provider);
  }

  // headless one-shot
  if (options.prompt !== undefined) {
    let promptText =
      typeof options.prompt === 'string' && options.prompt.length > 0 ? options.prompt : '';
    if (!promptText) promptText = (await readStdinAll()).trim();
    if (!promptText) {
      console.log(red('prompt kosong. Pakai: windcode -p "tugasnya"'));
      process.exitCode = 1;
      return;
    }
    const headless = await buildSession({ cfg, options, headless: true });
    if (!headless) return;
    const code = await runHeadless({ session: headless.session, prompt: promptText, format: options.json ? 'json' : 'text' });
    process.exitCode = code;
    return;
  }

  // resume
  let restored: store.SessionRecord | undefined;
  if (options.resume !== undefined && !options.new) {
    const resumeArg = typeof options.resume === 'string' ? options.resume : '';
    if (resumeArg) {
      const id = await store.resolveId(resumeArg);
      restored = id ? await store.load(id) : undefined;
      if (!restored) console.log(red(`Sesi "${resumeArg}" tidak ditemukan — mulai sesi baru.`));
    } else {
      restored = await store.latest(process.cwd());
    }
  }

  const built = await buildSession({ cfg, options, headless: false, restored });
  if (!built) return;
  const { session, record, agentVariant, skills, memory, plugins } = built;

  await startRepl({ session, config: cfg, record, skills, memory, plugins, agentVariant });
}

async function buildSession(args: {
  cfg: ReturnType<typeof loadConfig>;
  options: {
    yolo?: boolean;
    agent?: string;
    think?: string;
    memory?: boolean;
    skills?: boolean;
    instructions?: boolean;
    mcp?: boolean;
    subagent?: boolean;
  };
  headless: boolean;
  restored?: store.SessionRecord;
}): Promise<
  | {
      session: Session;
      record: store.SessionRecord;
      agentVariant: ReturnType<typeof resolveAgent>;
      skills: Awaited<ReturnType<typeof loadSkills>>;
      memory: Memory | undefined;
      plugins: ReturnType<typeof createHost>;
    }
  | undefined
> {
  const { cfg, options, headless, restored } = args;
  const model = resolveModel(cfg);

  const [instructions, skills, mcp] = await Promise.all([
    options.instructions === false ? Promise.resolve([]) : loadInstructions(),
    options.skills === false ? Promise.resolve([]) : loadSkills(),
    options.mcp === false || !cfg.mcpServers
      ? Promise.resolve(undefined)
      : connectMcp(cfg.mcpServers),
  ]);

  const agentVariant = resolveAgent(options.agent ?? cfg.agent, options.think ?? cfg.thinking);

  const installedPlugins = await loadInstalledPlugins();
  const enabledPlugins = (cfg.plugins ?? DEFAULT_ENABLED).filter(
    (name) => !BUILTIN_PLUGINS.some((p) => p.name === name),
  );
  const plugins = createHost(
    [...BUILTIN_PLUGINS.filter((p) => enabledPlugins.includes(p.name)), ...installedPlugins.plugins],
    installedPlugins.errors,
  );

  const memory = options.memory === false ? undefined : new Memory(process.cwd(), model);

  const record: store.SessionRecord = restored ?? {
    id: store.newId(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    cwd: process.cwd(),
    provider: cfg.provider,
    model: cfg.model,
    title: 'untitled',
    inputTokens: 0,
    outputTokens: 0,
    messages: [],
  };

  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  const persist = (messages: ModelMessage[]) => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      record.messages = messages;
      record.title = store.titleOf(messages);
      record.inputTokens = session.inputTokens;
      record.outputTokens = session.outputTokens;
      record.notebook = session.notebook.state();
      const cost = costOf(record.model, session.inputTokens, session.outputTokens);
      if (cost !== undefined) record.costUsd = cost;
      void store.save(record);
    }, 400);
  };

  // Late-bound subagent approval gate (needs the Session that owns the rules).
  let approveSubagent: SubagentApproval | undefined;
  const subagentGate: SubagentApproval = (req) => {
    if (!approveSubagent) throw new Error('the subagent approval channel is not wired yet');
    return approveSubagent(req);
  };

  let session: Session;
  session = new Session({
    model,
    askApproval: headless
      ? async () => 'deny'
      : async (req) =>
          await askApproval({
            title: `${req.toolName} ${shortInput(req.input)}`,
            detail: req.matchedPattern ? `aturan: ${req.matchedPattern}` : undefined,
            suggestion: req.suggestedPattern,
          }),
    yolo: options.yolo ?? false,
    instructions,
    skills,
    plugins,
    agent: agentVariant,
    ...(cfg.toolSets ? { toolSets: cfg.toolSets } : {}),
    ...(cfg.permission ? { permissions: cfg.permission } : {}),
    ...(headless
      ? {}
      : {
          ask: async (req) => {
            const answer = await askQuestion(req.question, req.options?.map((o) => o.label));
            return answer ? [answer] : undefined;
          },
        }),
    ...(memory ? { memory } : {}),
    ...(record.notebook ? { notebook: record.notebook } : {}),
    ...(cfg.maxRetries !== undefined ? { maxRetries: cfg.maxRetries } : {}),
    extraTools: {
      ...(mcp?.tools ?? {}),
      git_commit_message: createCommitMessageTool({ model }),
      ...(options.subagent === false
        ? {}
        : {
            task: createTaskTool({
              model,
              ...(headless ? {} : { approve: subagentGate }),
            }),
          }),
    },
    autoApprove: ['task', 'git_commit_message'],
    messages: [...record.messages],
    onChange: (messages) => persist(messages),
  });
  approveSubagent = (req: Parameters<SubagentApproval>[0]) =>
    session.approveForSubagent()({
      toolName: req.toolName,
      input: req.input,
    });

  return { session, record, agentVariant, skills, memory, plugins };
}

function shortInput(input: unknown): string {
  const s = typeof input === 'string' ? input : JSON.stringify(input) ?? '';
  return s.replace(/\s+/g, ' ').slice(0, 120);
}

// keep imports referenced for future command surface growth
void INIT_PROMPT;
void isThinkingLevel;
void DEFAULT_MODEL;
void DEFAULT_PRESET_ID;
void PRESETS;
void writeConfigFile;
