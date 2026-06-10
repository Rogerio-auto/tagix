/**
 * Portas (dependency inversion) do worker inbound (F1-S04, LIVECHAT.md §1/§3).
 *
 * Mesma filosofia do worker outbound (F1-S07): `@hm/workers` só depende de
 * `@hm/{channels,shared,storage,logger}` — **nunca** de `@hm/db` nem do
 * Socket.io. Tudo que toca DB ou socket sai por **MQ** (publish no exchange de
 * eventos / fila de relay), atrás de portas injetáveis e testáveis.
 *
 * Fronteira de responsabilidade (importante):
 *
 * - O **worker inbound** (este slot) faz a parte que NÃO precisa de DB:
 *   parse por provider → normaliza `InboundEvent[]` → extrai dicas de
 *   roteamento (phone_number_id / igUserId / session) → enfileira mídia (a
 *   `MediaRef` vem do raw, sem DB) → publica **um** evento
 *   `inbound.persist.requested` com tudo que o consumer DB-owner precisa.
 *
 * - O **consumer DB-owner** (downstream, fora deste slot — ver relatório do
 *   slot) aplica o trecho DB-bound do pipeline de forma atômica dentro do
 *   tenant (RLS): resolve channel→workspace, dedup, ensure contact, ensure
 *   conversation, persist message, update `last_message`, bump cache version e
 *   — porque depende dos UUIDs pós-persist — emite `message:new` e dispara
 *   agent/flow quando `ai_mode='on'`.
 *
 * Esse split é necessário: `conversationId`/`messageId` (UUIDs) só existem após
 * o upsert no DB, então o socket `message:new` e o gatilho de agent/flow não
 * podem sair do worker (que não fala com o DB).
 */
import type { ChannelProvider } from '@hm/shared';
import type { InboundEvent, MediaRef } from '@hm/channels';

/**
 * Porta de parsing por provider. A impl. default roteia para os parsers de
 * `@hm/channels` (WA/WAHA) e loga-warn para IG (placeholder F1.5). Injetável
 * para teste sem acoplar ao pacote de canais.
 */
export interface InboundParserPort {
  parse(provider: ChannelProvider, raw: unknown): InboundEvent[];
}

/**
 * Dicas de roteamento extraídas do raw — o consumer DB-owner mapeia para
 * channel/workspace. Cada provider expõe um identificador estável do canal de
 * destino dentro do próprio payload (a borda do webhook não resolve isso).
 */
export interface RoutingHints {
  /** WhatsApp Cloud: `entry[].changes[].value.metadata.phone_number_id`. */
  readonly phoneNumberId?: string;
  /** Instagram: `entry[].id` (ig user id do destino). */
  readonly igUserId?: string;
  /** WAHA: `session` (a sessão mapeia 1:1 para um canal WAHA). */
  readonly wahaSession?: string;
}

/**
 * Mídia a baixar. `conversationId`/`messageId` ainda não existem aqui (são
 * resolvidos pelo DB-owner), então a correlação é por `externalId` da mensagem
 * + provider + canal (via routing hints). O media-worker baixa do provider,
 * sobe pro storage e o DB-owner casa a URL pela `externalId`.
 */
export interface InboundMediaJob {
  readonly provider: ChannelProvider;
  /** `externalId` da mensagem que carrega a mídia (chave de correlação). */
  readonly externalId: string;
  /** Ref opaca do provider (media_id WA) ou URL temporária (WAHA/IG). */
  readonly mediaRef: MediaRef;
  readonly routing: RoutingHints;
}

/**
 * Requisição de persistência do pipeline inbound. Carrega os eventos
 * normalizados + dicas de roteamento; o DB-owner aplica dedup/contact/
 * conversation/persist/last/cache + socket + agent/flow.
 */
export interface PersistInboundRequest {
  readonly provider: ChannelProvider;
  readonly routing: RoutingHints;
  readonly events: readonly InboundEvent[];
}

/** Porta de enfileiramento de mídia (publica em `hm.q.inbound.media`). */
export interface MediaEnqueuePort {
  enqueue(job: InboundMediaJob): Promise<void>;
}

/**
 * Porta de persistência do pipeline inbound. A impl. publica
 * `inbound.persist.requested` no exchange de eventos; o consumer DB-owner
 * aplica a mutação dentro do tenant (RLS).
 */
export interface InboundPersistencePort {
  persist(request: PersistInboundRequest): Promise<void>;
}

/** Dependências completas do worker inbound. */
export interface InboundDeps {
  readonly parser: InboundParserPort;
  readonly persistence: InboundPersistencePort;
  readonly media: MediaEnqueuePort;
}
