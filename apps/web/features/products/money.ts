/**
 * Formatação/parse de valores monetários do catálogo (F47-S05).
 *
 * O backend guarda em centavos (`priceCents` bigint). Aqui convertemos para/de
 * uma string editável no formato pt-BR. Default BRL (não-objetivo §9: sem multi-
 * moeda no MVP — herda a moeda do produto/deal).
 */

/** Formata centavos como moeda (default BRL) via Intl. Ex.: 12990 → "R$ 129,90". */
export function formatCents(cents: number, currency = 'BRL'): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency,
  }).format(cents / 100);
}

/**
 * Converte uma string digitada (pt-BR, ex.: "1.299,90" ou "1299.9") em centavos
 * inteiros. Aceita vírgula ou ponto como separador decimal. Retorna `null` quando
 * não há número válido.
 */
export function parseToCents(input: string): number | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  // Remove tudo que não é dígito, vírgula ou ponto; normaliza o separador decimal.
  const cleaned = trimmed.replace(/[^\d.,-]/g, '');
  // Último separador (vírgula ou ponto) é o decimal; os demais são milhar.
  const lastComma = cleaned.lastIndexOf(',');
  const lastDot = cleaned.lastIndexOf('.');
  let normalized: string;
  if (lastComma === -1 && lastDot === -1) {
    normalized = cleaned;
  } else if (lastComma > lastDot) {
    // Vírgula é o decimal → remove pontos de milhar, troca vírgula por ponto.
    normalized = cleaned.replace(/\./g, '').replace(',', '.');
  } else {
    // Ponto é o decimal → remove vírgulas de milhar.
    normalized = cleaned.replace(/,/g, '');
  }
  const value = Number.parseFloat(normalized);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 100);
}

/** Centavos → string editável "129,90" (pt-BR, sem símbolo). Para preencher o input. */
export function centsToInputValue(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
