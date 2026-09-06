#!/usr/bin/env node
import { Command } from 'commander';
import { bold, dim, red, cyan, yellow } from './util/ansi.js';
import { loadConfig, getProvider } from './config.js';
import { parseModelSpec, listModels } from './llm/client.js';
import { runOnboarding } from './onboarding.js';
import { runAgentTurn, friendlyError } from './agent/loop.js';
import { resolveToolSets } from './agent/tools/index.js';
import type { ToolContext } from './agent/tools/types.js';
import { startRepl } from './ui/repl.js';
import { printBanner } from './ui/render.js';
import { listSessions } from './session.js';
import { resolveModel } from './llm/client.js';
import type { ModelMessage } from 'ai';

const program = new Command();

program
  .name('windcode')
  .description('Agentic coding CLI — baca kode, edit, jalankan command, tanya kalau ragu.')
  .version('0.1.0')
  .option('-p, --prompt <text>', 'mode one-shot: jalankan satu prompt lalu keluar')
  .option('-m, --model <provider/model>', 'model yang dipakai (mis. zen/big-pickle)')
  .option('--yolo', 'auto-approve aksi non-destruktif (guard tetap aktif)', false)
  .option('--resume [sessionId]', 'lanjutkan sesi tersimpan (default: sesi terakhir)')
  .option('--new', 'abaikan --resume default', false);

program
  .command('login')
  .description('Setup ulang provider/API key (wizard)')
  .argument('[provider]', 'id provider (zen, ollama, openrouter, ...)')
  .action(async (provider?: string) => {
    await runOnboarding(provider);
  });

program
  .command('models')
  .description('Daftar model dari endpoint sebuah provider')
  .argument('[provider]', 'id provider (default: provider aktif)')
  .action(async (providerId?: string) => {
    const config = loadConfig();
    const pid = providerId ?? config.defaultProvider;
    try {
      const models = await listModels(config, pid);
      const def = getProvider(pid);
      console.log(bold(`\n${def?.name ?? pid} (${models.length} model):`));
      const recommended = new Set(def?.models.map((m) => m.id) ?? []);
      models.slice(0, 50).forEach((m) => {
        const mark = recommended.has(m.id) ? cyan('★') : ' ';
        console.log(`  ${mark} ${m.id}`);
      });
      if (models.length > 50) console.log(dim(`  … dan ${models.length - 50} lagi`));
      console.log(dim('\n  pakai: windcode -m <provider>/<model-id>'));
    } catch (err) {
      console.log(red(friendlyError(err).message));
      process.exitCode = 1;
    }
  });

program
  .command('sessions')
  .description('Daftar sesi tersimpan')
  .action(() => {
    const list = listSessions().slice(0, 20);
    if (list.length === 0) {
      console.log(dim('Belum ada sesi tersimpan.'));
      return;
    }
    list.forEach((s) => console.log(`  ${s.id}  ${dim(`${s.messages} pesan — ${s.preview}`)}`));
  });

program
  .command('config')
  .description('Lokasi & isi config')
  .action(() => {
    console.log(`config: ~/.windcode/config.json`);
    console.log(JSON.stringify(loadConfig(), null, 2));
  });

program.action(async () => {
  const options = program.opts<{
    prompt?: string;
    model?: string;
    yolo?: boolean;
    resume?: string | boolean;
    new?: boolean;
  }>();

  const config = loadConfig();
  const spec = parseModelSpec(config, options.model);
  let { providerId, modelId } = spec;

  // first-run onboarding: no usable key anywhere
  const def = getProvider(providerId);
  const hasKey =
    def?.keyless || config.apiKeys[providerId] || (def?.envKey && process.env[def.envKey]);
  if (!hasKey) {
    console.log(yellow('Belum ada API key yang terdeteksi — kita setup dulu.'));
    const updated = await runOnboarding();
    providerId = updated.defaultProvider;
    modelId = updated.defaultModel;
  }

  if (options.prompt) {
    await runOneShot({ config, providerId, modelId, prompt: options.prompt, yolo: options.yolo ?? false });
    return;
  }

  // resume default: pick the latest session automatically unless --new
  let resumeId: string | undefined;
  if (options.resume !== undefined && !options.new) {
    resumeId =
      typeof options.resume === 'string'
        ? options.resume
        : listSessions()[0]?.id;
  }

  await startRepl({ config, providerId, modelId, yolo: options.yolo ?? false, resumeId });
});

async function runOneShot(args: {
  config: ReturnType<typeof loadConfig>;
  providerId: string;
  modelId: string;
  prompt: string;
  yolo: boolean;
}): Promise<void> {
  const { config, providerId, modelId, prompt, yolo } = args;
  const def = getProvider(providerId);
  const activeSets = ['core', ...resolveToolSets(config.toolSets)];
  printBanner(def?.name ?? providerId, modelId, process.cwd(), activeSets, yolo);

  const ctx: ToolContext = {
    cwd: process.cwd(),
    headless: true,
    yolo,
    allowlist: new Set<string>(),
    todos: [],
    ui: {
      onToolStart: () => {},
      onToolEnd: () => {},
      onCommandOutput: (chunk) => process.stdout.write(dim(chunk)),
      requestApproval: async () => {
        // headless: permissions already prints the denial guidance
        return 'n';
      },
      askUser: async () => '(tidak ada user untuk ditanya di mode one-shot)',
    },
  };

  const messages: ModelMessage[] = [{ role: 'user', content: prompt }];
  try {
    resolveModel(config, providerId, modelId); // fail fast on missing key
    await runAgentTurn({ config, providerId, modelId, messages, ctx });
    console.log('');
  } catch (err) {
    console.log(red(`\nerror: ${friendlyError(err).message}`));
    process.exitCode = 1;
  }
}

program.parseAsync(process.argv).catch((err) => {
  console.error(red(friendlyError(err).message));
  process.exit(1);
});
