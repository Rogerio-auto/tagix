/**
 * Registry de dispatch das tools de negócio (callback Python → Node).
 *
 * Cada `toolKey` mapeia para um `ToolHandler` que recebe o envelope já validado
 * + a transação RLS-escopada (`withWorkspace`) e devolve um `ToolHandlerResult`.
 * As tools concretas (F2-S20: `transfer_to_human`, `register_conversion`, …)
 * registram seus handlers aqui via `registerToolHandler`.
 *
 * Esta camada (F2-S07) entrega só o transporte + o esqueleto de dispatch e um
 * handler trivial embutido (`ping`) para testes de ponta-a-ponta do canal.
 */
import type { DbTx } from '@hm/db';
import type { DomainEventDraft } from '@hm/shared/mq';

/** Envelope validado que chega do runtime (vide `schema.ts`). */
export interface ToolCallEnvelope {
  readonly workspaceId: string;
  readonly conversationId: string | null;
  readonly agentId: string;
  readonly executionId: string;
  readonly args: Record<string, unknown>;
}

/** Resultado normalizado de um handler de tool (vira o JSON de resposta). */
export interface ToolHandlerResult {
  readonly ok: boolean;
  /** String devolvida ao modelo como `tool` message. */
  readonly content?: string;
  /** Mensagem de erro segura (sem PII) — só quando `ok=false`. */
  readonly error?: string;
  /** Dado estruturado opcional. */
  readonly payload?: unknown;
  /** Resumo da ação para `tool_logs.action` (default: `'workflow'`). */
  readonly action?: string;
  /** Tabela tocada, se houver — para `tool_logs.table_name`. */
  readonly tableName?: string;
  /**
   * Eventos de domínio da ação (F70-S09). Declarados como DADO, não publicados pelo
   * handler: o router os grava na outbox (F70-S17) na MESMA transação do handler —
   * rollback nunca vira aviso para um sistema de fora, e o commit não perde o aviso.
   * Só saem se `ok`. O `workspaceId` de cada evento tem de ser o do envelope: a RLS
   * da outbox recusa outro, e a recusa desfaz a ação inteira (fail-closed).
   */
  readonly events?: readonly DomainEventDraft[];
}

/**
 * Contrato de um handler de tool de negócio. Roda DENTRO de `withWorkspace`
 * (RLS já escopada ao `envelope.workspaceId`) — use o `tx` para qualquer escrita.
 * Deve ser determinístico quanto a erros: lançar é permitido (o router captura),
 * mas prefira devolver `{ ok: false, error }` com mensagem estável.
 */
export type ToolHandler = (
  envelope: ToolCallEnvelope,
  tx: DbTx,
) => Promise<ToolHandlerResult>;

/**
 * Registro de handlers por `toolKey`. É um `Map` por instância de router (não um
 * singleton global) para manter os testes isolados e o boundary explícito.
 */
export class ToolHandlerRegistry {
  private readonly handlers = new Map<string, ToolHandler>();

  /** Registra (ou substitui) o handler de um `toolKey`. */
  register(toolKey: string, handler: ToolHandler): this {
    this.handlers.set(toolKey, handler);
    return this;
  }

  /** Resolve o handler de um `toolKey` (ou `undefined` se desconhecido). */
  resolve(toolKey: string): ToolHandler | undefined {
    return this.handlers.get(toolKey);
  }

  /** Lista os `toolKey` registrados (diagnóstico/testes). */
  keys(): readonly string[] {
    return [...this.handlers.keys()];
  }
}

/**
 * Handler embutido `ping`: ecoa os args. Não toca o DB. Existe para validar o
 * canal de transporte + auth + envelope ponta-a-ponta sem depender de F2-S20.
 * Desde a F70-S15 passa pela mesma barreira de habilitação das demais: sem linha
 * em `tools` habilitada para o agente, o router responde 403 (fail-closed).
 */
export const pingHandler: ToolHandler = async (envelope) => ({
  ok: true,
  content: 'pong',
  action: 'http',
  payload: { echo: envelope.args, executionId: envelope.executionId },
});

/** Cria um registry já com os handlers built-in deste slot. */
export function createDefaultRegistry(): ToolHandlerRegistry {
  return new ToolHandlerRegistry().register('ping', pingHandler);
}
