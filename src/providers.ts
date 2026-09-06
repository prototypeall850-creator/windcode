import type { ProviderName } from './config.js';

export type ProviderPreset = {
  id: string;
  label: string;
  /** Which wire protocol to speak. */
  kind: ProviderName;
  baseURL: string;
  /** Env var checked before asking for a key. */
  envKey?: string;
  /** Servers that ignore auth, e.g. a local Ollama. */
  keyless?: boolean;
  keyHint?: string;
  /** Where the user creates a key, shown by onboarding and `login`. */
  keyUrl?: string;
  blurb?: string;
  fallbackModels?: string[];
};

export const PRESETS: ProviderPreset[] = [
  {
    id: 'zen',
    label: 'OpenCode Zen (model gratis — default)',
    kind: 'openai-compatible',
    baseURL: 'https://opencode.ai/zen/v1',
    keyUrl: 'https://opencode.ai/zen',
    blurb:
      'Gateway terkurasi dari tim OpenCode. Beberapa model gratis; daftar untuk ambil API key gratis. ' +
      'Catatan: sebagian model gratis memakai data untuk training.',
    fallbackModels: [
      'big-pickle',
      'deepseek-v4-flash-free',
      'mimo-v2.5-free',
      'nemotron-3-ultra-free',
      'ling-3.0-flash-fin-free',
    ],
  },
  {
    id: 'openrouter',
    label: 'OpenRouter (banyak model, satu key)',
    kind: 'openai-compatible',
    baseURL: 'https://openrouter.ai/api/v1',
    envKey: 'OPENROUTER_API_KEY',
    keyUrl: 'https://openrouter.ai/keys',
    keyHint: 'sk-or-...',
    fallbackModels: [
      'z-ai/glm-5.2:free',
      'nvidia/nemotron-3.5-lightning:free',
      'inclusionai/ling-3.0-flash-sante:free',
      'anthropic/claude-sonnet-4.5',
    ],
  },
  {
    id: 'groq',
    label: 'Groq',
    kind: 'openai-compatible',
    baseURL: 'https://api.groq.com/openai/v1',
    envKey: 'GROQ_API_KEY',
    keyUrl: 'https://console.groq.com/keys',
    keyHint: 'gsk_...',
    fallbackModels: ['llama-3.3-70b-versatile', 'qwen/qwen3-32b'],
  },
  {
    id: 'cerebras',
    label: 'Cerebras (1M token/hari gratis)',
    kind: 'openai-compatible',
    baseURL: 'https://api.cerebras.ai/v1',
    envKey: 'CEREBRAS_API_KEY',
    keyUrl: 'https://cloud.cerebras.ai',
    fallbackModels: ['qwen-3-coder-480b'],
  },
  {
    id: 'github-models',
    label: 'GitHub Models (PAT akun GitHub)',
    kind: 'openai-compatible',
    baseURL: 'https://models.github.ai/inference',
    envKey: 'GITHUB_TOKEN',
    keyUrl: 'https://github.com/settings/tokens',
    fallbackModels: ['openai/gpt-4.1-mini'],
  },
  {
    id: 'google',
    label: 'Google Gemini (free tier lega)',
    kind: 'google',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta',
    envKey: 'GEMINI_API_KEY',
    keyUrl: 'https://aistudio.google.com/apikey',
    fallbackModels: ['gemini-2.5-flash'],
  },
  {
    id: 'anthropic',
    label: 'Anthropic (Claude)',
    kind: 'anthropic',
    baseURL: 'https://api.anthropic.com/v1',
    envKey: 'ANTHROPIC_API_KEY',
    keyUrl: 'https://console.anthropic.com/settings/keys',
    keyHint: 'sk-ant-...',
    fallbackModels: ['claude-sonnet-4-5', 'claude-opus-4-1', 'claude-haiku-4-5'],
  },
  {
    id: 'openai',
    label: 'OpenAI',
    kind: 'openai-compatible',
    baseURL: 'https://api.openai.com/v1',
    envKey: 'OPENAI_API_KEY',
    keyUrl: 'https://platform.openai.com/api-keys',
    keyHint: 'sk-...',
    fallbackModels: ['gpt-5-mini', 'gpt-5'],
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    kind: 'openai-compatible',
    baseURL: 'https://api.deepseek.com/v1',
    envKey: 'DEEPSEEK_API_KEY',
    keyUrl: 'https://platform.deepseek.com',
    fallbackModels: ['deepseek-chat'],
  },
  {
    id: 'xai',
    label: 'xAI (Grok)',
    kind: 'openai-compatible',
    baseURL: 'https://api.x.ai/v1',
    envKey: 'XAI_API_KEY',
    keyUrl: 'https://console.x.ai',
    fallbackModels: ['grok-4', 'grok-3-mini'],
  },
  {
    id: 'ollama',
    label: 'Ollama (lokal, tanpa key)',
    kind: 'openai-compatible',
    baseURL: 'http://localhost:11434/v1',
    keyless: true,
    fallbackModels: ['qwen3-coder:30b'],
  },
  {
    id: 'lmstudio',
    label: 'LM Studio (lokal, tanpa key)',
    kind: 'openai-compatible',
    baseURL: 'http://localhost:1234/v1',
    keyless: true,
  },
  {
    id: 'custom-openai',
    label: 'Endpoint OpenAI-compatible kustom',
    kind: 'openai-compatible',
    baseURL: '',
  },
  {
    id: 'custom-anthropic',
    label: 'Endpoint Anthropic-compatible kustom',
    kind: 'anthropic',
    baseURL: '',
  },
];

export const DEFAULT_PRESET_ID = 'zen';
export const DEFAULT_MODEL = 'big-pickle';

export const presetById = (id: string) => PRESETS.find((p) => p.id === id);

export type ModelListResult = { models: string[]; source: 'api' | 'fallback'; warning?: string };

type ModelsResponse = { data?: unknown };

/**
 * Both OpenAI- and Anthropic-compatible servers expose `GET /v1/models` with a
 * `data[].id` shape, only the auth header differs. A server that does not
 * implement it is not fatal: the caller can still type a model id by hand.
 */
export async function fetchModels(
  preset: Pick<ProviderPreset, 'kind' | 'baseURL' | 'fallbackModels'>,
  apiKey: string,
  timeoutMs = 15_000,
): Promise<ModelListResult> {
  const url = `${preset.baseURL.replace(/\/+$/, '')}/models`;
  const headers: Record<string, string> =
    preset.kind === 'anthropic'
      ? { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }
      : { authorization: `Bearer ${apiKey || 'not-needed'}` };

  const fallback = (warning: string): ModelListResult => ({
    models: preset.fallbackModels ?? [],
    source: 'fallback',
    warning,
  });

  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) {
      const body = (await res.text()).slice(0, 200);
      return fallback(`${url} returned ${res.status}. ${body}`.trim());
    }
    const json = (await res.json()) as ModelsResponse;
    const models = Array.isArray(json.data)
      ? json.data
          .map((m) => (m && typeof m === 'object' ? (m as { id?: unknown }).id : undefined))
          .filter((id): id is string => typeof id === 'string')
      : [];
    if (models.length === 0) return fallback(`${url} listed no models.`);
    return { models: models.sort(), source: 'api' };
  } catch (e) {
    return fallback(e instanceof Error ? e.message : String(e));
  }
}
