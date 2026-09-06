// E2E: Session engine (hasil porting) end-to-end vs mock LLM server lokal.
import { server, PORT } from './mock-llm.js';
import { Session } from '../src/session.js';
import { resolveModel, type Config } from '../src/config.js';
import { runHeadless } from '../src/headless.js';

const cfg: Config = {
  provider: 'mock',
  model: 'mock-model',
  baseURL: `http://127.0.0.1:${PORT}/v1`,
  apiKey: 'test-key',
};

const model = resolveModel(cfg);
const session = new Session({
  model,
  askApproval: async () => 'once',
  yolo: false,
  instructions: [],
  skills: [],
});

let captured = '';
const code = await runHeadless({
  session,
  prompt: 'tolong baca package.json',
  format: 'text',
  out: (chunk) => {
    captured += chunk;
  },
});

const toolMsgs = session.messages.filter((m) => m.role === 'tool');
const assistant = session.messages.filter((m) => m.role === 'assistant');

console.log('--- captured ---');
console.log(captured.trim());
console.log('--- history ---');
console.log(JSON.stringify(session.messages.map((m) => ({ role: m.role, parts: Array.isArray(m.content) ? m.content.map((c: any) => c.type) : 'text' }))));

let failures = 0;
if (!captured.includes('File package.json terbaca')) {
  console.log('✗ teks final tidak ter-stream');
  failures++;
}
if (toolMsgs.length === 0) {
  console.log('✗ tidak ada tool result di history');
  failures++;
}
if (assistant.length === 0) {
  console.log('✗ tidak ada pesan assistant di history');
  failures++;
}
if (code !== 0) {
  console.log(`✗ exit code headless = ${code}`);
  failures++;
}
console.log(failures === 0 ? '\nE2E LULUS ✅' : `\n${failures} E2E GAGAL ❌`);
server.close();
process.exit(failures === 0 ? 0 : 1);
