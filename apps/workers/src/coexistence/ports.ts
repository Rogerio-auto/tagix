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
import type { InstagramEchoInput } from './instagram-echo';

/** Dados de um `message:new` emitido pela coexistência (espelha o inbound). */
export interface CoexistenceMessageNewEmit {
  readonly workspaceId: string;
  readonly conversationId: string;
  readonly messageId: string;
  readonly externalId: string;
  readonly type: string;
  readonly content: string | null;
  /** `outbound` para echoes (enviadas pelo app); histórico varia por `fromMe`. */
  readonly direction: 'inbound' | 'outbound';
  /**
   * Autoria (F70-S04): eco do app é resposta HUMANA (`member`) — o dono do número
   * respondeu pelo celular. Gravado igual na linha `messages`.
   */
  readonly senderType: 'contact' | 'member' | 'system';
}

/**
 * Porta de socket da coexistência: publica eventos no `hm.q.socket.relay`
 * (consumido por `apps/api/src/socket/relay.ts`), com `workspace: true` para que
 * a ChatList do workspace atualize ao vivo mesmo sem ninguém na sala da conversa.
 * Best-effort: falha de broker nunca derruba a persistência (já commitada).
 */
export interface CoexistenceSocketPort {
  /**
   * `message:new` para um echo (mensagem enviada pelo app WhatsApp Business) —
   * atividade ao vivo, empurra a bolha + atualiza a ChatList.
   */
  emitMessageNew(input: CoexistenceMessageNewEmit): Promise<void>;
  /**
   * `conversation:updated` para uma conversa afetada por import de HISTÓRICO. O
   * histórico é um backfill em lote de mensagens passadas: emitir N `message:new`
   * inundaria a thread e bagunçaria a ordenação (timestamps antigos). Em vez
   * disso, um único sinal por conversa faz a ChatList revalidar a projeção (last
   * message/contadores) sem floodar a thread aberta.
   */
  emitConversationUpdated(workspaceId: string, conversationId: string): Promise<void>;
  /**
   * `conversation:ai_mode_changed` quando um eco do app pausou a IA
   * (`human_takeover`) — mesmo evento que a rota de envio da API emite, para o
   * cockpit trocar o estado da IA ao vivo.
   */
  emitAiModeChanged(workspaceId: string, conversationId: string, aiMode: 'paused'): Promise<void>;
}

/** Resultado da materialização de um echo (observável em log/teste). */
export interface CoexistenceEchoResult {
  /** `false` quando nenhum canal casou o `phoneNumberId` (echo órfão). */
  readonly resolved: boolean;
  /** `true` quando uma nova mensagem outbound foi inserida (não-dedup). */
  readonly inserted: boolean;
  /** `true` quando este eco pausou a IA da conversa (`on` → `paused`). */
  readonly aiPaused: boolean;
  /**
   * `true` quando este eco ABRIU a conversa (o dono chamou primeiro: prospecção).
   * A conversa nasce com IA desligada e o contato ganha `origem:prospeccao`.
   */
  readonly startedByApp: boolean;
  /**
   * Motivo de descarte sem persistir, quando houver. `own_app`: eco de uma
   * mensagem que o próprio Leadium enviou pela API (não é resposta humana).
   */
  readonly skipped?: 'own_app';
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
   * Eco do Instagram (F70-S04): mesma semântica do eco do WhatsApp — mensagem
   * humana do dono da conta, pausa a IA, marca primeira resposta, prospecção.
   * Resolve o canal por `igUserId`. Idempotente por `externalId` (mid).
   */
  persistInstagramEcho(echo: InstagramEchoInput): Promise<CoexistenceEchoResult>;
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
