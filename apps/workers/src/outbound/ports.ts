/**
 * Portas (dependency inversion) do worker outbound.
 *
 * O worker não conhece DB nem Socket.io diretamente — `@hm/workers` só depende
 * de `@hm/channels`, `@hm/shared`, `@hm/storage` e `@hm/logger`. Persistência e
 * emissão de socket saem por **MQ** (publish no exchange de eventos / fila de
 * relay), mantendo o worker desacoplado e dentro da fronteira de arquivos do
 * slot. Cada porta é injetável para teste.
 */
import type { Channel, IChannelAdapter, SendResult } from '@hm/channels';
import type { ViewStatus } from '@hm/shared';
import type { OutboundJob } from './job';

/**
 * Resolve o snapshot do canal (credencial descifrada) + o adapter pronto para
 * o `provider`. Implementação real consulta `channels` no DB e instancia o
 * adapter via `@hm/channels` (fora deste slot — injetado na composição).
 */
export interface ChannelResolver {
  resolve(channelId: string, workspaceId: string): Promise<ResolvedChannel>;
}

export interface ResolvedChannel {
  readonly channel: Channel;
  readonly adapter: IChannelAdapter;
}

/** Resultado da persistência do estado de envio de uma mensagem. */
export interface PersistOutboundInput {
  readonly workspaceId: string;
  readonly conversationId: string;
  readonly messageId: string;
  readonly status: ViewStatus;
  /** `externalId` do provider quando o envio teve sucesso. */
  readonly externalId?: string;
  readonly errorCode?: string;
  readonly errorMessage?: string;
  readonly job: OutboundJob;
}

/**
 * Porta de persistência. A implementação publica num barramento (ou escreve no
 * DB através de um consumer dedicado) o novo `view_status` da mensagem e o
 * `external_id`, além de atualizar `conversation.last_*`.
 */
export interface OutboundPersistencePort {
  persist(input: PersistOutboundInput): Promise<void>;
}

/** Payload de emissão de socket (mapeia `message:status_changed`). */
export interface StatusEmitInput {
  readonly workspaceId: string;
  readonly conversationId: string;
  readonly messageId: string;
  readonly status: ViewStatus;
}

/**
 * Payload de emissão de `message:new` para uma mensagem outbound recém-enviada.
 * Mapeia o contrato `MessageNewPayload` (`{ workspaceId, conversationId, message }`).
 */
export interface MessageNewEmitInput {
  readonly workspaceId: string;
  readonly conversationId: string;
  readonly messageId: string;
  readonly type: string;
  readonly content: string | null;
}

/**
 * Porta de emissão de socket. A implementação publica no `hm.q.socket.relay`
 * (vide `apps/api/src/socket/relay.ts`), que reemite via Socket.io para a room
 * `conversation:{id}` (e `ws:{workspaceId}` quando `workspace: true`).
 */
export interface SocketEmitPort {
  emitStatusChanged(input: StatusEmitInput): Promise<void>;
  /**
   * Emite `message:new` (com `workspace: true`) quando uma mensagem outbound é
   * enviada. Fecha o gap de tempo-real do outbound: sem isto, a ChatList não
   * reordenava/atualizava o preview e a thread aberta não mostrava a mensagem do
   * operador/IA/sistema/flow ao vivo (só o inbound emitia). Paridade com o inbound.
   */
  emitMessageNew(input: MessageNewEmitInput): Promise<void>;
}

/** Dependências completas do worker outbound. */
export interface OutboundDeps {
  readonly channels: ChannelResolver;
  readonly persistence: OutboundPersistencePort;
  readonly socket: SocketEmitPort;
}

export type { SendResult };
