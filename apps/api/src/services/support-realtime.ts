/**
 * Real-time do Chat de Suporte (F38-S08 / SUPPORT.md secao 2.3).
 *
 * Suporte vive 100% no processo da API (nao ha worker que emita evento de
 * suporte), entao emitimos DIRETO via o `io` em processo — sem passar pelo relay
 * RabbitMQ (`hm.q.socket.relay`), cujo enum de eventos (SERVER_TO_CLIENT_EVENTS)
 * e de outro pacote. Rooms:
 *   - `support:thread:<id>`  participantes de um thread (membro dono + plataforma)
 *   - `support:platform`     todos os platform admins (recebem novos threads/msgs)
 *
 * Autorizacao de join: o membro so entra no room de um thread que
 * `assertThreadVisible` permite (RLS por workspace); platform-admin entra no
 * `support:platform` e em qualquer thread. Nunca confiar no id vindo do client.
 *
 * O `io` e injetado no bootstrap (`setSupportIo`); o seam `onSupportEvent` (S07)
 * chama `emitSupportEvent` aqui. Sem io setado (ex.: testes de rota), e no-op.
 */
import { supportRepo, withWorkspace } from '@hm/db';
import { onSupportEvent, type SupportEvent } from '../routes/support';

export const SUPPORT_PLATFORM_ROOM = 'support:platform' as const;
export const supportThreadRoom = (threadId: string): string => `support:thread:${threadId}`;

/** Subconjunto do io que usamos — evita acoplar ao tipo completo do socket.io. */
export interface SupportEmitter {
  to(room: string | string[]): { emit(event: string, ...args: unknown[]): void };
}

let io: SupportEmitter | null = null;

/** Injeta o servidor Socket.io (chamado no bootstrap). */
export function setSupportIo(server: SupportEmitter | null): void {
  io = server;
}

/** Sessao minima necessaria para autorizar joins. */
export interface SupportSocketSession {
  workspaceId: string;
  memberId: string;
  isPlatformAdmin: boolean;
}

/**
 * Autoriza o join num room de thread. Platform-admin sempre pode; membro comum
 * so se `assertThreadVisible` (RLS) reconhecer a thread no seu workspace.
 */
export async function authorizeSupportThreadJoin(
  session: SupportSocketSession,
  threadId: string,
): Promise<boolean> {
  if (session.isPlatformAdmin) return true;
  return withWorkspace(session.workspaceId, async (tx) => {
    const thread = await supportRepo.assertThreadVisible(tx, threadId);
    return Boolean(thread);
  });
}

/**
 * Resolve as rooms-destino + nome do evento para um SupportEvent. Funcao PURA
 * (testavel sem io): a thread vai sempre para o seu room + `support:platform`
 * (para a triagem da equipe ver tudo em tempo real).
 */
export function resolveSupportEmit(event: SupportEvent): {
  rooms: string[];
  eventName: 'support:message' | 'support:thread_updated';
  data: unknown;
} {
  const threadRoom = supportThreadRoom(event.thread.id);
  const rooms = [threadRoom, SUPPORT_PLATFORM_ROOM];
  if (event.kind === 'thread_updated') {
    return { rooms, eventName: 'support:thread_updated', data: { thread: event.thread } };
  }
  // thread_opened + message → support:message (thread_opened tambem carrega a 1a msg).
  return {
    rooms,
    eventName: 'support:message',
    data: { thread: event.thread, message: event.message, opened: event.kind === 'thread_opened' },
  };
}

/** Emite o SupportEvent para as rooms corretas. No-op se `io` nao foi setado. */
export function emitSupportEvent(event: SupportEvent): void {
  if (!io) return;
  const { rooms, eventName, data } = resolveSupportEmit(event);
  io.to(rooms).emit(eventName, data);
}

/**
 * Liga o seam onSupportEvent (S07) ao emit real-time. Chamado UMA vez no
 * bootstrap do socket (apos setSupportIo). Idempotente (onSupportEvent dedup
 * por referencia).
 */
export function wireSupportRealtime(server: SupportEmitter): void {
  setSupportIo(server);
  onSupportEvent(emitSupportEvent);
}
