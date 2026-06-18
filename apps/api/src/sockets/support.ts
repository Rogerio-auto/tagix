/**
 * Handlers Socket.io do Chat de Suporte (F38-S08). Registrados por socket no
 * bootstrap (`socket/index.ts`, ponto de registro). Cada socket:
 *   - platform-admin -> entra automaticamente em `support:platform`.
 *   - qualquer membro -> pode pedir `support:thread:join` de um thread que
 *     `authorizeSupportThreadJoin` permitir (visibilidade por workspace/RLS).
 *
 * Tipagem minima (SupportSocket) para nao acoplar ao tipo completo do socket.io
 * server — o ponto de registro passa um socket compativel.
 */
import {
  SUPPORT_PLATFORM_ROOM,
  authorizeSupportThreadJoin,
  supportThreadRoom,
  type SupportSocketSession,
} from '../services/support-realtime';

/** Subconjunto do socket que usamos. */
export interface SupportSocket {
  join(room: string | string[]): unknown;
  leave(room: string): unknown;
  on(event: string, listener: (payload: unknown) => void): unknown;
}

/**
 * Registra os handlers de suporte num socket ja autenticado. `session` vem da
 * sessao resolvida no handshake (mesma do resto do socket).
 */
export function registerSupportSocketHandlers(
  socket: SupportSocket,
  session: SupportSocketSession,
): void {
  // Platform-admins veem a fila de triagem inteira em tempo real.
  if (session.isPlatformAdmin) {
    socket.join(SUPPORT_PLATFORM_ROOM);
  }

  socket.on('support:thread:join', (threadId: unknown) => {
    if (typeof threadId !== 'string' || threadId.length === 0) return;
    void (async () => {
      const allowed = await authorizeSupportThreadJoin(session, threadId);
      if (allowed) socket.join(supportThreadRoom(threadId));
    })();
  });

  socket.on('support:thread:leave', (threadId: unknown) => {
    if (typeof threadId === 'string' && threadId.length > 0) {
      socket.leave(supportThreadRoom(threadId));
    }
  });
}
