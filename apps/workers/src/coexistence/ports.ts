/**
 * Portas (dependency inversion) do worker de coexistência WhatsApp Business
 * (F39-S04). Espelha o desenho do worker inbound (`inbound/ports.ts`): todo IO
 * (DB) fica atrás de portas pequenas e injetáveis, então a orquestração é
 * testável sem RabbitMQ/DB (os testes injetam um `CoexistencePersistencePort`
 * fake).
 *
 * Entrada: eventos publicados em F39-S03 (`coexistence.echo` /
 * `coexistence.history` / `coexistence.app_state`), validados com os schemas Zod
 * de `@hm/shared/mq` (`topology.ts`). Saída: materialização no domínio
 * (conversas/mensagens/contatos/canal) via `@hm/db` + RLS — idempotente,
 * ancorada no id externo (`externalId`/`waId`).
 */
import type {
  CoexistenceAppStatePayload,
  CoexistenceEchoPayload,
  CoexistenceHistoryBatchPayload,
} from '@hm/shared/mq';

/** Resultado da materialização de um echo (observável em log/teste). */
export interface CoexistenceEchoResult {
  /** `false` quando nenhum canal casou o `phoneNumberId` (echo órfão). */
  readonly resolved: boolean;
  /** `true` quando uma nova mensagem outbound foi inserida (não-dedup). */
  readonly inserted: boolean;
}

/** Resultado da importação de um batch de histórico. */
export interface CoexistenceHistoryResult {
  readonly resolved: boolean;
  /** Contatos efetivamente inseridos (exclui os já existentes). */
  readonly contactsInserted: number;
  /** Mensagens efetivamente inseridas (exclui as deduplicadas). */
  readonly messagesInserted: number;
  /** Mensagens puladas por já existirem (`uq_messages_external`). */
  readonly messagesDeduped: number;
}

/** Resultado da sincronização de estado do número/sessão. */
export interface CoexistenceAppStateResult {
  readonly resolved: boolean;
}

/**
 * Porta de persistência do worker de coexistência (F39-S04). A impl. default
 * (`DbCoexistencePersistence`) resolve channel→workspace pelo `phoneNumberId` e,
 * sob `withWorkspace` (RLS), aplica os upserts idempotentes por id externo.
 */
export interface CoexistencePersistencePort {
  /**
   * Echo: mensagem enviada pelo número via app WhatsApp Business → vira mensagem
   * **outbound** no thread da conversa do contato (`to`). Idempotente por
   * `externalId` (reentrega não duplica).
   */
  persistEcho(payload: CoexistenceEchoPayload): Promise<CoexistenceEchoResult>;
  /**
   * History: batch de contatos/mensagens históricas de uma WABA. Upsert
   * idempotente de contatos (por `waId`) + mensagens (por `externalId`); rodar 2x
   * não duplica.
   */
  importHistory(payload: CoexistenceHistoryBatchPayload): Promise<CoexistenceHistoryResult>;
  /**
   * App_state: reflete o estado do número/sessão de coexistência no `channel`
   * correspondente (gravado em `channels.metadata.coexistence`, sem migração).
   */
  syncAppState(payload: CoexistenceAppStatePayload): Promise<CoexistenceAppStateResult>;
}

/** Dependências completas do worker de coexistência. */
export interface CoexistenceDeps {
  readonly persistence: CoexistencePersistencePort;
}
