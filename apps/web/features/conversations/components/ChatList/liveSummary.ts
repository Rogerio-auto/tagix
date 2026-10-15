/**
 * Resumo da região viva da ChatList (F72-S05): pt-BR, '' quando não há conversa com
 * mensagens novas. Função pura de uma contagem — mesmo número, mesmo texto, então o
 * leitor de tela não re-anuncia em re-renders idênticos.
 */
export function unreadSummary(count: number): string {
  if (!Number.isFinite(count) || count <= 0) return '';
  return count === 1 ? '1 conversa com mensagens novas' : `${count} conversas com mensagens novas`;
}
