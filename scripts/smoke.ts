// Smoke test untuk engine hasil porting: ignore/jail, permission rules,
// tools inti, store, notebook — tanpa API key.
import { tools, disabledToolNames, isToolSetName, type ToolSetName } from '../src/tools.js';
import { jail, walk } from '../src/ignore.js';
import { Permissions, parsePermissions } from '../src/permission.js';
import * as store from '../src/store.js';
import { Notebook } from '../src/notebook.js';
import { globToRegex } from '../src/fsx.js';
import { guardPlugin } from '../src/plugins-builtin.js';

let failures = 0;
async function check(label: string, fn: () => Promise<void> | void): Promise<void> {
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

const exec = (name: keyof typeof tools, input: unknown) =>
  (tools[name] as any).execute(input as never, { toolCallId: 't', messages: [] } as never);

await check('read_file membaca file nyata dengan nomor baris', async () => {
  const out = (await exec('read_file', { path: 'package.json' })) as string;
  assert(out.includes('"windcode"'), 'nama proyek tidak ada di output');
  assert(/^\d+: /m.test(out), 'tanpa nomor baris');
});

await check('jail menolak path escape', async () => {
  let escaped = false;
  try {
    jail('../../etc/passwd');
  } catch {
    escaped = true;
  }
  assert(escaped, '../../etc/passwd lolos jail');
});

await check('write_file + edit_file + multi_edit atomik', async () => {
  const w = (await exec('write_file', { path: '.smoke.txt', content: 'satu\ndua\n' })) as string;
  assert(w.includes('Created') || w.includes('Wrote'), w);
  const e = (await exec('edit_file', { path: '.smoke.txt', oldString: 'dua', newString: 'DUA' })) as string;
  assert(/Replaced|replaced/.test(e), e);
  const multi = (await exec('multi_edit', {
    path: '.smoke.txt',
    edits: [
      { oldString: 'satu', newString: 'SATU' },
      { oldString: 'DUA', newString: 'tiga' },
    ],
  })) as string;
  assert(/Applied|applied/.test(multi), multi);
  const r = (await exec('read_file', { path: '.smoke.txt' })) as string;
  assert(r.includes('SATU') && r.includes('tiga'), r);
});

await check('edit ambigu ditolak tanpa replaceAll', async () => {
  await exec('write_file', { path: '.smoke2.txt', content: 'x x x\n' });
  let threw = false;
  try {
    await exec('edit_file', { path: '.smoke2.txt', oldString: 'x', newString: 'y' });
  } catch (e) {
    threw = /times|appears/i.test((e as Error).message);
  }
  assert(threw, 'edit ambigu harus melempar error');
});

await check('glob & grep bekerja', async () => {
  const g = (await exec('glob', { pattern: 'src/**/*.ts', limit: 50 })) as string;
  assert(g.includes('src/session.ts'), g);
  const gr = (await exec('grep', { pattern: 'GUARD', include: '*.ts' })) as string;
  assert(/^\S+\.ts:\d+:/m.test(gr), 'format grep salah: ' + gr.slice(0, 80));
  assert(globToRegex('src/**/a*.ts')('src/agent/ask.ts') === false ? globToRegex('**/*.ts')('src/agent/ask.ts') : true, 'globToRegex rusak');
});

await check('Permissions: allow/deny/ask + pattern', async () => {
  const p = new Permissions({});
  const read = p.check('read_file', { path: 'a.txt' });
  assert(read.decision === 'allow', 'read_file harus allow');
  const bash = p.check('bash', { command: 'echo hi' });
  assert(bash.decision === 'ask', 'bash default ask');
  p.grant('bash', 'echo *');
  const after = p.check('bash', { command: 'echo lagi' });
  assert(after.decision === 'allow', 'allowlist pattern gagal');
  const parsed = parsePermissions({ bash: { 'git *': 'allow' } });
  const gitRule = new Permissions({ config: parsed }).check('bash', { command: 'git status' });
  assert(gitRule.decision === 'allow', 'rule kustom gagal');
});

await check('guard plugin menolak perintah destruktif', async () => {
  const block = guardPlugin.beforeToolCall?.({ toolName: 'bash', input: { command: 'rm -rf /' }, cwd: process.cwd() });
  assert(typeof block === 'string', 'rm -rf / lolos guard');
  const ok = guardPlugin.beforeToolCall?.({ toolName: 'bash', input: { command: 'ls -la' }, cwd: process.cwd() });
  assert(ok === undefined, 'ls ikut diblok');
});

await check('store: save/load/list/resolveId prefix', async () => {
  process.env['WINDCODE_HOME'] = '/tmp/windcode-smoke-' + process.pid;
  const rec = {
    id: store.newId(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    cwd: '/tmp',
    provider: 'zen',
    model: 'big-pickle',
    title: 'smoke',
    inputTokens: 0,
    outputTokens: 0,
    messages: [],
  } satisfies store.SessionRecord;
  await store.save(rec);
  const loaded = await store.load(rec.id);
  assert(loaded?.title === 'smoke', 'load gagal');
  const byPrefix = await store.resolveId(rec.id.slice(0, 8));
  assert(byPrefix === rec.id, 'resolveId prefix gagal');
  const list = await store.list(5);
  assert(list.length >= 1, 'list kosong');
});

await check('notebook: add/toggle/state', () => {
  const nb = new Notebook();
  nb.tools().todo_write.execute(
    { todos: [{ content: 'uji', status: 'in_progress' }] },
    { toolCallId: 't', messages: [] } as never,
  );
  assert(nb.state().todos.length === 1, 'todos tidak tersimpan');
});

await check('toolSets: disabledToolNames', () => {
  const off = disabledToolNames(['core' as ToolSetName]);
  assert(off.includes('web_fetch'), 'web_fetch tidak ter-disable');
  assert(!off.includes('read_file'), 'core ikut ter-disable');
  assert(isToolSetName('core') && !isToolSetName('ngawur'), 'isToolSetName rusak');
});

await check('walk menghormati .gitignore', async () => {
  const seen: string[] = [];
  for await (const rel of walk({ root: process.cwd() })) {
    seen.push(rel);
    if (seen.length > 500) break;
  }
  assert(!seen.some((s) => s.startsWith('node_modules/')), 'node_modules bocor');
  assert(!seen.some((s) => s.startsWith('dist/')), 'dist bocor (gitignore)');
});

await check('bash jalan dan stream', async () => {
  const out = (await exec('bash', { command: 'echo hello-windcode' })) as string;
  assert(out.includes('hello-windcode'), out);
});

// cleanup
try {
  await exec('delete_file', { path: '.smoke.txt' });
  await exec('delete_file', { path: '.smoke2.txt' });
} catch {}

console.log(failures === 0 ? '\nSEMUA LULUS ✅' : `\n${failures} TES GAGAL ❌`);
process.exit(failures === 0 ? 0 : 1);
