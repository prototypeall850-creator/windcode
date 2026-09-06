import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, chmodSync, cpSync, realpathSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { VERSION } from './version.js';
import { bold, cyan, dim, red, yellow } from './util/ansi.js';

// ---------------------------------------------------------------------------
// `windcode update` — self-update for installs made via scripts/install.sh.
// Downloads the latest GitHub Release bundle, verifies its SHA-256, swaps it
// into ~/.windcode/app, and makes sure the `windcode` wrapper is on PATH.
// ---------------------------------------------------------------------------

const REPO = 'prototypeall850-creator/windcode';
const INSTALL_DIR = join(process.env['WINDCODE_HOME'] ?? homedir(), '.windcode');
const APP_DIR = join(INSTALL_DIR, 'app');

const UA = { 'User-Agent': 'windcode-selfupdate' };

function isInstallerInstall(): boolean {
  // argv[1] is the executed entry script; source/npm installs live elsewhere.
  try {
    return realpathSync(process.argv[1] ?? '').startsWith(realpathSync(INSTALL_DIR));
  } catch {
    return false;
  }
}

function binDir(): string {
  const prefix = process.env['PREFIX'];
  if (prefix && prefix.includes('com.termux')) return join(prefix, 'bin'); // Termux: always on PATH
  return join(homedir(), '.local/bin');
}

function ensureWrapper(): void {
  const wrapper = join(binDir(), 'windcode');
  const body = `#!/bin/sh\nexec node "${join(APP_DIR, 'dist', 'index.js')}" "$@"\n`;
  if (existsSync(wrapper)) {
    // A symlink means a source/npm-linked install — do not touch it.
    try {
      if (realpathSync(wrapper) !== wrapper) return;
    } catch {
      /* fall through and rewrite */
    }
  }
  writeFileSync(wrapper, body);
  chmodSync(wrapper, 0o755);
}

async function download(url: string): Promise<Buffer> {
  const res = await fetch(url, { headers: UA, redirect: 'follow' });
  if (!res.ok) throw new Error(`download gagal: HTTP ${res.status} (${url})`);
  return Buffer.from(await res.arrayBuffer());
}

export async function update(): Promise<number> {
  console.log(bold('windcode update'));
  console.log(dim(`  versi sekarang: v${VERSION}`));

  if (!isInstallerInstall()) {
    console.log(
      yellow(
        '  instalasi ini bukan dari installer (kayaknya source/npm link).\n' +
          '  Update lewat jalur itu: `git pull && npm install` atau `npm update -g windcode`,\n' +
          '  atau pasang ulang dengan installer curl lalu pakai `windcode update`.',
      ),
    );
    return 1;
  }

  // 1. latest release
  let latest = '';
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: UA });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as { tag_name?: string };
    latest = (body.tag_name ?? '').replace(/^v/, '');
  } catch (e) {
    console.log(red(`✗ gagal cek rilis terbaru: ${e instanceof Error ? e.message : String(e)}`));
    return 1;
  }
  if (!latest) {
    console.log(red('✗ tidak ada informasi rilis terbaru.'));
    return 1;
  }
  if (latest === VERSION) {
    console.log(cyan(`✓ sudah versi terbaru (v${VERSION})`));
    return 0;
  }
  console.log(dim(`  versi baru tersedia: v${latest} — mendownload…`));

  // 2. download bundle + checksum
  const base = `https://github.com/${REPO}/releases/download/v${latest}`;
  let bundle: Buffer;
  let expected = '';
  try {
    bundle = await download(`${base}/windcode-bundle.tar.gz`);
    expected = (await download(`${base}/windcode-bundle.tar.gz.sha256`)).toString('utf8').trim().split(/\s+/)[0] ?? '';
  } catch (e) {
    console.log(red(`✗ ${e instanceof Error ? e.message : String(e)}`));
    return 1;
  }

  // 3. verify checksum
  if (expected) {
    const actual = createHash('sha256').update(bundle).digest('hex');
    if (actual !== expected) {
      console.log(red('✗ checksum tidak cocok — download korup atau dimanipulasi. Batal.'));
      return 1;
    }
    console.log(dim('  checksum ✓'));
  }

  // 4. extract & swap
  const tmp = mkdtempSync(join(tmpdir(), 'windcode-update-'));
  const tarball = join(tmp, 'windcode-bundle.tar.gz');
  writeFileSync(tarball, bundle);
  const extract = spawnSync('tar', ['-xzf', tarball, '-C', tmp]);
  if (extract.status !== 0) {
    console.log(red(`✗ ekstraksi gagal: ${extract.stderr?.toString().trim() || 'tar tidak tersedia?'}`));
    rmSync(tmp, { recursive: true, force: true });
    return 1;
  }
  rmSync(APP_DIR, { recursive: true, force: true });
  cpSync(join(tmp, 'windcode'), APP_DIR, { recursive: true });
  rmSync(tmp, { recursive: true, force: true });

  // 5. wrapper on PATH
  ensureWrapper();

  console.log(cyan(`✓ terupdate ke v${latest}. Jalankan \`windcode --version\` di sesi baru untuk konfirmasi.`));
  return 0;
}
