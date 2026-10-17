/**
 * Executor de capacidade de escrita (ADR-004 §1, §3, §4; F73-S05).
 *
 * O motor de propostas (`services/copilot/proposals`) é genérico: não sabe o que é um negócio,
 * uma tag ou uma campanha. Cada capacidade de escrita do catálogo (`CAPABILITIES`) registra UM
 * executor (F73-S08 em `act-crm`, F73-S09 em `act-external`), e o motor faz o resto: classifica,
 * autoriza, persiste, confirma, executa item a item, para, desfaz e audita.
 *
 * Contrato que o executor promete:
 * - `resolveTargets` re-resolve TODO id sob o escopo do principal (ADR-003 §4). O que ele não vê
 *   volta em `dropped` como `not_found` (nunca "sem permissão": sem oráculo). Lê o estado atual
 *   e devolve `expectedVersion` (ex.: `updated_at` + `stage_id`).
 * - `preview` é só leitura. Diz se a ação é externa, irreversível ou avisa membros: são essas
 *   flags, e não o modelo, que alimentam `classifyRisk`.
 * - `executeItem` roda num savepoint próprio, dentro da transação RLS do item. ANTES de escrever,
 *   confere `expectedVersion` contra o estado atual; se mudou, devolve `skipped_conflict` com
 *   `conflictBy` (nome do membro que editou). Erro de regra de domínio vira `failed` com
 *   `errorCode`. Lançar também vira `failed` (o savepoint é desfeito). Reusa os services de
 *   domínio com `actor = { type: 'member', memberId: ctx.principal.memberId }` e
 *   `metadata = { via: ctx.source, proposal_id: ctx.proposalId }`.
 * - `undoItem` confere que o estado atual ainda é `item.after`; se não for, `undo_conflict`.
 * - `resolveIds` re-resolve alvos JÁ conhecidos (os itens da proposta) sob OUTRO principal, com
 *   o mesmo escopo fino do `resolveTargets`: é como o motor descobre o que o APROVADOR enxerga
 *   (ADR-003 §4 e §7). Quem ele não vê volta em `dropped`.
 * - Efeito externo à transação (socket, fila, e-mail) NUNCA sai direto do executor: registre com
 *   `ctx.afterCommit(fn)`. O motor só roda a fila depois do commit da transação do item (ou da
 *   transação do callback, no nível 2); se a transação desfizer, a fila é descartada.
 * - Teto de duração: `executeItem`/`undoItem` devem terminar em até `EXECUTOR_ITEM_MAX_MS`
 *   (30 s). O lease do lote é de 120 s e é renovado a cada item; um item mais lento do que o
 *   lease deixaria a varredura considerar a proposta parada. A exclusão mútua continua garantida
 *   pelo lock da linha da proposta (`FOR UPDATE` no início do item), mas a retomada esperaria.
 *   Trabalho longo (envio em massa) vai para a fila do domínio, e o item só a enfileira.
 * - `summary` da prévia NÃO leva nome, telefone nem e-mail de CONTATO: ele vai para a
 *   Atividade, para o CSV e para a trilha. Use contagens, nomes de estágio, de campanha e de
 *   membros ("Mover 7 negócios de Orçamento enviado para Reativação"). O `label` do alvo só
 *   aparece na prévia de quem já vê o registro (sem telefone nem e-mail).
 *
 * Os métodos usam a sintaxe de MÉTODO de propósito: o registro heterogêneo
 * (`readonly CapabilityExecutor[]`) aceita executores de `Args` diferentes sem `any` nem cast;
 * o motor só chama cada executor com a saída do `argsSchema` dele mesmo.
 */
import type { z } from 'zod';
import type { CopilotActionTargetType, CopilotProposalSource, DbTx } from '@hm/db';
import type {
  CapabilityKey,
  Permission,
  PolicyCheck,
  ProposalAdjustParams,
  ProposalImpact,
  ProposalPreview,
} from '@hm/shared';
import type { CopilotPrincipal } from '../../../services/copilot/identity/principal';

/** Objeto JSON (o que vai para `jsonb`). */
export type Json = Record<string, unknown>;

/**
 * Teto de duração de UM `executeItem`/`undoItem` (contrato; ver o cabeçalho). Bem abaixo do
 * lease de 120 s (`COPILOT_PROPOSAL_LEASE_SECONDS`).
 */
export const EXECUTOR_ITEM_MAX_MS = 30_000;

/** Efeito a rodar DEPOIS do commit (socket, fila). Erro vira log; nunca desfaz nada. */
export type AfterCommitFn = () => void | Promise<void>;

/** Contexto de toda chamada a um executor. Tudo aqui já foi autorizado pelo motor. */
export interface ExecutorContext {
  /** Transação RLS do workspace (no `executeItem`/`undoItem`, um savepoint do item). */
  readonly tx: DbTx;
  /** Membro cujas permissões são usadas (o aprovador, no fluxo de aprovação). */
  readonly principal: CopilotPrincipal;
  /** Quem pediu (igual ao principal, salvo aprovação). */
  readonly requestedByMemberId: string;
  /** Proposta em execução; `null` durante a resolução e a prévia de uma proposta nova. */
  readonly proposalId: string | null;
  /** `copilot` ou `autopilot`: vai em `metadata.via` das escritas de domínio. */
  readonly source: CopilotProposalSource;
  readonly now: Date;
  /**
   * Agenda `fn` para depois do commit da transação que contém esta escrita. Só existe sentido
   * em `executeItem`/`undoItem`; nas fases de leitura (resolver, prévia, política) LANÇA, porque
   * leitura não tem efeito para publicar. Se o item lançar (savepoint desfeito), o que ele
   * agendou é descartado.
   */
  afterCommit(fn: AfterCommitFn): void;
}

/** Referência a um alvo já conhecido (item de uma proposta). */
export interface TargetRef {
  readonly type: CopilotActionTargetType;
  readonly id: string;
}

/** Alvo resolvido sob o escopo do principal, com o estado lido agora. */
export interface Target {
  readonly type: CopilotActionTargetType;
  readonly id: string;
  /** Rótulo legível ("Maria Souza · Alinhadores"). Sem telefone nem e-mail. ≤ 200. */
  readonly label: string;
  /** Versão do alvo na leitura (ex.: `2026-10-16T09:14:00.000Z|<stage_id>`). */
  readonly expectedVersion: string | null;
  /** Estado lido (o `before` do item). */
  readonly state: Json;
}

export interface ResolvedTargets {
  readonly targets: Target[];
  readonly dropped: { readonly id: string; readonly reason: 'not_found' }[];
}

/** Linha da prévia de um alvo. */
export interface PreviewItem {
  /** `Target.id` a que esta linha se refere. */
  readonly targetId: string;
  /** Antes e depois legíveis ("Orçamento enviado" → "Reativação"). ≤ 200. */
  readonly before: string | null;
  readonly after: string | null;
  /** Estado planejado depois da escrita (o executor confere no `undoItem`). */
  readonly plannedAfter?: Json | null;
}

export interface ExecutorPreview {
  readonly items: PreviewItem[];
  readonly impact: ProposalImpact;
  /** Fala com quem está fora da empresa (mensagem, automação de estágio que envia) → nível 4. */
  readonly external: boolean;
  /** Não tem volta → nível 4. */
  readonly irreversible: boolean;
  /** Avisa membros da equipe → nível ≥ 3. */
  readonly notifiesMembers: boolean;
  /**
   * Uma frase ("Mover 7 negócios de Orçamento enviado para Reativação"). ≤ 500.
   * PROIBIDO citar contato (nome, telefone, e-mail): vai para a Atividade, o CSV e a trilha.
   */
  readonly summary: string;
  /** Resumo agrupado; ausente = o motor agrupa os itens por (antes, depois). */
  readonly beforeAfter?: ProposalPreview['before_after'];
  readonly messagePreview?: ProposalPreview['message_preview'];
  readonly alternatives?: ProposalPreview['alternatives'];
}

/** Item como o executor o recebe para executar. */
export interface ExecutableItem {
  readonly id: string;
  readonly targetType: CopilotActionTargetType;
  readonly targetId: string;
  readonly label: string;
  readonly expectedVersion: string | null;
  /** Estado lido na prévia. */
  readonly before: Json | null;
  /** Estado planejado na prévia. */
  readonly plannedAfter: Json | null;
}

export type ExecuteItemStatus = 'done' | 'skipped_conflict' | 'skipped_policy' | 'failed';

export interface ExecuteItemResult {
  readonly status: ExecuteItemStatus;
  /** Estado real depois da escrita (o `undoItem` confere contra ele). */
  readonly after?: Json;
  /** O que o `undoItem` precisa para voltar (estágio de origem, tags anteriores…). */
  readonly undoPayload?: Json;
  /** Código estável (`transition_rule`, `consent_missing`…). Sem PII. */
  readonly errorCode?: string;
  /** Conflito: nome do membro que editou por último ("Paula"). */
  readonly conflictBy?: string;
}

/** Item como o executor o recebe para desfazer. */
export interface UndoableItem {
  readonly id: string;
  readonly targetType: CopilotActionTargetType;
  readonly targetId: string;
  readonly label: string;
  readonly expectedVersion: string | null;
  readonly before: Json | null;
  /** Estado gravado depois da execução: o desfazer só age se o atual ainda for este. */
  readonly after: Json | null;
  readonly undoPayload: Json | null;
}

export interface UndoItemResult {
  readonly status: 'undone' | 'undo_conflict' | 'failed';
  readonly errorCode?: string;
}

/** Parâmetros que a interface pode trocar no "Ajustar" (ADR-004 §2). */
export type AdjustableParam = keyof ProposalAdjustParams;

export interface CapabilityExecutor<Args = unknown> {
  /** Capacidade de escrita do catálogo (`CAPABILITIES`) que este executor implementa. */
  readonly capability: CapabilityKey;
  /**
   * Schema canônico dos `args` (`z.object(...).strict()`, sem campo de identidade). É o mesmo
   * que a ferramenta `propose_<capability>` expõe ao modelo (`makeProposeTool`) e o que o motor
   * usa para reler `copilot_action_proposals.args` antes de executar, ajustar e repetir.
   */
  readonly argsSchema: z.ZodType<Args, z.ZodTypeDef, unknown>;
  /** Parâmetros ajustáveis na prévia. Ausente = só excluir itens. */
  readonly adjustableParams?: readonly AdjustableParam[];
  /**
   * Permissões de ENTIDADE além da permissão da capacidade (ex.: `pipeline.view` para mover
   * negócios). O motor as passa em TODA autorização (propor, confirmar, aprovar, desfazer,
   * executar) e o callback as confere antes do handler; a ferramenta `propose_*` herda daqui.
   */
  readonly requires?: readonly Permission[];

  resolveTargets(ctx: ExecutorContext, args: Args): Promise<ResolvedTargets>;
  /**
   * Re-resolve alvos já conhecidos sob `ctx.principal` (o aprovador, no confirmar de uma
   * aprovação; os candidatos, em `listApprovers`). Mesmo escopo fino do `resolveTargets`; lê o
   * estado atual. Só leitura.
   */
  resolveIds(ctx: ExecutorContext, targets: readonly TargetRef[]): Promise<ResolvedTargets>;
  preview(ctx: ExecutorContext, args: Args, targets: readonly Target[]): Promise<ExecutorPreview>;
  /** Nível 4: janela, consentimento, sessão de 24 h, progresso de campanha (ADR-004 §5). */
  policyCheck?(
    ctx: ExecutorContext,
    args: Args,
    targets: readonly Target[],
  ): Promise<PolicyCheck[]>;
  /** Aplica os parâmetros ajustados; o resultado passa de novo pelo `argsSchema`. */
  applyAdjustments?(args: Args, params: ProposalAdjustParams): Args;
  executeItem(ctx: ExecutorContext, args: Args, item: ExecutableItem): Promise<ExecuteItemResult>;
  undoItem?(ctx: ExecutorContext, item: UndoableItem): Promise<UndoItemResult>;
  /**
   * Nível 4 não tem desfazer, salvo quando o executor declara (envio AGENDADO, cancelável até
   * sair). Só é consultado no nível 4; nos níveis 2 e 3 vale o catálogo (`undoable`).
   */
  allowsUndoAtLevel4?(args: Args): boolean;
}
