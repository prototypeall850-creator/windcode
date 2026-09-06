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
  - **OpenCode Zen** (default) — ada model gratis (`big-pickle`, `qwen3.6-plus-free`, …), key gratis dari [opencode.ai/zen](https://opencode.ai/zen)
  - **Ollama** — 100% lokal, tanpa API key
  - **BYOK** — OpenRouter (ada model `:free`), Groq, Cerebras, GitHub Models, Google Gemini, Anthropic, OpenAI
- **Keamanan berlapis**:
  - *Guard* menolak command destruktif (`rm -rf /`, `mkfs`, fork bomb, force push, …) — bahkan saat `--yolo`
  - File `.env` / `.pem` / `.key` ditolak dibaca/ditulis
  - Write/edit/bash/web_fetch butuh approval `[y]a / [a]lways / [n]o` dengan preview diff
  - Allowlist per-pattern sesi, mis. `echo *` setelah "always"
- **Sesi tersimpan** di `~/.windcode/sessions/` — bisa dilanjutkan dengan `/resume` atau `--resume`.
- **Mode headless** — `windcode -p "tugas"` untuk script/CI (pasangkan dengan `--yolo`).

## Setup

Butuh Node.js ≥ 20.

```bash
git clone https://github.com/prototypeall850-creator/windcode
cd windcode
npm install        # otomatis build (script prepare)
npm link           # biar perintah `windcode` bisa dipanggil dari mana saja
```

Atau satu baris lewat npm:

```bash
npm install -g github:prototypeall850-creator/windcode
```

## Install di HP (Android / Termux)

Semua lewat `pkg` (package manager bawaan Termux) — tidak butuh `curl`/`irm`.

1. Install **Termux dari F-Droid** ([f-droid.org/packages/com.termux](https://f-droid.org/packages/com.termux/)) — jangan dari Play Store (versinya usang).
2. Di Termux:

   ```bash
   pkg update -y
   pkg install nodejs-lts git -y
   npm install -g github:prototypeall850-creator/windcode
   ```

3. Jalankan di folder proyek:

   ```bash
   cd ~/proyek-lu
   windcode
   ```

4. Wizard onboarding muncul → pilih **OpenCode Zen (gratis)** → buka [opencode.ai/zen](https://opencode.ai/zen) di browser HP untuk ambil API key gratis → paste → selesai.

Tips HP: kalau *extra keys row* (tanda `|`, `/`, `-`) nggak muncul, geser dari kiri layar → Keyboard. Untuk paste API key enak, `pkg install termux-api` + app Termux:API lalu pakai `termux-clipboard-paste`. Update ke versi terbaru: `npm update -g windcode` atau ulangi perintah install.

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

Jalan normal via `pkg install nodejs-lts` + `npm install`. Saran: kerjakan di folder storage yang sudah diizinkan (`termux-setup-storage`), dan ingat keyboard HP — windcode sengaja memakai UI readline sederhana tanpa shortcut esoterik.

## Roadmap

- Skill registry & plugin guard (seperti shiro-neko)
- MCP support
- TUI versi Go + Bubble Tea (proyek terpisah)
- Distribusi single binary
