# windcode

Agentic coding CLI — baca kode, edit kode, jalankan command, dan bertanya kalau permintaannya tidak jelas. Dibangun dari nol dengan TypeScript + Node.js, berjalan di **Linux, Windows, macOS, dan Termux (Android)**.

## Fitur

Agent loop produksi dengan arsitektur yang sama kaya agent coding modern — berjalan penuh di Node.js:

- **Agent loop kelas produksi** — streaming, retry transien, *stale-item repair*, **compaction otomatis** saat konteks membengkak (dengan summary yang ditulis model via `/compact`).
- **5 varian agent** — `default`, `quick`, `deep`, `plan`, `review` (`/agent`) + tingkat thinking `off→max` (`/think`). Varian read-only menyembunyikan tools mutasi.
- **26 tools dalam 5 set** — `read_file`, `write_file`, `edit_file`, `multi_edit`, `apply_patch` (atomik multi-file), `glob`, `grep` (ripgrep + fallback JS), `bash` (streaming + interrupt tanpa mematikan turn), git read-only, `web_fetch`, `task` (sub-agent), `ask`, `todo_write`, memory `remember/recall/forget`.
- **Sandbox path (jail)** — model tidak bisa keluar dari workspace; `walk` menghormati `.gitignore` + `.windcodeignore` bertingkat.
- **Permission berlapis** — aturan per-tool/pattern (`permission` di config), guard plugin yang menolak `rm -rf /` dsb. bahkan saat `--yolo`, repeat-guard untuk call identik beruntun, approval `y/a/n` dengan pola `always` (mis. `git *`).
- **Multi-provider** dengan Zen gratis sebagai default (lihat di bawah) + Ollama/LM Studio lokal tanpa key + BYOK semua gateway populer.
- **Skills, plugins, memory proyek, MCP** — skills = prompt terstruktur, plugins = aturan refusal deklaratif, memory persisten per-proyek (`/notes`), dan MCP server via config.
- **AGENTS.md** — instruksi proyek (`/init` menulisannya untuk lu) otomatis masuk system prompt.
- **Sesi** — auto-save ter-debounce, `/resume` (id bisa prefix), `/cost` estimasi biaya, headless `-p` + `--json` untuk script/CI.


## Install

Butuh **Node.js ≥ 20**. Satu baris — Linux, macOS, Termux (Android):

```bash
# Linux, macOS, Termux
curl -fsSL https://raw.githubusercontent.com/prototypeall850-creator/windcode/main/scripts/install.sh | sh
```

Installer mendownload bundle jadi dari GitHub Releases (dist + dependencies tergabung, ±5MB), memverifikasi checksum sebelum memasang, menaruh app di `~/.windcode`, dan menyediakan perintah `windcode` di PATH. **Tanpa npm, tanpa clone.**

Node.js-nya sendiri belum ada?

```bash
# Termux (Android) — Termux diambil dari F-Droid, bukan Play Store
pkg install nodejs-lts curl

# Ubuntu / Debian
sudo apt install -y nodejs npm curl

# Fedora
sudo dnf install -y nodejs

# Windows (PowerShell)
winget install OpenJS.NodeJS.LTS

# macOS
brew install node
```

Windows belum punya installer otomatis — pakai jalur source di bawah (PowerShell biasa), atau download `windcode-bundle.tar.gz` dari [Releases](https://github.com/prototypeall850-creator/windcode/releases), ekstrak, lalu `node dist\index.js`.

Atau dari source (butuh npm):

```bash
git clone https://github.com/prototypeall850-creator/windcode
cd windcode
npm install   # sekalian build (script prepare)
npm link      # builds and puts `windcode` on PATH
```

## First run

```
windcode
```

Jalankan `windcode` di folder proyek. Kalau belum ada API key, wizard setup muncul: pilih **OpenCode Zen** (ada model gratis — ambil key gratis di [opencode.ai/zen](https://opencode.ai/zen)), Ollama (100% lokal, tanpa key), atau provider lain. Config tercatat di `~/.windcode/config.json` — pakai `/model` kapan saja untuk ganti model, `/help` untuk daftar perintah, dan `windcode doctor` bila ada yang terasa tidak jalan.

```
windcode v0.1.2 — OpenCode Zen/big-pickle
  cwd: ~/proyek  |  tools: core, edit-plus, git, agent
  /help untuk daftar perintah. ctrl-c untuk keluar.

windcode ›
```

Mode headless untuk script/CI: `windcode -p "tugasnya" --yolo`.

## Update

Instalasi lewat installer bisa self-update — cek rilis terbaru, verifikasi checksum, lalu tukar app-nya:

```bash
windcode update
```

Update ke versi < 0.2.1: jalankan lagi perintah curl install di atas (perintah `update` baru ada mulai v0.2.1). Instalasi via source/npm tetap update dengan `git pull && npm install` / `npm update -g windcode`.

Jalankan `windcode` pertama kali → wizard onboarding: pilih **OpenCode Zen (gratis)** / Ollama / provider lain, paste API key, pilih model. Ganti provider kapan saja:

```bash
windcode login zen        # setup ulang key
windcode models zen       # lihat model dari endpoint
windcode -m openrouter/deepseek/deepseek-chat-v3.1:free -p "jelaskan repo ini"
```

## Pemakaian

```
windcode                     # REPL interaktif
windcode -p "perbaiki bug X" # one-shot
windcode --yolo -p "..."     # one-shot tanpa approval (CI)
windcode --resume            # lanjutkan sesi terakhir
windcode sessions            # daftar sesi
```

Slash command di REPL: `/help`, `/model`, `/tools`, `/sessions`, `/resume`, `/yolo`, `/clear`, `/exit`.

Config ada di `~/.windcode/config.json`:

```json
{
  "defaultProvider": "zen",
  "defaultModel": "big-pickle",
  "apiKeys": { "zen": "..." },
  "toolSets": ["edit-plus", "git", "agent"]
}
```

`toolSets` yang tersedia: `edit-plus`, `git`, `net`, `agent` (core selalu aktif).

## Arsitektur

Lapisan engine (modul-modul terpisah, satu tanggung jawab per modul): `session.ts` (loop + approval + compaction), `tools*.ts` (26 tools), `ignore.ts` (jail + walk gitignore), `permission.ts` + `plugins*.ts` (aturan & guard), `memory.ts`, `prune.ts`, `subagent.ts` + `agents.ts`, `skills*.ts` + `registry.ts`, `store.ts` (sesi + riwayat prompt), `instructions.ts` (AGENTS.md), `prompt.ts`, `headless.ts`, `markdown.ts`, `pricing.ts`, `commands.ts`. Jembatan Bun→Node ada di `fsx.ts`.

Lapisan windcode: `providers.ts` + `config.ts` (registry multi-provider, Zen default), `onboarding.ts` (wizard), `ui/repl.ts` + `ui/render.ts` (readline REPL), `index.ts` (CLI), `scripts/install.sh` (installer curl).

```
src/
  index.ts          entry + CLI (commander)
  config.ts         provider registry + config (~/.windcode/config.json)
  onboarding.ts     wizard first-run
  session.ts        persistensi percakapan
  llm/client.ts     client seragam (Vercel AI SDK) untuk semua provider
  agent/
    loop.ts         agent loop + sub-agent
    context.ts      system prompt + pemangkasan konteks
    permissions.ts  guard, allowlist, approval gate
    tools/          satu modul per tool set
  ui/
    repl.ts         REPL + slash commands
    render.ts       banner, diff berwarna, prompt approval
scripts/            smoke test + e2e test (mock LLM server)
```

## Tes

```bash
npx tsx scripts/smoke.ts   # 14 tes tools + permission (tanpa API key)
npx tsx scripts/e2e.ts     # agent loop end-to-end vs mock LLM server
```

## Catatan Termux (Android)

Extra keys (tanda `|`, `/`, `-`) nggak muncul? Geser dari kiri layar → Keyboard. Untuk paste API key enak: `pkg install termux-api` + app **Termux:API** (dari F-Droid juga), lalu `termux-clipboard-paste`. Kerjakan proyek di home Termux (`~`), bukan shared storage, supaya symlink npm link tidak bermasalah.

## Roadmap

- Skill registry & plugin guard yang lebih dalam
- MCP support
- TUI versi Go + Bubble Tea (proyek terpisah)
- Distribusi single binary
