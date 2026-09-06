// Smoke test: exercise tools + permissions without an API key.
import { buildCoreTools } from '../src/agent/tools/core.js';
import { buildEditPlusTools } from '../src/agent/tools/editplus.js';
import { buildAgentTools } from '../src/agent/tools/agent-tools.js';
import { guardVerdict } from '../src/agent/permissions.js';
import type { ToolContext } from '../src/agent/tools/types.js';

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
      console.log(`   [mock approval] ${req.title} → y`);
      return 'y';
    },
    askUser: async (q) => `jawaban-mock: ${q}`,
  },
};

let failures = 0;
async function check(label: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`✓ ${label}`);
  } catch (e) {
    failures++;
    console.log(`✗ ${label}: ${(e as Error).message}`);
  }
}

const assert = (cond: boolean, msg: string) => {
  if (!cond) throw new Error(msg);
};

const core = buildCoreTools(ctx);
const edit = buildEditPlusTools(ctx);
const agent = buildAgentTools(ctx);

await check('read_file membaca file nyata', async () => {
  const out = (await core.read_file.execute({ path: 'package.json' }, ctx)) as string;
  assert(out.includes('"windcode"'), 'nama proyek tidak ada di output');
});

await check('read_file menolak .env', async () => {
  const out = (await core.read_file.execute({ path: '.env' }, ctx)) as string;
  assert(out.startsWith('ERROR'), 'seharusnya ditolak');
});

await check('glob menemukan src', async () => {
  const out = (await core.glob.execute({ pattern: 'src/**/*.ts' }, ctx)) as string;
  assert(out.includes('src/agent/loop.ts'), 'loop.ts tidak ditemukan');
});

await check('grep menemukan string', async () => {
  const out = (await core.grep.execute({ pattern: 'GUARD_PATTERNS', include: '*.ts' }, ctx)) as string;
  assert(out.includes('permissions.ts'), 'tidak menemukan permissions.ts');
});

await check('bash jalan + allowlist always', async () => {
  const uiOrig = ctx.ui.requestApproval;
  ctx.ui.requestApproval = async (req) => {
    console.log(`   [mock approval] ${req.title} → a (always)`);
    return 'a';
  };
  const out1 = (await core.bash.execute({ command: 'echo hello-windcode' }, ctx)) as string;
  ctx.ui.requestApproval = async () => {
    throw new Error('seharusnya tidak diminta lagi (allowlist)');
  };
  const out2 = (await core.bash.execute({ command: 'echo lagi' }, ctx)) as string;
  ctx.ui.requestApproval = uiOrig;
  assert(out1.includes('hello-windcode'), `output aneh: ${out1}`);
  assert(out2.includes('lagi'), 'allowlist tidak bekerja');
});

await check('guard menolak rm -rf / dan shutdown', async () => {
  assert(guardVerdict('rm -rf /') !== null, 'rm -rf / lolos');
  assert(guardVerdict('sudo shutdown -h now') !== null, 'shutdown lolos');
  assert(guardVerdict('git push --force origin main') !== null, 'force push lolos');
  assert(guardVerdict('ls -la') === null, 'ls ikut ditolak');
});

await check('bash ditolak user (n)', async () => {
  ctx.ui.requestApproval = async () => 'n';
  const out = (await core.bash.execute({ command: 'whoami' }, ctx)) as string;
  ctx.ui.requestApproval = async (req) => {
    console.log(`   [mock approval] ${req.title} → y`);
    return 'y';
  };
  assert(out.startsWith('DENIED'), 'seharusnya DENIED');
});

await check('write_file + edit_file + diff preview', async () => {
  const w = (await core.write_file.execute(
    { path: '.smoke-test.txt', content: 'baris satu\nbaris dua\n' },
    ctx,
  )) as string;
  assert(w.startsWith('OK'), w);
  const e = (await core.edit_file.execute(
    { path: '.smoke-test.txt', old_string: 'baris dua', new_string: 'baris DUA diedit' },
    ctx,
  )) as string;
  assert(e.startsWith('OK'), e);
  const r = (await core.read_file.execute({ path: '.smoke-test.txt' }, ctx)) as string;
  assert(r.includes('DUA diedit'), 'edit tidak tersimpan');
});

await check('edit_file menolak ambigu', async () => {
  const out = (await core.edit_file.execute(
    { path: '.smoke-test.txt', old_string: 'baris', new_string: 'x' },
    ctx,
  )) as string;
  assert(out.includes('tidak ambigu') || out.includes('ditemukan'), out);
});

await check('multi_edit atomik', async () => {
  const ok = (await edit.multi_edit.execute(
    {
      path: '.smoke-test.txt',
      edits: [
        { old_string: 'baris satu', new_string: 'SATU' },
        { old_string: 'baris DUA diedit', new_string: 'DUA' },
      ],
    },
    ctx,
  )) as string;
  assert(ok.startsWith('OK'), ok);
  const fail = (await edit.multi_edit.execute(
    {
      path: '.smoke-test.txt',
      edits: [
        { old_string: 'SATU', new_string: 'satu' },
        { old_string: 'TIDAK ADA ABCXYZ', new_string: 'x' },
      ],
    },
    ctx,
  )) as string;
  assert(fail.startsWith('ERROR') && fail.includes('Tidak ada yang ditulis'), fail);
});

await check('move_file & delete_file', async () => {
  const m = (await edit.move_file.execute(
    { path: '.smoke-test.txt', new_path: '.smoke-test-renamed.txt' },
    ctx,
  )) as string;
  assert(m.startsWith('OK'), m);
  const d = (await edit.delete_file.execute({ path: '.smoke-test-renamed.txt' }, ctx)) as string;
  assert(d.startsWith('OK'), d);
});

await check('list_dir pohon', async () => {
  const out = (await edit.list_dir.execute({ path: 'src', depth: 2 }, ctx)) as string;
  assert(out.includes('agent/'), 'folder agent tidak terlihat');
});

await check('todo_write + ask', async () => {
  const t = (await agent.todo_write.execute(
    { todos: [{ content: 'uji smoke', status: 'in_progress' }] },
    ctx,
  )) as string;
  assert(t.includes('uji smoke'), t);
  assert(ctx.todos.length === 1, 'todos tidak terisi');
  const a = (await agent.ask.execute({ question: 'lanjut?' }, ctx)) as string;
  assert(a.includes('jawaban-mock'), a);
});

await check('memory remember/recall/forget', async () => {
  await agent.remember.execute({ note: 'smoke test note' }, ctx);
  const r = (await agent.recall.execute({}, ctx)) as string;
  assert(r.includes('smoke test note'), r);
  const f = (await agent.forget.execute({ match: 'smoke test' }, ctx)) as string;
  assert(f.startsWith('OK'), f);
});

console.log(failures === 0 ? '\nSEMUA LULUS ✅' : `\n${failures} TES GAGAL ❌`);
process.exit(failures === 0 ? 0 : 1);
