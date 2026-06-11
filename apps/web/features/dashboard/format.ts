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
