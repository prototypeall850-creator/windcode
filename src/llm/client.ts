import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import type { LanguageModel } from 'ai';
import { getProvider, resolveApiKey, type WindcodeConfig } from '../config.js';

/**
 * Resolve a `provider/model` pair into an AI SDK LanguageModel.
 * All three protocol kinds (OpenAI-compatible, Anthropic, Google) collapse
 * into the same LanguageModel interface, so the agent loop stays provider-agnostic.
 */
export function resolveModel(config: WindcodeConfig, providerId: string, modelId: string): LanguageModel {
  const def = getProvider(providerId);
  if (!def) {
    throw new Error(`Provider tidak dikenal: ${providerId}`);
  }
  const apiKey = resolveApiKey(config, providerId);
  if (!def.keyless && !apiKey) {
    throw new Error(
      `API key untuk "${def.name}" belum diatur. Jalankan \`windcode login ${providerId}\`` +
        (def.envKey ? ` atau set env ${def.envKey}` : '') +
        '.',
    );
  }

  switch (def.kind) {
    case 'openai-compatible': {
      const provider = createOpenAICompatible({
        name: def.id,
        baseURL: def.baseURL,
        apiKey: apiKey ?? 'not-needed',
      });
      return provider(modelId);
    }
    case 'anthropic': {
      const provider = createAnthropic({ baseURL: def.baseURL, apiKey: apiKey! });
      return provider(modelId);
    }
    case 'google': {
      const provider = createGoogleGenerativeAI({ baseURL: def.baseURL, apiKey: apiKey! });
      return provider(modelId);
    }
  }
}

/** Parse "provider/model" CLI notation; falls back to config defaults. */
export function parseModelSpec(
  config: WindcodeConfig,
  spec?: string,
): { providerId: string; modelId: string } {
  if (!spec) {
    return { providerId: config.defaultProvider, modelId: config.defaultModel };
  }
  const slash = spec.indexOf('/');
  if (slash === -1) {
    // bare model id → keep current provider
    return { providerId: config.defaultProvider, modelId: spec };
  }
  return { providerId: spec.slice(0, slash), modelId: spec.slice(slash + 1) };
}

/**
 * Query a provider's model list (OpenAI-compatible `/models` endpoint).
 * Used by `windcode models` and the onboarding wizard so the user picks from
 * models the endpoint actually serves.
 */
export async function listModels(
  config: WindcodeConfig,
  providerId: string,
): Promise<{ id: string; name?: string }[]> {
  const def = getProvider(providerId);
  if (!def) throw new Error(`Provider tidak dikenal: ${providerId}`);
  if (def.kind !== 'openai-compatible') {
    return def.models.map((m) => ({ id: m.id, name: m.name }));
  }
  const apiKey = resolveApiKey(config, providerId) ?? 'not-needed';
  const res = await fetch(`${def.baseURL}/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) {
    throw new Error(`Gagal mengambil daftar model (${res.status} ${res.statusText})`);
  }
  const body = (await res.json()) as { data?: { id: string }[] };
  return (body.data ?? []).map((m) => ({ id: m.id }));
}
