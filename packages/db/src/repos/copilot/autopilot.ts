/**
 * Piloto automático: regras por estágio e fila de sugestões (F73-S01; gerador na F73-S13).
 *
 * Uma sugestão PENDENTE por negócio (`uq_copilot_suggestions_pending_deal`): o gerador de hora em
 * hora usa `insertSuggestionIfAbsent`, que não duplica nem falha quando já existe uma.
 */
import { and, desc, eq, getTableColumns, inArray, sql } from 'drizzle-orm';
import type { DbTx } from '../../client';
import {
  copilotAutopilotRules,
  copilotSuggestions,
  type CopilotAutopilotCriteria,
  type CopilotAutopilotMode,
  type CopilotAutopilotRuleRow,
  type CopilotSuggestionConfidence,
  type CopilotSuggestionRow,
  type CopilotSuggestionStatus,
} from '../../schema/copilot';
import {
  beforeCursor,
  clampLimit,
  cursorTs,
  decodeCursor,
  toPage,
  type CopilotPage,
} from './cursor';

export const COPILOT_SUGGESTIONS_PAGE_MAX = 50;

async function listRules(
  tx: DbTx,
  input: { modes?: readonly CopilotAutopilotMode[] } = {},
): Promise<CopilotAutopilotRuleRow[]> {
  return tx
    .select()
    .from(copilotAutopilotRules)
    .where(
      and(
        sql`${copilotAutopilotRules.workspaceId} = app_current_workspace()`,
        input.modes && input.modes.length > 0
          ? inArray(copilotAutopilotRules.mode, [...input.modes])
          : undefined,
      ),
    )
    .orderBy(copilotAutopilotRules.stageId);
}

/**
 * Cria ou altera a regra do estágio. `enabled_by/enabled_at` registram quem LIGOU (sair de `off`)
 * e ficam estáveis enquanto a regra segue ligada; voltar a `off` os limpa.
 */
async function upsertRule(
  tx: DbTx,
  input: {
    workspaceId: string;
    stageId: string;
    mode: CopilotAutopilotMode;
    criteria: CopilotAutopilotCriteria;
    dailyLimit?: number;
    memberId: string;
  },
): Promise<CopilotAutopilotRuleRow> {
  const r = copilotAutopilotRules;
  const on = input.mode !== 'off';
  const [row] = await tx
    .insert(r)
    .values({
      workspaceId: input.workspaceId,
      stageId: input.stageId,
      mode: input.mode,
      criteria: input.criteria,
      dailyLimit: input.dailyLimit ?? 10,
      enabledBy: on ? input.memberId : null,
      enabledAt: on ? sql`now()` : null,
    })
    .onConflictDoUpdate({
      target: [r.workspaceId, r.stageId],
      set: {
        mode: input.mode,
        criteria: input.criteria,
        ...(input.dailyLimit !== undefined ? { dailyLimit: input.dailyLimit } : {}),
        enabledBy: on
          ? sql`case when ${r.mode} = 'off' then ${input.memberId}::uuid else ${r.enabledBy} end`
          : null,
        enabledAt: on ? sql`case when ${r.mode} = 'off' then now() else ${r.enabledAt} end` : null,
        updatedAt: sql`now()`,
      },
    })
    .returning();
  if (!row) throw new Error('copilot: regra não materializou.');
  return row;
}

export interface InsertCopilotSuggestionInput {
  workspaceId: string;
  dealId: string;
  fromStageId: string;
  toStageId: string;
  reasonCode: string;
  reasonText: string;
  confidence: CopilotSuggestionConfidence;
}

/** Insere a sugestão pendente; `null` se o negócio já tem uma pendente. */
async function insertSuggestionIfAbsent(
  tx: DbTx,
  input: InsertCopilotSuggestionInput,
): Promise<CopilotSuggestionRow | null> {
  const [row] = await tx
    .insert(copilotSuggestions)
    .values({ ...input, status: 'pending' })
    .onConflictDoNothing({
      target: copilotSuggestions.dealId,
      where: sql`${copilotSuggestions.status} = 'pending'`,
    })
    .returning();
  return row ?? null;
}

async function listSuggestions(
  tx: DbTx,
  input: { status: CopilotSuggestionStatus; cursor?: string | null; limit?: number },
): Promise<CopilotPage<CopilotSuggestionRow>> {
  const s = copilotSuggestions;
  const limit = clampLimit(input.limit, 20, COPILOT_SUGGESTIONS_PAGE_MAX);
  const cursor = input.cursor ? decodeCursor(input.cursor) : null;
  const rows = await tx
    .select({ ...getTableColumns(s), cursorTs: cursorTs(s.createdAt) })
    .from(s)
    .where(
      and(
        sql`${s.workspaceId} = app_current_workspace()`,
        eq(s.status, input.status),
        cursor ? beforeCursor(s.createdAt, s.id, cursor) : undefined,
      ),
    )
    .orderBy(desc(s.createdAt), desc(s.id))
    .limit(limit + 1);
  return toPage(rows, limit);
}

/**
 * Decide sugestões PENDENTES (as já decididas/expiradas são ignoradas: decisão é única).
 * Devolve só as que esta chamada decidiu.
 */
async function decideSuggestions(
  tx: DbTx,
  input: { ids: readonly string[]; decision: 'approve' | 'reject'; memberId: string },
): Promise<CopilotSuggestionRow[]> {
  if (input.ids.length === 0) return [];
  return tx
    .update(copilotSuggestions)
    .set({
      status: input.decision === 'approve' ? 'approved' : 'rejected',
      decidedBy: input.memberId,
      decidedAt: sql`now()`,
    })
    .where(
      and(inArray(copilotSuggestions.id, [...input.ids]), eq(copilotSuggestions.status, 'pending')),
    )
    .returning();
}

/** Liga a sugestão aprovada à proposta criada pelo motor (F73-S13). */
async function linkSuggestionProposal(
  tx: DbTx,
  input: { id: string; proposalId: string },
): Promise<boolean> {
  const rows = await tx
    .update(copilotSuggestions)
    .set({ proposalId: input.proposalId })
    .where(eq(copilotSuggestions.id, input.id))
    .returning({ id: copilotSuggestions.id });
  return rows.length > 0;
}

/**
 * Tira da fila a sugestão pendente de um negócio que saiu do estágio (`superseded`) ou voltou a
 * conversar (`expired`, padrão). Devolve quantas mudaram.
 */
async function expireSuggestionsForDeal(
  tx: DbTx,
  input: { dealId: string; status?: Extract<CopilotSuggestionStatus, 'expired' | 'superseded'> },
): Promise<number> {
  const rows = await tx
    .update(copilotSuggestions)
    .set({ status: input.status ?? 'expired' })
    .where(and(eq(copilotSuggestions.dealId, input.dealId), eq(copilotSuggestions.status, 'pending')))
    .returning({ id: copilotSuggestions.id });
  return rows.length;
}

export const copilotAutopilotRepo = {
  listRules,
  upsertRule,
  insertSuggestionIfAbsent,
  listSuggestions,
  decideSuggestions,
  linkSuggestionProposal,
  expireSuggestionsForDeal,
} as const;
