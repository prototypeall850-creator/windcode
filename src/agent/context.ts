import type { ModelMessage } from 'ai';
import { platform } from 'node:os';
import { basename } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { projectMemoryFile } from '../util/paths.js';
import type { TodoItem } from './tools/types.js';

// ---------------------------------------------------------------------------
// Context building: the system prompt (identity + environment + live state)
// and token-budget trimming for long sessions.
// ---------------------------------------------------------------------------

export interface PromptState {
  cwd: string;
  toolSetNames: string[];
  todos: TodoItem[];
}

export function buildSystemPrompt(state: PromptState): string {
  const now = new Date();
  const todos =
    state.todos.length > 0
      ? '\n## Daftar tugas saat ini\n' +
        state.todos
          .map((t) => `- [${t.status === 'done' ? 'x' : t.status === 'in_progress' ? '~' : ' '}] ${t.content}`)
          .join('\n')
      : '';

  const memoryPath = projectMemoryFile(state.cwd);
  const memory =
    existsSync(memoryPath) && readFileSync(memoryPath, 'utf8').trim()
      ? '\n## Memory proyek\n' + readFileSync(memoryPath, 'utf8').trim()
      : '';

  return `Kamu adalah Windcode, agent coding yang bekerja di terminal user. Kamu membaca kode, menulis kode, menjalankan command, dan bertanya kalau permintaan tidak jelas.

# Lingkungan
- Direktori kerja: ${state.cwd}
- OS: ${platform()} (${process.platform})
- Tanggal: ${now.toISOString().slice(0, 10)}
- Tool sets aktif: ${state.toolSetNames.join(', ')}

# Cara bekerja
- Sebelum mengubah file, baca dulu bagian yang relevan agar edit-mu presisi.
- Untuk edit kecil pakai edit_file; banyak edit sekaligus di satu file pakai multi_edit; banyak file pakai apply_patch.
- Jalankan test/build yang relevan setelah perubahan ketika tersedia.
- Jelaskan singkat apa yang kamu lakukan, jangan dump isi file ke jawabanmu.
- Kalau permintaan ambigu atau keputusan milik user (mis. pilihan desain, hapus data), tanyakan lewat tool ask — jangan menebak untuk hal yang mahal dibatalkan.
- Untuk pencarian luas, pakai glob/grep; untuk eksplorasi besar yang butuh banyak bacaan, pakai tool task agar konteksmu tetap lega.
- Catat keputusan penting proyek dengan tool remember agar tidak hilang antar sesi.
- Bahasa jawaban: ikuti bahasa user.
${todos}${memory}`;
}

// ---------------------------------------------------------------------------
// Trimming — rough char/4 token estimate; drop oldest middle messages first.
// ---------------------------------------------------------------------------

const CHAR_PER_TOKEN = 4;

function messageTokens(m: ModelMessage): number {
  const text = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
  return Math.ceil(text.length / CHAR_PER_TOKEN) + 8;
}

export function trimMessages(messages: ModelMessage[], budgetTokens = 80_000): ModelMessage[] {
  let total = messages.reduce((sum, m) => sum + messageTokens(m), 0);
  if (total <= budgetTokens) return messages;

  // Keep at least the first user message and the last 6 messages.
  const minKeepHead = 1;
  const minKeepTail = 6;
  const trimmed = [...messages];
  while (total > budgetTokens && trimmed.length > minKeepHead + minKeepTail) {
    const removed = trimmed.splice(minKeepHead, 1)[0]; // drop oldest after the first message
    total -= messageTokens(removed);
  }
  if (total > budgetTokens) {
    // still over — drop from the tail of the middle section aggressively
    while (total > budgetTokens && trimmed.length > minKeepHead + 2) {
      const removed = trimmed.splice(minKeepHead, 1)[0];
      total -= messageTokens(removed);
    }
  }
  return trimmed;
}
