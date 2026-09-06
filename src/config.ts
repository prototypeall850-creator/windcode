import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { CONFIG_FILE, ensureWindcodeDir } from './util/paths.js';

// ---------------------------------------------------------------------------
// Provider registry — every provider is described declaratively so adding a
// new one is a single entry, not new code.
// ---------------------------------------------------------------------------

export type ProviderKind = 'openai-compatible' | 'anthropic' | 'google';

export interface ProviderDef {
  id: string;
  name: string;
  kind: ProviderKind;
  baseURL: string;
  /** Env var checked before the config file for the API key. */
  envKey?: string;
  /** Where the user gets a key (shown in onboarding). */
  keyUrl?: string;
  /** True when the provider works without any API key. */
  keyless?: boolean;
  /** Suggested model ids, first one is the default. */
  models: { id: string; name: string; free?: boolean; note?: string }[];
  blurb?: string;
}

export const PROVIDERS: ProviderDef[] = [
  {
    id: 'zen',
    name: 'OpenCode Zen',
    kind: 'openai-compatible',
    baseURL: 'https://opencode.ai/zen/v1',
    keyUrl: 'https://opencode.ai/zen',
    models: [
      { id: 'big-pickle', name: 'Big Pickle', free: true, note: 'Model stealth, gratis (terbatas)' },
      { id: 'qwen3.6-plus-free', name: 'Qwen3.6 Plus Free', free: true, note: 'Coding kompleks, gratis' },
      { id: 'mimo-v2-pro-free', name: 'MiMo V2 Pro Free', free: true, note: 'Coding agent, gratis' },
      { id: 'minimax-m2.5-free', name: 'MiniMax M2.5 Free', free: true },
    ],
    blurb:
      'Gateway model terkurasi dari tim OpenCode. Beberapa modelnya gratis — ' +
      'cukup daftar di opencode.ai/zen untuk ambil API key gratis. Catatan: ' +
      'sebagian model gratis memakai data untuk training.',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    kind: 'openai-compatible',
    baseURL: 'https://openrouter.ai/api/v1',
    envKey: 'OPENROUTER_API_KEY',
    keyUrl: 'https://openrouter.ai/keys',
    models: [
      { id: 'qwen/qwen3-coder:free', name: 'Qwen3 Coder (free)', free: true },
      { id: 'deepseek/deepseek-chat-v3.1:free', name: 'DeepSeek V3.1 (free)', free: true },
      { id: 'anthropic/claude-sonnet-4.5', name: 'Claude Sonnet 4.5' },
    ],
    blurb: 'Satu key untuk ratusan model. Model `:free` ada kuota 20 req/menit.',
  },
  {
    id: 'groq',
    name: 'Groq',
    kind: 'openai-compatible',
    baseURL: 'https://api.groq.com/openai/v1',
    envKey: 'GROQ_API_KEY',
    keyUrl: 'https://console.groq.com/keys',
    models: [
      { id: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B' },
      { id: 'qwen/qwen3-32b', name: 'Qwen3 32B' },
    ],
    blurb: 'Inferens super cepat, free tier longgar untuk panggilan kecil.',
  },
  {
    id: 'cerebras',
    name: 'Cerebras',
    kind: 'openai-compatible',
    baseURL: 'https://api.cerebras.ai/v1',
    envKey: 'CEREBRAS_API_KEY',
    keyUrl: 'https://cloud.cerebras.ai',
    models: [{ id: 'qwen-3-coder-480b', name: 'Qwen3 Coder 480B' }],
    blurb: '1M token/hari gratis, inferens tercepat di kelasnya.',
  },
  {
    id: 'github-models',
    name: 'GitHub Models',
    kind: 'openai-compatible',
    baseURL: 'https://models.github.ai/inference',
    envKey: 'GITHUB_TOKEN',
    keyUrl: 'https://github.com/settings/tokens',
    models: [{ id: 'openai/gpt-4.1-mini', name: 'GPT-4.1 mini' }],
    blurb: 'Gratis dengan akun GitHub (PAT), rate limit ketat tapi cukup buat prototyping.',
  },
  {
    id: 'google',
    name: 'Google Gemini',
    kind: 'google',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta',
    envKey: 'GEMINI_API_KEY',
    keyUrl: 'https://aistudio.google.com/apikey',
    models: [
      { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', note: 'Konteks 1M token' },
    ],
    blurb: 'Free tier ~1.500 req/hari, konteks 1M token — lega untuk kodebase besar.',
  },
  {
    id: 'anthropic',
    name: 'Anthropic (Claude)',
    kind: 'anthropic',
    baseURL: 'https://api.anthropic.com',
    envKey: 'ANTHROPIC_API_KEY',
    keyUrl: 'https://console.anthropic.com/settings/keys',
    models: [{ id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5' }],
    blurb: 'Kualitas coding paling konsisten, berbayar.',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    kind: 'openai-compatible',
    baseURL: 'https://api.openai.com/v1',
    envKey: 'OPENAI_API_KEY',
    keyUrl: 'https://platform.openai.com/api-keys',
    models: [{ id: 'gpt-5-mini', name: 'GPT-5 mini' }],
    blurb: 'Berbayar, ekosistem matang.',
  },
  {
    id: 'ollama',
    name: 'Ollama (lokal)',
    kind: 'openai-compatible',
    baseURL: 'http://localhost:11434/v1',
    keyless: true,
    models: [{ id: 'qwen3-coder:30b', name: 'Qwen3 Coder 30B', note: '`ollama pull qwen3-coder:30b` dulu' }],
    blurb: '100% lokal dan gratis, tanpa API key. Kualitas tergantung model yang dipull.',
  },
];

export function getProvider(id: string): ProviderDef | undefined {
  return PROVIDERS.find((p) => p.id === id);
}

// ---------------------------------------------------------------------------
// Config file (~/.windcode/config.json)
// ---------------------------------------------------------------------------

export interface WindcodeConfig {
  defaultProvider: string;
  defaultModel: string;
  /** Keys stored here only if the env var isn't set. */
  apiKeys: Record<string, string>;
  /** Extra tool sets enabled beyond core. Subset of: edit-plus, git, net, agent. */
  toolSets: string[];
}

const DEFAULT_TOOLSETS = ['edit-plus', 'git', 'agent'];

export function defaultConfig(): WindcodeConfig {
  return {
    defaultProvider: 'zen',
    defaultModel: 'big-pickle',
    apiKeys: {},
    toolSets: DEFAULT_TOOLSETS,
  };
}

export function loadConfig(): WindcodeConfig {
  ensureWindcodeDir();
  if (!existsSync(CONFIG_FILE)) return defaultConfig();
  try {
    const raw = JSON.parse(readFileSync(CONFIG_FILE, 'utf8'));
    return { ...defaultConfig(), ...raw };
  } catch {
    return defaultConfig();
  }
}

export function saveConfig(config: WindcodeConfig): void {
  ensureWindcodeDir();
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + '\n');
}

/** Resolve the API key for a provider: env var first, then config file. */
export function resolveApiKey(config: WindcodeConfig, providerId: string): string | undefined {
  const def = getProvider(providerId);
  if (!def) return undefined;
  if (def.keyless) return 'not-needed';
  if (def.envKey && process.env[def.envKey]) return process.env[def.envKey];
  return config.apiKeys[providerId] || undefined;
}
