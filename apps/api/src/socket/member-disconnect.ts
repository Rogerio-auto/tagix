/**
 * Seam de desconexão imediata de sockets de um membro (F71 — F-03).
 *
 * As rotas (bloquear/remover membro) não conhecem o `io`; o bootstrap do socket registra
 * aqui o desconector real (mesmo padrão de `support-realtime`). Sem registro (testes de
 * rota, processo sem socket) é no-op — o timer de revalidação cobre o resto. Com o adapter
 * Redis, `io.in(room).disconnectSockets(true)` alcança todas as instâncias da API.
 */
export type MemberDisconnector = (memberId: string) => void | Promise<void>;

let disconnector: MemberDisconnector | null = null;

/** Registra (ou limpa) o desconector. Chamado no bootstrap do Socket.io. */
export function setMemberDisconnector(fn: MemberDisconnector | null): void {
  disconnector = fn;
}

/** Derruba os sockets do membro. Best-effort: nunca lança (a rota já commitou). */
export async function disconnectMemberSockets(memberId: string): Promise<void> {
  if (!disconnector) return;
  try {
    await disconnector(memberId);
  } catch {
    // best-effort: o timer de revalidação derruba no próximo ciclo.
  }
}
