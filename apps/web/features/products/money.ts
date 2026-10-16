/**
 * Formatação/parse de valores monetários do catálogo (F47-S05; F72-S07 sem locale literal).
 *
 * O backend guarda em centavos (`priceCents` bigint). A moeda vem do produto/deal; o
 * idioma da formatação é o da interface (`@/shared/lib/locale`), nunca um literal aqui.
 */
import { centsToInput, formatMoney } from '@/shared/lib/locale';

/** Formata centavos na moeda do dado. Ex. (pt-BR): 12990, 'BRL' → "R$ 129,90". */
export function formatCents(cents: number, currency: string): string {
  return formatMoney(cents, currency);
}

/**
 * Converte uma string digitada (ex.: "1.299,90" ou "1299.9") em centavos
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

/** Centavos → string editável sem símbolo ("129,90" em pt-BR). Para preencher o input. */
export function centsToInputValue(cents: number): string {
  return centsToInput(cents);
}
