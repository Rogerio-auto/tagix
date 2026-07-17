/**
 * Diff de prompt linha-a-linha (F56-S31). LCS clássico (programação dinâmica) para
 * produzir a sequência mínima de add/del/eq entre duas versões de texto. Puro e
 * determinístico — sem dependências. Renderizado por `VersionDiff.tsx`.
 */

export type DiffLineType = 'eq' | 'add' | 'del';

export interface DiffLine {
  type: DiffLineType;
  text: string;
  /** Número da linha no lado esquerdo (from), quando aplicável. */
  leftNo: number | null;
  /** Número da linha no lado direito (to), quando aplicável. */
  rightNo: number | null;
}

/** Quebra em linhas preservando linhas vazias (split por \n, normaliza \r\n). */
function toLines(text: string): string[] {
  return text.replace(/\r\n/g, '\n').split('\n');
}

/**
 * Diff linha-a-linha entre `from` e `to` via LCS. Complexidade O(n·m) — adequado
 * para prompts (dezenas/centenas de linhas). Retorna a sequência em ordem de leitura.
 */
export function diffLines(from: string, to: string): DiffLine[] {
  const a = toLines(from);
  const b = toLines(to);
  const n = a.length;
  const m = b.length;

  // lcs[i][j] = comprimento da LCS de a[i..] e b[j..].
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      const rowI = lcs[i];
      const rowNext = lcs[i + 1];
      if (!rowI || !rowNext) continue;
      rowI[j] = a[i] === b[j] ? (rowNext[j + 1] ?? 0) + 1 : Math.max(rowNext[j] ?? 0, rowI[j + 1] ?? 0);
    }
  }

  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  let leftNo = 1;
  let rightNo = 1;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ type: 'eq', text: a[i] ?? '', leftNo, rightNo });
      i += 1;
      j += 1;
      leftNo += 1;
      rightNo += 1;
    } else if ((lcs[i + 1]?.[j] ?? 0) >= (lcs[i]?.[j + 1] ?? 0)) {
      out.push({ type: 'del', text: a[i] ?? '', leftNo, rightNo: null });
      i += 1;
      leftNo += 1;
    } else {
      out.push({ type: 'add', text: b[j] ?? '', leftNo: null, rightNo });
      j += 1;
      rightNo += 1;
    }
  }
  while (i < n) {
    out.push({ type: 'del', text: a[i] ?? '', leftNo, rightNo: null });
    i += 1;
    leftNo += 1;
  }
  while (j < m) {
    out.push({ type: 'add', text: b[j] ?? '', leftNo: null, rightNo });
    j += 1;
    rightNo += 1;
  }
  return out;
}

/** Contagem de linhas adicionadas/removidas — para o resumo do diff. */
export function diffStats(lines: DiffLine[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const l of lines) {
    if (l.type === 'add') added += 1;
    else if (l.type === 'del') removed += 1;
  }
  return { added, removed };
}
