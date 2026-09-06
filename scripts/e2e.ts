// E2E: full agent loop against the local mock LLM server.
import { server, PORT } from './mock-llm.js';
import { runAgentTurn } from '../src/agent/loop.js';
import type { ModelMessage } from 'ai';
import type { ToolContext } from '../src/agent/tools/types.js';
import type { WindcodeConfig } from '../src/config.js';

const config: WindcodeConfig = {
  defaultProvider: 'mock',
  defaultModel: 'mock-model',
  apiKeys: { mock: 'test-key' },
  toolSets: ['edit-plus', 'git', 'agent'],
};

const ctx: ToolContext = {
  cwd: process.cwd(),
  headless: false,
  yolo: false,
  allowlist: new Set<string>(),
  todos: [],
  ui: {
    onToolStart: () => {},
    onToolEnd: () => {},
    onCommandOutput: () => {},
    requestApproval: async (req) => {
      console.log(`   [approval] ${req.title} → y`);
      return 'y';
    },
    askUser: async (q) => `mock-jawaban: ${q}`,
  },
};

// register the mock provider by patching the registry through config lookup:
// resolveModel requires a known provider id, so import the registry and extend it.
const { PROVIDERS } = await import('../src/config.js');
PROVIDERS.push({
  id: 'mock',
  name: 'Mock',
  kind: 'openai-compatible',
  baseURL: `http://127.0.0.1:${PORT}/v1`,
  models: [{ id: 'mock-model', name: 'Mock Model' }],
});

const messages: ModelMessage[] = [{ role: 'user', content: 'tolong baca package.json' }];

let captured = '';
const origWrite = process.stdout.write.bind(process.stdout);
process.stdout.write = (chunk: any) => {
  captured += typeof chunk === 'string' ? chunk : chunk.toString();
  return true;
};

await runAgentTurn({ config, providerId: 'mock', modelId: 'mock-model', messages, ctx });

process.stdout.write = origWrite;

const assistant = messages.find((m) => m.role === 'assistant');
const toolMsgs = messages.filter((m) => m.role === 'tool');

console.log('--- captured stream ---');
console.log(captured.trim());
console.log('--- messages ---');
console.log(JSON.stringify(messages.map((m) => ({ role: m.role, parts: Array.isArray(m.content) ? m.content.map((c: any) => c.type) : 'text' })), null, 2));

let failures = 0;
if (!captured.includes('File package.json terbaca')) {
  console.log('✗ teks final tidak ter-stream');
  failures++;
}
if (toolMsgs.length === 0) {
  console.log('✗ tidak ada tool result yang dikembalikan ke model');
  failures++;
}
if (!assistant) {
  console.log('✗ tidak ada pesan assistant di history');
  failures++;
}
console.log(failures === 0 ? '\nE2E LULUS ✅' : `\n${failures} E2E GAGAL ❌`);
server.close();
process.exit(failures === 0 ? 0 : 1);
