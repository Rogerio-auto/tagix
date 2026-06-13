/**
 * Formatação de valores do dashboard. Pt-BR, sem hardcode de moeda nos componentes.
 */

export function formatInt(n: number): string {
  return new Intl.NumberFormat('pt-BR').format(n);
}

export function formatBRLFromCents(cents: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);
}

export function formatUSD(usd: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'USD' }).format(usd);
}

/** Lê um número de um value jsonb com fallback seguro. */
export function readNumber(value: Record<string, unknown> | null, key: string): number | null {
  const v = value?.[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Duração legível a partir de segundos: "1m 42s", "12s", "—" se null. */
export function formatDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return '—';
  const total = Math.round(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  if (m === 0) return `${s}s`;
  return `${m}m ${s}s`;
}

/** Percentual inteiro: "78%". */
export function formatPercent(pct: number): string {
  return `${Math.round(pct)}%`;
}

/**
 * Formata uma célula de tabela conforme a convenção da `column.key` (contrato
 * F28-S01): `*_cents` → BRL; `*_seg`/`*_resposta_seg` → duração; numérico puro → int;
 * resto → string. Mantém a renderização genérica sem hardcode por métrica.
 */
export function formatTableCell(key: string, raw: unknown): string {
  if (raw === null || raw === undefined) return '—';
  if (key.endsWith('_cents')) {
    return formatBRLFromCents(Number(raw));
  }
  if (key.endsWith('_seg')) {
    return formatDuration(typeof raw === 'number' ? raw : Number(raw));
  }
  if (key === 'cost_usd') {
    return formatUSD(Number(raw));
  }
  if (typeof raw === 'number') {
    return formatInt(raw);
  }
  const asNum = Number(raw);
  if (typeof raw === 'string' && raw.trim() !== '' && Number.isFinite(asNum) && /^\d+$/.test(raw)) {
    return formatInt(asNum);
  }
  return String(raw);
}

/**
 * §F29 Onda B — formatação de score de qualidade (0-100): "90 / 100". `null` → "—".
 */
export function formatScore100(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  return `${Math.round(value)} / 100`;
}

/**
 * Rótulo textual do sentimento CSAT (acompanha a barra de distribuição — a11y: não
 * depender só de cor). Faixas: ≥30 positivo, ≤-30 negativo, entre neutro.
 */
export function csatSentimentLabel(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return 'Sem dados';
  if (value >= 30) return 'Positivo';
  if (value <= -30) return 'Negativo';
  return 'Neutro';
}

/** Rótulo legível pt-BR de uma categoria de objeção (vocab fixo §2). */
const OBJECTION_LABELS: Record<string, string> = {
  price: 'Preço',
  timing: 'Momento',
  trust: 'Confiança',
  competitor: 'Concorrente',
  feature_gap: 'Falta de recurso',
  authority: 'Decisão/Autoridade',
  other: 'Outro',
};

export function objectionCategoryLabel(category: string): string {
  return OBJECTION_LABELS[category] ?? category;
}
