import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { APICallError, type LanguageModel } from 'ai';
import { getProvider, resolveApiKey, type WindcodeConfig } from '../config.js';

/**
 * Status codes that mean "this endpoint cannot serve this request shape"
 * (as opposed to auth/rate-limit/5xx). Only these justify switching wire
 * format. Same heuristic as shiro-neko's fallback.
 */
const SHAPE_MISMATCH = new Set([400, 404, 405, 415, 422, 501]);

function shouldFallback(error: unknown): boolean {
  if (!APICallError.isInstance(error)) return false;
  if (error.isRetryable) return false;
  return error.statusCode !== undefined && SHAPE_MISMATCH.has(error.statusCode);
}

/**
 * Present [chat-completions, responses] as one model: newer OpenAI reasoning
 * models refuse function tools on /chat/completions and demand /responses.
 * Sticky — once the chat wire is rejected, later steps start on responses.
 */
function withResponsesFallback(chat: any, responses: any): LanguageModel {
  let start = 0;
  const models = [chat, responses];
  const attempt = async <T>(op: (m: LanguageModel) => PromiseLike<T>): Promise<T> => {
    let lastError: unknown;
    for (let i = start; i < models.length; i++) {
      try {
        return await op(models[i]!);
      } catch (error) {
        lastError = error;
        if (!shouldFallback(error) || i + 1 >= models.length) throw error;
      }
    }
    throw lastError;
  };
  return {
    specificationVersion: (chat as any).specificationVersion,
    supportedUrls: (chat as any).supportedUrls,
    provider: (chat as any).provider,
    modelId: (chat as any).modelId,
    doGenerate: (opts: any) => attempt((m: any) => m.doGenerate(opts)),
    doStream: (opts: any) => attempt((m: any) => m.doStream(opts)),
  } as unknown as LanguageModel;
}

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
      const chat = createOpenAICompatible({
        name: def.id,
        baseURL: def.baseURL,
        apiKey: apiKey ?? 'not-needed',
      })(modelId);
      // Official OpenAI hosts reasoning models that only accept function
      // tools on /responses — build both wires and switch on rejection.
      if (/^https:\/\/api\.openai\.com(\/|$)/.test(def.baseURL)) {
        const openai = createOpenAI({ apiKey: apiKey!, baseURL: def.baseURL });
        return withResponsesFallback(chat, openai.responses(modelId));
      }
      return chat;
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
