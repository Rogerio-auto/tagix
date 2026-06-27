/**
 * Portas (dependency inversion) do worker de mídia (F1-S10).
 *
 * Diferença de arquitetura vs. inbound/outbound (F1-S04/S07): `@hm/workers`
 * AGORA depende de `@hm/db`. O UPDATE da linha de mídia é persistido
 * **diretamente** via `@hm/db` + `withWorkspace(workspaceId, …)` (RLS) — sem
 * indireção de "persist consumer" por MQ. Mesmo assim, todo IO (resolução de
 * canal, download, storage, persistência, socket) fica atrás de portas
 * pequenas e injetáveis: o pipeline é testável sem RabbitMQ/DB/HTTP, e os
 * adapters default (ver `adapters.ts`) usam @hm/db/@hm/storage/@hm/channels.
 */
import type { Buffer } from 'node:buffer';
import type { Channel, IChannelAdapter } from '@hm/channels';
import type { MediaJob, MediaJobRoutingHints } from './job';

/**
 * Estado do pipeline de download de mídia. Espelha o `media_status` enum de
 * `@hm/db` (F52-S01) — declarado aqui (não importado) para manter as portas do
 * worker desacopladas do Drizzle; a coluna aceita exatamente estes literais.
 */
export type MediaStatus = 'pending' | 'downloading' | 'ready' | 'failed';

/**
 * Canal resolvido a partir das `routing` hints do job: snapshot pronto para o
 * adapter (token descifrado) + o adapter do provider + o `workspaceId` do
 * tenant dono (para escopar a persistência sob RLS).
 */
export interface ResolvedMediaChannel {
  readonly channel: Channel;
  readonly adapter: IChannelAdapter;
  readonly workspaceId: string;
}

/**
 * Resolve canal → workspace a partir das routing hints (lookup cross-tenant
 * por `phone_number_id`/`ig_user_id`/`waha_session_id`). Retorna `null` quando
 * nenhum canal ativo casa (mensagem órfã — ack silencioso, sem reprocessar).
 */
export interface MediaChannelResolver {
  resolve(
    provider: MediaJob['provider'],
    routing: MediaJobRoutingHints,
  ): Promise<ResolvedMediaChannel | null>;
}

/** Objeto a subir no storage (R2/local) sob a key canônica. */
export interface MediaUploadInput {
  readonly key: string;
  readonly body: Buffer;
  readonly contentType: string;
}

/**
 * Storage de mídia. `objectExists` habilita o dedup: se o SHA-256 já tem objeto,
 * pulamos o re-upload. `publicUrl` deriva a URL servível (signed) da key.
 */
export interface MediaStoragePort {
  objectExists(key: string): Promise<boolean>;
  upload(input: MediaUploadInput): Promise<void>;
  publicUrl(key: string): Promise<string>;
}

/** Linha de mensagem localizada por `externalId` dentro do workspace (RLS). */
export interface MediaMessageTarget {
  readonly messageId: string;
  readonly conversationId: string;
  /** SHA-256 já persistido nesta mensagem (idempotência: skip se igual). */
  readonly existingSha256: string | null;
}

/** Campos `media_*` a gravar na mensagem. */
export interface MediaPersistInput {
  readonly workspaceId: string;
  readonly messageId: string;
  readonly mediaUrl: string;
  readonly mediaMime: string;
  readonly mediaSizeBytes: number;
  readonly mediaSha256: string;
  /** Key do objeto no storage (dedup global por conteúdo). */
  readonly mediaKey: string;
  /** Estado terminal do download a gravar junto (sucesso ⇒ `ready`). */
  readonly mediaStatus: MediaStatus;
}

/**
 * Persistência da mídia. `findMessage`/`findKeyBySha256` rodam dentro do tenant
 * (RLS via `withWorkspace`). `update` grava `messages.media_*`; `markStatus`
 * transita só a coluna `media_status` (estados `downloading`/`failed`).
 */
export interface MediaPersistencePort {
  /** Localiza a mensagem-alvo pela `externalId` dentro do workspace. */
  findMessage(workspaceId: string, externalId: string): Promise<MediaMessageTarget | null>;
  /** Key já subida para este SHA-256 no workspace (dedup) — ou `null`. */
  findKeyBySha256(workspaceId: string, sha256: string): Promise<string | null>;
  /** Atualiza `messages.media_*` (inclui `media_status`). */
  update(input: MediaPersistInput): Promise<void>;
  /** Transita apenas `messages.media_status` (in-flight `downloading` / `failed`). */
  markStatus(workspaceId: string, messageId: string, status: MediaStatus): Promise<void>;
}

/** Emissão do socket `message:media_ready` (room `conversation:{id}`). */
export interface MediaReadyEmit {
  readonly workspaceId: string;
  readonly conversationId: string;
  readonly messageId: string;
  readonly mediaUrl: string;
}

/** Emissão do socket `message:media_failed` (download esgotou retries). */
export interface MediaFailedEmit {
  readonly workspaceId: string;
  readonly conversationId: string;
  readonly messageId: string;
  readonly reason: string;
}

/** Porta de socket: publica no `hm.q.socket.relay` (consumido por `relay.ts`). */
export interface MediaSocketPort {
  emitMediaReady(input: MediaReadyEmit): Promise<void>;
  emitMediaFailed(input: MediaFailedEmit): Promise<void>;
}

/**
 * Política de retry do download (in-process). Cada tentativa re-invoca
 * `adapter.downloadMedia(refOrUrl, …)` — que, quando `refOrUrl` é um `media_id`
 * (WhatsApp), re-resolve uma URL temporária fresca via Graph a cada chamada;
 * logo, *retentar é re-resolver*. `sleep` é injetável para testes determinísticos.
 */
export interface MediaRetryConfig {
  /** Tentativas totais de download (incl. a primeira). */
  readonly maxAttempts: number;
  /** Backoff (ms) ANTES de cada retry — `backoffMs[i]` aplica-se ao retry `i+1`. */
  readonly backoffMs: readonly number[];
  /** Espera entre tentativas (injetável; default `setTimeout`). */
  readonly sleep: (ms: number) => Promise<void>;
}

/**
 * Política default: 3 tentativas (1 + 2 retries) com backoff curto. O retry curto
 * cobre blips de rede e a re-resolução de URL expirada; falhas de infra que
 * persistem além desta janela são re-lançadas e tratadas pela malha DLX/retry de
 * `@hm/shared/mq` (F52-S03) — não reimplementamos a escada longa aqui.
 */
export const defaultMediaRetry: MediaRetryConfig = {
  maxAttempts: 3,
  backoffMs: [2_000, 8_000],
  sleep: (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms)),
};

/** Dependências completas do worker de mídia. */
export interface MediaDeps {
  readonly channels: MediaChannelResolver;
  readonly storage: MediaStoragePort;
  readonly persistence: MediaPersistencePort;
  readonly socket: MediaSocketPort;
  /** Override da política de retry de download (default {@link defaultMediaRetry}). */
  readonly retry?: MediaRetryConfig;
}
