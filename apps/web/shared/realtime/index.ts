/**
 * Infra de real-time do web (F1-S25): provider de Socket.io + hook de acesso.
 *
 * O `<SocketProvider>` conecta na API, publica o cliente em `window.__hmSocket`
 * (acendendo os hooks transport-agnostic) e expõe contexto com o socket tipado
 * e os helpers de join/leave de conversa via `useSocket()`.
 */
export { SocketProvider } from './SocketProvider';
export type {
  SocketContextValue,
  SocketProviderProps,
  HmSocket,
} from './SocketProvider';
export { useSocket } from './useSocket';
