import * as readline from 'node:readline';
import { dim, bold, cyan, yellow } from './util/ansi.js';
import { PROVIDERS, getProvider, loadConfig, saveConfig, resolveApiKey, type WindcodeConfig } from './config.js';
import { listModels } from './llm/client.js';

// ---------------------------------------------------------------------------
// First-run wizard: pick a provider (Zen recommended — free), paste the key,
// pick a model. Reused by `windcode login [provider]`.
// ---------------------------------------------------------------------------

function question(rl: readline.Interface, q: string): Promise<string> {
  return new Promise((resolve) => rl.question(q, (a) => resolve(a.trim())));
}

async function pickFromList(rl: readline.Interface, items: string[]): Promise<number> {
  for (let i = 0; i < items.length; i++) {
    console.log(`  ${i + 1}. ${items[i]}`);
  }
  while (true) {
    const raw = await question(rl, dim('pilih nomor: '));
    const n = parseInt(raw, 10);
    if (Number.isInteger(n) && n >= 1 && n <= items.length) return n - 1;
    console.log(yellow('  nomor tidak valid, coba lagi.'));
  }
}

async function configureProvider(rl: readline.Interface, providerId: string, config: WindcodeConfig): Promise<void> {
  const def = getProvider(providerId);
  if (!def) throw new Error(`provider tidak dikenal: ${providerId}`);

  console.log(dim(`\n${def.name} — ${def.blurb ?? ''}\n`));

  // API key
  if (!def.keyless) {
    const envHint = def.envKey ? ` (atau set env ${def.envKey})` : '';
    if (def.keyUrl) {
      console.log(dim(`Ambil API key di: ${def.keyUrl}${envHint}`));
    }
    if (resolveApiKey(config, providerId)) {
      console.log(greenSafe(`  ✓ key sudah terdeteksi, lewati.`));
    } else {
      const key = await question(rl, dim('Paste API key (kosongkan untuk lewati): '));
      if (key) {
        config.apiKeys[providerId] = key;
      } else if (!def.envKey) {
        console.log(yellow('  Tanpa key, provider ini belum bisa dipakai.'));
      }
    }
  }

  // model
  let modelId = def.models[0]?.id ?? '';
  try {
    console.log(dim('Mengambil daftar model dari endpoint…'));
    const models = await listModels(config, providerId);
    if (models.length > 0) {
      console.log(dim(`Endpoint melaporkan ${models.length} model. Menampilkan yang direkomendasikan + 20 pertama:`));
      const recommended = new Set(def.models.map((m) => m.id));
      const shown = [...def.models.map((m) => `${m.name ?? m.id}${m.free ? ' [gratis]' : ''}`),
        ...models.filter((m) => !recommended.has(m.id)).slice(0, 20).map((m) => m.id)];
      const idx = await pickFromList(rl, shown);
      if (idx < def.models.length) {
        modelId = def.models[idx].id;
      } else {
        modelId = await question(rl, dim('ketik model id: ')) || modelId;
      }
    }
  } catch {
    // endpoint listing failed (offline/bad key) — fall back to curated list
    if (def.models.length > 1) {
      const idx = await pickFromList(rl, def.models.map((m) => `${m.name ?? m.id}${m.free ? ' [gratis]' : ''}${m.note ? ` — ${m.note}` : ''}`));
      modelId = def.models[idx].id;
    }
  }

  config.defaultProvider = providerId;
  config.defaultModel = modelId;
  saveConfig(config);
  console.log(`\n${cyan('✓')} tersimpan: ${bold(def.name)} / ${bold(modelId)}`);
  console.log(dim(`  config: ~/.windcode/config.json`));
}

function greenSafe(t: string): string {
  return `\x1b[32m${t}\x1b[0m`;
}

export async function runOnboarding(onlyProvider?: string): Promise<WindcodeConfig> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    console.log(bold('\nWindcode — setup awal'));
    const config = loadConfig();

    if (onlyProvider) {
      await configureProvider(rl, onlyProvider, config);
      return config;
    }

    const hasZenKey = Boolean(config.apiKeys['zen']);
    const options = [
      `OpenCode Zen — gratis, recommended${hasZenKey ? ' (key sudah ada)' : ''}  → daftar di opencode.ai/zen`,
      'Ollama — 100% lokal, tanpa API key (butuh `ollama serve` jalan)',
      'Provider lain — OpenRouter / Groq / Gemini / Anthropic / dll (BYOK)',
    ];
    console.log(dim('\nMau pakai provider apa?'));
    const idx = await pickFromList(rl, options);
    const providerId = idx === 0 ? 'zen' : idx === 1 ? 'ollama' : null;

    if (providerId) {
      await configureProvider(rl, providerId, config);
    } else {
      const others = PROVIDERS.filter((p) => !['zen', 'ollama'].includes(p.id));
      const pIdx = await pickFromList(rl, others.map((p) => `${p.name} — ${p.blurb ?? ''}`));
      await configureProvider(rl, others[pIdx].id, config);
    }
    return config;
  } finally {
    rl.close();
  }
}
