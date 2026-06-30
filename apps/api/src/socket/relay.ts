/**
 * Socket relay (F1-S11 / LIVECHAT.md §6). Consome `hm.q.socket.relay` no
 * RabbitMQ e reemite cada evento via Socket.io para as rooms corretas:
 * `conversation:{id}`, `ws:{workspaceId}` e `member:{id}`.
 *
 * O `Envelope.payload` carrega `{ event, room?, target?, data }`. Validamos o
 * shape com Zod no boundary (proibido `any`).
 */
import { z } from 'zod';
import { connectMq, consume } from '@hm/shared/mq';
import { SERVER_TO_CLIENT_EVENTS, type ServerToClientEvent } from '@hm/shared';
import { createLogger } from '@hm/logger';
import { bumpVersion } from '../cache';
import type { IoServer } from './index';

const RELAY_QUEUE = 'hm.q.socket.relay';

/**
 * Eventos que mudam a PROJEÇÃO da ChatList (preview, ordem, contador de não-lidas,
 * badges de status/atribuição/IA). Para estes, além de emitir no socket, bumpamos
 * a versão do cache versionado da lista (`hm:ws:v:{workspaceId}`, TTL 120s) — senão
 * o refetch do cliente (disparado pelo próprio evento) recebe a lista CACHEADA e
 * VELHA (preview/ordem/unread defasados por até 120s). Antes, o único bump era a
 * rota POST /:id/read → a lista só renovava ao marcar-lida; mensagem nova não
 * atualizava preview/contador em tempo real. `message:status_changed`/media/typing
 * NÃO entram aqui (não mudam a lista e são alta-frequência → manteria o cache vivo).
 */
const LIST_AFFECTING_EVENTS: ReadonlySet<ServerToClientEvent> = new Set([
  'message:new',
  'conversation:updated',
  'conversation:state_changed',
  'conversation:assigned',
  'conversation:routing_changed',
  'conversation:ai_mode_changed',
  'conversation:agent_changed',
]);

// Diagnóstico: loga cada emit (evento + salas) e quantos sockets há nas salas.
const relayLog = createLogger('info', { svc: 'socket-relay' });

/** Alvo de roteamento dentro de um workspace. */
const relayTargetSchema = z.object({
  conversationId: z.string().optional(),
  memberId: z.string().optional(),
  /** Quando true, emite também para a room do workspace inteiro. */
  workspace: z.boolean().optional(),
});

/** Shape do payload de relay transportado no Envelope. */
const relayPayloadSchema = z.object({
  event: z.enum(SERVER_TO_CLIENT_EVENTS),
  /** Room explícita (sobrepõe o roteamento por `target`). */
  room: z.string().optional(),
  target: relayTargetSchema.optional(),
  data: z.unknown(),
});

type RelayPayload = z.infer<typeof relayPayloadSchema>;

/** Resolve as rooms destino a partir do envelope + payload. */
function resolveRooms(payload: RelayPayload, workspaceId: string): string[] {
  if (payload.room) return [payload.room];

  const rooms = new Set<string>();
  const target = payload.target;
  if (target?.conversationId) rooms.add(`conversation:${target.conversationId}`);
  if (target?.memberId) rooms.add(`member:${target.memberId}`);
  if (target?.workspace) rooms.add(`ws:${workspaceId}`);

  // Sem alvo específico → workspace inteiro (default seguro).
  if (rooms.size === 0) rooms.add(`ws:${workspaceId}`);
  return [...rooms];
}

/**
 * Inicia o consumer do relay. Resolve quando o consumer está registrado.
 * Lança em falha de conexão — o caller (createSocketServer) trata sem derrubar
 * o boot.
 */
export async function startSocketRelay(io: IoServer): Promise<void> {
  const { channel } = await connectMq();
  await channel.assertQueue(RELAY_QUEUE, { durable: true });

  await consume(channel, RELAY_QUEUE, async (envelope) => {
    const payload = relayPayloadSchema.parse(envelope.payload);
    const event: ServerToClientEvent = payload.event;
    const rooms = resolveRooms(payload, envelope.workspaceId);

    // Invalida o cache versionado da ChatList ANTES de notificar o cliente, para
    // que o refetch disparado pelo evento já leia dados frescos (preview/ordem/
    // não-lidas), não o cache de 120s. Só para eventos que mudam a lista.
    if (LIST_AFFECTING_EVENTS.has(event)) {
      await bumpVersion(`hm:ws:v:${envelope.workspaceId}`);
    }

    // Quantos sockets há em cada sala destino (diagnóstico de entrega).
    const adapterRooms = io.of('/').adapter.rooms;
    const counts = rooms.map((r) => `${r}=${adapterRooms.get(r)?.size ?? 0}`);
    relayLog.info('relay emit', { event, rooms: counts });
    // io aceita evento arbitrário (DefaultEventsMap); o shape do `data` é o
    // contrato tipado de socket-events validado na publicação.
    io.to(rooms).emit(event, payload.data);
    await Promise.resolve();
  });
}

export { RELAY_QUEUE };
