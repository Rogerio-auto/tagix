/**
 * Portas (dependency inversion) do worker inbound (F1-S04 → refatorado em
 * F1-S26, LIVECHAT.md §1/§3, ARCHITECTURE.md §4.2).
 *
 * **Mudança de arquitetura (F1-S26).** Por ADR (ARCHITECTURE.md §4.2) o worker
 * inbound AGORA é dono da persistência: `@hm/db` é dep de `@hm/workers` e a
 * indireção fantasma `publish inbound.persist.requested → consumer DB-owner` foi
 * REMOVIDA. O pipeline inbound persiste **in-process**, igual ao worker de mídia
 * (F1-S10): resolve channel→workspace pelas routing hints (`getDb()` cross-tenant)
 * e, dentro de `withWorkspace(workspaceId, …)` (RLS), aplica
 * dedup→contact→conversation→message→last_message→cache e emite `message:new`.
 *
 * Mesmo assim, **todo IO fica atrás de portas pequenas e injetáveis**: o pipeline
 * é testável sem RabbitMQ/DB/HTTP (os testes injetam um `InboundPersistencePort`
 * fake). Os adapters default (ver `db-ports.ts`) usam `@hm/db`.
 *
 * Fronteira de responsabilidade (importante):
 *
 * - O **worker inbound** faz parse por provider → normaliza `InboundEvent[]` →
 *   extrai dicas de roteamento (phone_number_id / igUserId / session) → enfileira
 *   mídia (a `MediaRef` vem do raw, sem DB) → **persiste** (in-process, RLS) →
 *   emite `message:new` + (ai_mode='on') enfileira agent/flow.
 *
 * `conversationId`/`messageId` (UUIDs) só existem após o upsert: por isso o
 * socket `message:new` e o gatilho de agent/flow saem de DENTRO da persistência
 * (que conhece os UUIDs), não do pipeline estrutural.
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
 * Estratégia de distribuição do time-alvo (espelha `teams.auto_assign_strategy`,
 * LIVECHAT_OPS.md §4). `manual` → conversa entra na fila sem owner.
 */
export type AutoAssignStrategy = 'round_robin' | 'least_busy' | 'manual';

/** Estratégia automática (exclui `manual`) — a única que dispara o picker. */
export type AutoAssignAutomatic = Exclude<AutoAssignStrategy, 'manual'>;

/** Entrada do picker de auto-assign (F30-S09): time-alvo + estratégia automática. */
export interface AutoAssignPick {
  readonly teamId: string;
  readonly strategy: AutoAssignAutomatic;
}

/**
 * Porta de seleção do atendente no auto-assign do inbound (F30-S09 / LIVECHAT_OPS
 * §4). Devolve o `member_id` escolhido (round_robin/least_busy) ou `null` quando o
 * time não tem candidato ativo. A escolha em si mora no `@hm/db` (S01,
 * `pickAutoAssignee`) para manter o SQL de rodízio/carga no repo; a impl. default
 * (`db-ports.ts`) espelha essa query. Injetável para teste sem DB.
 */
export interface InboundAutoAssignPort {
  pick(input: AutoAssignPick): Promise<string | null>;
}

/** Contadores observáveis do que a persistência aplicou (log/teste/métrica). */
export interface PersistInboundResult {
  /** Mensagens efetivamente inseridas (exclui as deduplicadas). */
  readonly inserted: number;
  /** Mensagens puladas por já existirem (`uq_messages_external`). */
  readonly deduped: number;
  /** Eventos de status (delivery/read acks) processados. */
  readonly statuses: number;
  /** `false` quando nenhum canal casou as routing hints (mensagem órfã). */
  readonly resolved: boolean;
}

/**
 * Porta de persistência do pipeline inbound (F1-S26). A impl. default
 * (`DbInboundPersistence`) resolve channel→workspace pelas routing hints e, sob
 * `withWorkspace` (RLS), aplica dedup→contact→conversation→message→last_message
 * →cache, emite `message:new` e dispara status (S20)/presença (S21)/flow.
 */
export interface InboundPersistencePort {
  persist(request: PersistInboundRequest): Promise<PersistInboundResult>;
}

/** Dependências completas do worker inbound. */
export interface InboundDeps {
  readonly parser: InboundParserPort;
  readonly persistence: InboundPersistencePort;
  readonly media: MediaEnqueuePort;
}
