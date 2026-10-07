/**
 * Reconexão do socket (F71-S08). As rooms `ws:<empresa>` e `member:<id>` são
 * decididas NO HANDSHAKE, pelo cookie `hm_workspace` — então, ao trocar de empresa,
 * o mesmo socket precisa passar por um handshake novo para entrar nas rooms da
 * empresa ativa e sair das da anterior. A instância é a mesma (listeners dos hooks
 * ficam), só o transporte reinicia.
 */

/** Fatia mínima do cliente Socket.io que a reconexão usa. */
interface ReconnectableSocket {
  disconnect?: () => unknown;
  connect?: () => unknown;
}

/**
 * Derruba e religa o socket global. Devolve `true` se havia socket para reconectar.
 * Best-effort: um socket que já caiu não pode impedir a troca de empresa.
 */
export function reconnectSocket(): boolean {
  if (typeof window === 'undefined') return false;
  const socket = window.__hmSocket as ReconnectableSocket | undefined;
  if (!socket || typeof socket.connect !== 'function') return false;
  try {
    socket.disconnect?.();
    socket.connect();
    return true;
  } catch {
    return false;
  }
}
