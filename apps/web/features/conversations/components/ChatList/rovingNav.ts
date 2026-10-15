/**
 * Navegação por setas da lista de conversas (roving tabindex, UX §2.10).
 * Função pura: dado a tecla, o índice focado e o tamanho da lista, devolve o próximo
 * índice, ou `null` quando a tecla não é de navegação (o evento segue intacto).
 */
export function nextFocusIndex(key: string, current: number, count: number): number | null {
  if (count <= 0) return null;
  switch (key) {
    case 'ArrowDown':
      return current < 0 ? 0 : Math.min(current + 1, count - 1);
    case 'ArrowUp':
      return current < 0 ? 0 : Math.max(current - 1, 0);
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}
