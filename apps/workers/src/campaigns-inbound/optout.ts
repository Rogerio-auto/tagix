/**
 * Opt-out por keyword (CAMPAIGNS.md 9.3 + 16). MATCH EXATO apenas:
 * normaliza trim + uppercase e compara com o conjunto de keywords. NUNCA dispara
 * para um texto que apenas CONTEM a palavra (anti-falso-positivo do 16) —
 * "quero PARAR de receiver as 18h" nao opta o contato out; so "PARAR" sozinho.
 */

export const OPT_OUT_KEYWORDS = [
  'STOP',
  'PARAR',
  'SAIR',
  'CANCELAR',
  'REMOVER',
  'DESCADASTRAR',
] as const;

const OPT_OUT_SET: ReadonlySet<string> = new Set(OPT_OUT_KEYWORDS);

/**
 * true SOMENTE se o texto inteiro (apos trim+upper) E uma keyword de opt-out.
 * Match parcial/substring NUNCA conta.
 */
export function isOptOutKeyword(text: string | null | undefined): boolean {
  if (!text) return false;
  const normalized = text.trim().toUpperCase();
  return OPT_OUT_SET.has(normalized);
}
