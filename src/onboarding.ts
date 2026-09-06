import * as readline from 'node:readline';
import { bold, dim, cyan, yellow } from './util/ansi.js';
import { readConfigFile, writeConfigFile, configPath, type Config } from './config.js';
import { PRESETS, presetById, fetchModels, DEFAULT_PRESET_ID, DEFAULT_MODEL } from './providers.js';

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

export async function runOnboarding(onlyProvider?: string): Promise<Config> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    console.log(bold('\nWindcode — setup awal'));
    const file = readConfigFile();

    // 1. provider
    let providerId = onlyProvider;
    if (!providerId) {
      const zenHasKeys = Boolean(process.env['OPENCODE_API_KEY'] ?? file.apiKey);
      const options = [
        `OpenCode Zen — gratis, recommended${zenHasKeys ? ' (key sudah ada)' : ''}  → daftar di opencode.ai/zen`,
        'Ollama — 100% lokal, tanpa API key (butuh `ollama serve` jalan)',
        'Provider lain — OpenRouter / Groq / Gemini / Anthropic / dll (BYOK)',
      ];
      console.log(dim('\nMau pakai provider apa?'));
      const idx = await pickFromList(rl, options);
      providerId = idx === 0 ? 'zen' : idx === 1 ? 'ollama' : undefined;
      if (!providerId) {
        const others = PRESETS.filter((p) => !['zen', 'ollama', 'lmstudio', 'custom-openai', 'custom-anthropic'].includes(p.id));
        const pIdx = await pickFromList(rl, others.map((p) => `${p.label}${p.blurb ? ` — ${p.blurb}` : ''}`));
        providerId = others[pIdx]!.id;
      }
    }
    const preset = presetById(providerId);
    if (!preset) throw new Error(`provider tidak dikenal: ${providerId}`);

    console.log(dim(`\n${preset.label}${preset.blurb ? ` — ${preset.blurb}` : ''}\n`));

    // 2. key
    let apiKey: string | undefined =
      process.env['WINDCODE_API_KEY'] ?? (preset.envKey ? process.env[preset.envKey] : undefined);
    if (!preset.keyless) {
      if (preset.keyUrl) console.log(dim(`Ambil API key di: ${preset.keyUrl}`));
      if (apiKey) {
        console.log(cyan(`  ✓ key terdeteksi dari env (${preset.envKey ?? 'WINDCODE_API_KEY'})`));
      } else {
        const key = await question(rl, dim('Paste API key (kosongkan untuk lewati): '));
        apiKey = key || undefined;
        if (!apiKey) console.log(yellow('  Tanpa key, provider ini belum bisa dipakai — bisa diisi ulang via `windcode login`.'));
      }
    }

    // 3. model — prefer what the endpoint actually lists
    let model = preset.fallbackModels?.[0] ?? DEFAULT_MODEL;
    const result = await fetchModels(preset, apiKey ?? '');
    if (result.warning) console.log(dim(`  (${result.warning})`));
    const models = result.models;
    if (models.length > 0) {
      const recommended = preset.fallbackModels ?? [];
      const shown = [
        ...recommended.filter((id) => models.includes(id)),
        ...models.filter((id) => !recommended.includes(id)).slice(0, 25),
      ];
      console.log(dim(`Endpoint melaporkan ${models.length} model. Teratas = rekomendasi.`));
      const idx = await pickFromList(rl, shown);
      model = shown[idx] ?? model;
    } else if (preset.fallbackModels && preset.fallbackModels.length > 1) {
      const idx = await pickFromList(rl, preset.fallbackModels);
      model = preset.fallbackModels[idx]!;
    }

    const patch: Partial<Config> = {
      provider: providerId,
      presetId: providerId,
      model,
      baseURL: preset.baseURL,
      ...(apiKey ? { apiKey } : {}),
    };
    writeConfigFile(patch);
    console.log(`\n${cyan('✓')} tersimpan: ${bold(preset.label)} / ${bold(model)}`);
    console.log(dim(`  config: ${configPath()}`));

    return { provider: providerId, presetId: providerId, model, baseURL: preset.baseURL, ...(apiKey ? { apiKey } : {}) };
  } finally {
    rl.close();
  }
}

void DEFAULT_PRESET_ID;
