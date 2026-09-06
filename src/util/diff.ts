// Minimal line diff (LCS-based) used for write/edit previews and git-ish output.
// Kept dependency-free so the whole CLI stays a plain npm install.

export type DiffLine = { type: 'add' | 'del' | 'ctx'; text: string };

export function diffLines(
  oldText: string,
  newText: string,
  context = 3,
): DiffLine[] {
  const a = oldText.split('\n');
  const b = newText.split('\n');

  // LCS table (fine for file-sized inputs; files are capped elsewhere)
  const n = a.length;
  const m = b.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0),
  );
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] =
        a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const full: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      full.push({ type: 'ctx', text: a[i] });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      full.push({ type: 'del', text: a[i] });
      i++;
    } else {
      full.push({ type: 'add', text: b[j] });
      j++;
    }
  }
  while (i < n) full.push({ type: 'del', text: a[i++] });
  while (j < m) full.push({ type: 'add', text: b[j++] });

  // Trim to a window around changes, keeping `context` lines
  const keep = new Array<boolean>(full.length).fill(false);
  full.forEach((l, idx) => {
    if (l.type !== 'ctx') {
      for (let k = Math.max(0, idx - context); k <= Math.min(full.length - 1, idx + context); k++) {
        keep[k] = true;
      }
    }
  });

  const out: DiffLine[] = [];
  let skipping = false;
  full.forEach((l, idx) => {
    if (keep[idx]) {
      if (skipping) out.push({ type: 'ctx', text: '...' });
      skipping = false;
      out.push(l);
    } else {
      skipping = true;
    }
  });
  return out;
}

export function diffStat(lines: DiffLine[]): string {
  const add = lines.filter((l) => l.type === 'add').length;
  const del = lines.filter((l) => l.type === 'del').length;
  return `+${add} -${del}`;
}
