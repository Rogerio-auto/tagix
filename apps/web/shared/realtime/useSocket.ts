'use client';

import { useContext } from 'react';
import { SocketContext, type SocketContextValue } from './SocketProvider';

/**
 * Acesso ao cliente Socket.io compartilhado (F1-S25).
 *
 * Deve ser usado dentro de um `<SocketProvider>`. Expõe o socket tipado, o
 * estado de conexão e os helpers `joinConversation`/`leaveConversation` para
 * entrar/sair da room de uma conversa ao navegar.
 *
 * Nota: hooks "transport-agnostic" (`useConversationSocket`, `TypingIndicator`)
 * leem `window.__hmSocket` diretamente e NÃO precisam deste hook — ele é para
 * consumidores que querem o socket via contexto (ex.: gerenciar join/leave de
 * conversa).
 */
export function useSocket(): SocketContextValue {
  const ctx = useContext(SocketContext);
  if (ctx === null) {
    throw new Error('useSocket deve ser usado dentro de <SocketProvider>.');
  }
  return ctx;
}
