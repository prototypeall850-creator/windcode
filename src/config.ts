import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { LanguageModel } from 'ai';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { withFallback, type FallbackEvent } from './fallback.js';
import type { McpServerConfig } from './mcp.js';
import { parsePermissions, type PermissionConfig } from './permission.js';
import { isToolSetName, type ToolSetName } from './tools.js';
import { DEFAULT_MODEL, DEFAULT_PRESET_ID, presetById } from './providers.js';

/** Wire protocol a preset speaks. 'openai-compatible' covers most gateways. */
export type ProviderName = 'openai-compatible' | 'anthropic' | 'google';

export type Config = {
  /** Preset id from providers.ts, e.g. 'zen'. */
  provider: string;
  model: string;
  baseURL?: string;
  apiKey?: string;
  /** Preset id from providers.ts, kept so /provider can show what is configured. */
  presetId?: string;
  /** Retries per model call for transient failures. SDK default is 2. */
  maxRetries?: number;
  /** Default agent variant name. */
  agent?: string;
  /** Default thinking level. */
  thinking?: string;
  /** Plugin names to enable; omit for the default set. */
  plugins?: string[];
  /** Optional tool sets to offer beyond `core`; omit for all of them. */
  toolSets?: ToolSetName[];
  /** Which tool calls run, ask, or are refused. Omit for the defaults. */
  permission?: PermissionConfig;
  /** Index for `/registry`. Omit for the default one. */
  registryUrl?: string;
  mcpServers?: Record<string, McpServerConfig>;
};

const configPath = () => join(process.env['WINDCODE_HOME'] ?? homedir(), '.windcode', 'config.json');

/** Env key checked per preset when no explicit apiKey is configured. */
const envKeyFor = (provider: string): string | undefined => presetById(provider)?.envKey;

function isKnownProvider(v: unknown): v is string {
  return typeof v === 'string' && presetById(v) !== undefined;
}

/** Raw file contents, without env overlay. Used when rewriting the file. */
export function readConfigFile(): Partial<Config> {
  const path = configPath();
  if (!existsSync(path)) return {};
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    return parsed && typeof parsed === 'object' ? (parsed as Partial<Config>) : {};
  } catch {
    throw new Error(`${path} is not valid JSON`);
  }
}

/** Merges patch into the config file, preserving unrelated keys such as mcpServers. */
export function writeConfigFile(patch: Partial<Config>): string {
  const merged = { ...readConfigFile(), ...patch };
  const path = configPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(merged, null, 2)}\n`);
  return path;
}

/** File config, then env overrides. Env wins so `WINDCODE_MODEL=x windcode` works. */
export function loadConfig(): Config {
  const file = readConfigFile();

  const envProvider = process.env['WINDCODE_PROVIDER'];
  const provider = isKnownProvider(envProvider)
    ? envProvider
    : isKnownProvider(file.provider)
      ? file.provider
      : DEFAULT_PRESET_ID;

  const preset = presetById(provider);
  return {
    provider,
    model: process.env['WINDCODE_MODEL'] ?? file.model ?? DEFAULT_MODEL,
    baseURL: process.env['WINDCODE_BASE_URL'] ?? file.baseURL ?? preset?.baseURL,
    apiKey:
      process.env['WINDCODE_API_KEY'] ??
      file.apiKey ??
      (preset?.envKey ? process.env[preset.envKey] : undefined),
    ...(file.presetId ? { presetId: file.presetId } : {}),
    ...(file.maxRetries !== undefined ? { maxRetries: file.maxRetries } : {}),
    ...(file.agent ? { agent: file.agent } : {}),
    ...(file.thinking ? { thinking: file.thinking } : {}),
    ...(Array.isArray(file.plugins) ? { plugins: file.plugins } : {}),
    ...(Array.isArray(file.toolSets) ? { toolSets: file.toolSets.filter(isToolSetName) } : {}),
    ...(() => {
      const permission = parsePermissions(file.permission);
      return permission ? { permission } : {};
    })(),
    ...(typeof file.registryUrl === 'string' ? { registryUrl: file.registryUrl } : {}),
    ...(file.mcpServers ? { mcpServers: file.mcpServers } : {}),
  };
}

export function missingKeyMessage(provider: string): string {
  const preset = presetById(provider);
  const envHint = preset?.envKey ? ` atau set ${preset.envKey} / WINDCODE_API_KEY` : '';
  return (
    `Belum ada API key untuk "${provider}". Jalankan \`windcode login ${provider}\`${envHint}` +
    `${preset?.keyUrl ? `, ambil key gratis di ${preset.keyUrl}` : ''}.`
  );
}

const isOfficialOpenAI = (baseURL: string | undefined) =>
  !!baseURL && /^https:\/\/api\.openai\.com(\/|$)/.test(baseURL);

/**
 * Newer OpenAI reasoning models refuse function tools on /v1/chat/completions and
 * demand /v1/responses. Rather than guess per model id, build both and let
 * withFallback switch when the endpoint rejects the request shape.
 */
export function resolveModel(cfg: Config, onFallback?: (e: FallbackEvent) => void): LanguageModel {
  const preset = presetById(cfg.provider);
  const kind: ProviderName = cfg.baseURL?.includes('generativelanguage.googleapis.com')
    ? 'google'
    : (preset?.kind ?? 'openai-compatible');
  const baseURL = cfg.baseURL ?? preset?.baseURL;

  if (!cfg.apiKey && !preset?.keyless) throw new Error(missingKeyMessage(cfg.provider));
  const apiKey = cfg.apiKey ?? 'not-needed';

  if (kind === 'anthropic') {
    return createAnthropic({ apiKey, baseURL })(cfg.model);
  }
  if (kind === 'google') {
    return createGoogleGenerativeAI({ apiKey, baseURL })(cfg.model);
  }

  const chat = createOpenAICompatible({
    name: 'windcode',
    apiKey,
    baseURL: baseURL ?? 'https://api.openai.com/v1',
  })(cfg.model);

  if (!isOfficialOpenAI(baseURL)) return chat;

  const openai = createOpenAI({ apiKey, baseURL });
  return withFallback([chat, openai.responses(cfg.model)], onFallback);
}

export { configPath, DEFAULT_MODEL, DEFAULT_PRESET_ID };
