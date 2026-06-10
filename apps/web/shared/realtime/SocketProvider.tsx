'use client';

/**
 * Provider do cliente Socket.io (F1-S25, LIVECHAT.md §6).
 *
 * Conecta na API (`NEXT_PUBLIC_API_URL`) com o MESMO cookie de sessão da API
 * (`withCredentials: true` → o servidor autentica no handshake e entra o socket
 * nas rooms `ws:<workspaceId>` e `member:<memberId>` automaticamente — ver
 * `apps/api/src/socket/index.ts`).
 *
 * A instância é tipada contra o mapa `ServerToClient` de `@hm/shared` e
 * publicada em `window.__hmSocket`, acendendo todos os hooks
 * "transport-agnostic" já existentes (`useConversationSocket`, `TypingIndicator`,
 * …) sem acoplá-los a `socket.io-client`.
 *
 * Resiliência: a conexão nunca lança em falha (o socket.io reconecta sozinho);
 * SSR-safe (só conecta no browser). Cleanup no unmount: desconecta e limpa o
 * global.
 */

import type { ReactNode } from 'react';
import { createContext, useEffect, useMemo, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import type { ServerToClient } from '@hm/shared';

/**
 * Eventos que o client EMITE para o servidor pedindo entrada/saída da room de
 * uma conversa. O servidor (slot de API) escuta `conversation:join` /
 * `conversation:leave` e faz `socket.join`/`socket.leave` da room
 * `conversation:<id>`. As rooms de workspace/member já são entradas no
 * handshake; só a room por conversa é dinâmica (navegação).
 */
interface ClientToServer {
  'conversation:join': (conversationId: string) => void;
  'conversation:leave': (conversationId: string) => void;
}

/** Cliente Socket.io tipado contra o contrato de eventos de `@hm/shared`. */
export type HmSocket = Socket<ServerToClient, ClientToServer>;

export interface SocketContextValue {
  /** Instância ativa, ou `null` enquanto não conectada / no servidor. */
  readonly socket: HmSocket | null;
  /** `true` enquanto o transporte está conectado. */
  readonly connected: boolean;
  /** Entra na room da conversa (chamar ao abrir uma conversa). */
  joinConversation(conversationId: string): void;
  /** Sai da room da conversa (chamar ao fechar/trocar de conversa). */
  leaveConversation(conversationId: string): void;
}

export const SocketContext = createContext<SocketContextValue | null>(null);

/** URL base da API (mesma do `api-client`). */
const API_URL = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3001';

export interface SocketProviderProps {
  children: ReactNode;
}

export function SocketProvider({ children }: SocketProviderProps) {
  const socketRef = useRef<HmSocket | null>(null);
  const [socket, setSocket] = useState<HmSocket | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    // SSR-safe: só conecta no browser.
    if (typeof window === 'undefined') return;

    const instance: HmSocket = io(API_URL, {
      withCredentials: true,
      // socket.io já reconecta por padrão; explícito para deixar a intenção clara.
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1_000,
      reconnectionDelayMax: 10_000,
    });

    socketRef.current = instance;
    setSocket(instance);

    // O global é declarado em `features/conversations/hooks/useConversationSocket.ts`
    // como uma fatia mínima (`ConversationSocket`) do mesmo cliente. Em runtime é
    // este socket.io client (suporta todos os eventos Server→Client); estreitamos
    // via `unknown` — mesmo padrão de `TypingIndicator.tsx`. Não redeclaramos o
    // global (colidiria — TS2717).
    window.__hmSocket = instance as unknown as NonNullable<typeof window.__hmSocket>;

    const onConnect = (): void => setConnected(true);
    const onDisconnect = (): void => setConnected(false);
    // Falha de conexão NUNCA lança: apenas logamos; o socket.io tenta reconectar.
    const onConnectError = (err: Error): void => {
      console.warn('[socket] connect_error — tentando reconectar:', err.message);
    };

    instance.on('connect', onConnect);
    instance.on('disconnect', onDisconnect);
    instance.on('connect_error', onConnectError);

    return () => {
      instance.off('connect', onConnect);
      instance.off('disconnect', onDisconnect);
      instance.off('connect_error', onConnectError);
      instance.disconnect();
      if (window.__hmSocket === (instance as unknown as typeof window.__hmSocket)) {
        delete window.__hmSocket;
      }
      socketRef.current = null;
      setSocket(null);
      setConnected(false);
    };
  }, []);

  const value = useMemo<SocketContextValue>(
    () => ({
      socket,
      connected,
      joinConversation: (conversationId: string): void => {
        socketRef.current?.emit('conversation:join', conversationId);
      },
      leaveConversation: (conversationId: string): void => {
        socketRef.current?.emit('conversation:leave', conversationId);
      },
    }),
    [socket, connected],
  );

  return <SocketContext.Provider value={value}>{children}</SocketContext.Provider>;
}
