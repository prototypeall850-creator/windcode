# windcode

Agentic coding CLI — baca kode, edit kode, jalankan command, dan bertanya kalau permintaannya tidak jelas. Dibangun dari nol dengan TypeScript + Node.js, berjalan di **Linux, Windows, macOS, dan Termux (Android)**.

## Fitur

- **Agent loop** — model menerima definisi tools, memanggilnya bila perlu, hasilnya dikembalikan ke model, sampai tugas selesai.
- **26 tools dalam 5 set** (konsep *tool sets*: set core selalu aktif, sisanya opsional via config agar hemat token):
  - `core` — `read_file`, `write_file`, `edit_file`, `glob`, `grep` (ripgrep + fallback JS), `bash` (output streaming)
  - `edit-plus` — `multi_edit`, `apply_patch` (atomik multi-file), `read_many_files`, `list_dir`, `move_file`, `delete_file`
  - `git` — `git_status`, `git_diff`, `git_log`, `git_show`, `git_blame`, `git_branch`, `git_commit_message` (read-only, bebas approval)
  - `net` — `web_fetch` (opt-in, cap 30rb karakter)
  - `agent` — `todo_write`, `ask`, `task` (sub-agent read-only), `remember`/`recall`/`forget` (memory per-proyek)
- **Multi-provider** dengan satu abstraksi:
  - **OpenCode Zen** (default) — ada model gratis (`big-pickle`, `deepseek-v4-flash-free`, `mimo-v2.5-free`, …), key gratis dari [opencode.ai/zen](https://opencode.ai/zen)
  - **Ollama** — 100% lokal, tanpa API key
  - **BYOK** — OpenRouter (ada model `:free`), Groq, Cerebras, GitHub Models, Google Gemini, Anthropic, OpenAI
- **Keamanan berlapis**:
  - *Guard* menolak command destruktif (`rm -rf /`, `mkfs`, fork bomb, force push, …) — bahkan saat `--yolo`
  - File `.env` / `.pem` / `.key` ditolak dibaca/ditulis
  - Write/edit/bash/web_fetch butuh approval `[y]a / [a]lways / [n]o` dengan preview diff
  - Allowlist per-pattern sesi, mis. `echo *` setelah "always"
- **Sesi tersimpan** di `~/.windcode/sessions/` — bisa dilanjutkan dengan `/resume` atau `--resume`.
- **Mode headless** — `windcode -p "tugas"` untuk script/CI (pasangkan dengan `--yolo`).

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

Update ke versi baru: jalankan lagi perintah curl install di atas (installer menimpa yang lama).

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
references/         shiro-neko (MIT) — repo referensi, bukan dependensi
```

## Tes

```bash
npx tsx scripts/smoke.ts   # 14 tes tools + permission (tanpa API key)
npx tsx scripts/e2e.ts     # agent loop end-to-end vs mock LLM server
```

## Catatan Termux (Android)

Extra keys (tanda `|`, `/`, `-`) nggak muncul? Geser dari kiri layar → Keyboard. Untuk paste API key enak: `pkg install termux-api` + app **Termux:API** (dari F-Droid juga), lalu `termux-clipboard-paste`. Kerjakan proyek di home Termux (`~`), bukan shared storage, supaya symlink npm link tidak bermasalah.

## Roadmap

- Skill registry & plugin guard (seperti shiro-neko)
- MCP support
- TUI versi Go + Bubble Tea (proyek terpisah)
- Distribusi single binary
