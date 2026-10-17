/**
 * Memória do negócio (F73-S01; regras de produto na F73-S11).
 *
 * Nada é apagado: corrigir e trocar o perfil marcam a linha antiga `superseded` (com
 * `supersedes_id` na nova), esquecer marca `forgotten`. A trilha "de onde veio" fica completa.
 *
 * Perfil: um ativo por chave (`uq_copilot_memory_active_profile`). `upsertProfile` serializa por
 * (workspace, chave) com advisory lock da transação, então duas gravações paralelas da mesma
 * chave terminam com a segunda superando a primeira — nunca com 23505.
 */
import { and, asc, desc, eq, getTableColumns, inArray, sql } from 'drizzle-orm';
import type { DbTx } from '../../client';
import {
  copilotMemoryEntries,
  type CopilotJsonObject,
  type CopilotMemoryEntryRow,
  type CopilotMemoryProfileKey,
  type CopilotMemorySourceType,
  type CopilotMemoryStatus,
} from '../../schema/copilot';
import {
  beforeCursor,
  clampLimit,
  cursorTs,
  decodeCursor,
  toPage,
  type CopilotPage,
} from './cursor';

/** Teto de fatos no prompt (spec §5.4). */
export const COPILOT_PROMPT_FACTS_MAX = 30;
/** Teto de caracteres somados dos fatos no prompt. */
export const COPILOT_PROMPT_FACTS_CHARS_MAX = 2500;
export const COPILOT_FACTS_PAGE_MAX = 50;

export interface CopilotPromptMemory {
  readonly profile: { key: CopilotMemoryProfileKey; content: string }[];
  readonly facts: {
    id: string;
    content: string;
    sourceType: CopilotMemorySourceType;
    sourceLabel: string;
  }[];
}

/**
 * Memória para o prompt: o perfil ativo completo + fatos ativos, os de PESSOA primeiro, depois
 * os do Copiloto e os das integrações, cada grupo do mais recente para o mais antigo; para no
 * 30º fato ou antes do fato que estouraria 2.500 caracteres somados (o orçamento é dos fatos; o
 * perfil, ≤ 5 × 500, vai sempre inteiro).
 */
async function listActiveForPrompt(tx: DbTx, workspaceId: string): Promise<CopilotPromptMemory> {
  const m = copilotMemoryEntries;
  const profileRows = await tx
    .select({ key: m.profileKey, content: m.content })
    .from(m)
    .where(and(eq(m.workspaceId, workspaceId), eq(m.kind, 'profile'), eq(m.status, 'active')))
    .orderBy(asc(m.profileKey));
  const factRows = await tx
    .select({
      id: m.id,
      content: m.content,
      sourceType: m.sourceType,
      sourceLabel: m.sourceLabel,
    })
    .from(m)
    .where(and(eq(m.workspaceId, workspaceId), eq(m.kind, 'fact'), eq(m.status, 'active')))
    .orderBy(
      sql`case ${m.sourceType} when 'member' then 0 when 'copilot' then 1 else 2 end`,
      desc(m.updatedAt),
      desc(m.id),
    )
    .limit(COPILOT_PROMPT_FACTS_MAX);

  const facts: CopilotPromptMemory['facts'] = [];
  let used = 0;
  for (const f of factRows) {
    used += f.content.length;
    if (used > COPILOT_PROMPT_FACTS_CHARS_MAX) break;
    facts.push(f);
  }
  const profile: CopilotPromptMemory['profile'] = [];
  for (const p of profileRows) {
    if (p.key !== null) profile.push({ key: p.key, content: p.content });
  }
  return { profile, facts };
}

/** Fatos (não o perfil), mais recentes primeiro. Padrão: ativos e esquecidos (para restaurar). */
async function listFacts(
  tx: DbTx,
  input: {
    cursor?: string | null;
    limit?: number;
    statuses?: readonly CopilotMemoryStatus[];
  } = {},
): Promise<CopilotPage<CopilotMemoryEntryRow>> {
  const m = copilotMemoryEntries;
  const limit = clampLimit(input.limit, 20, COPILOT_FACTS_PAGE_MAX);
  const cursor = input.cursor ? decodeCursor(input.cursor) : null;
  const statuses: readonly CopilotMemoryStatus[] =
    input.statuses && input.statuses.length > 0 ? input.statuses : ['active', 'forgotten'];
  const rows = await tx
    .select({ ...getTableColumns(m), cursorTs: cursorTs(m.updatedAt) })
    .from(m)
    .where(
      and(
        sql`${m.workspaceId} = app_current_workspace()`,
        eq(m.kind, 'fact'),
        inArray(m.status, [...statuses]),
        cursor ? beforeCursor(m.updatedAt, m.id, cursor) : undefined,
      ),
    )
    .orderBy(desc(m.updatedAt), desc(m.id))
    .limit(limit + 1);
  return toPage(rows, limit);
}

/** Perfil ativo completo (tela de memória). */
async function listProfile(tx: DbTx, workspaceId: string): Promise<CopilotMemoryEntryRow[]> {
  const m = copilotMemoryEntries;
  return tx
    .select()
    .from(m)
    .where(and(eq(m.workspaceId, workspaceId), eq(m.kind, 'profile'), eq(m.status, 'active')))
    .orderBy(asc(m.profileKey));
}

/**
 * Grava o valor de uma chave do perfil. O ativo anterior vira `superseded` e a linha nova aponta
 * para ele. Conteúdo idêntico ao ativo = no-op (devolve o ativo).
 */
async function upsertProfile(
  tx: DbTx,
  input: {
    workspaceId: string;
    key: CopilotMemoryProfileKey;
    content: string;
    sourceLabel: string;
    sourceType?: CopilotMemorySourceType;
    sourceRef?: CopilotJsonObject | null;
    createdBy?: string | null;
  },
): Promise<CopilotMemoryEntryRow> {
  const m = copilotMemoryEntries;
  const content = input.content.trim();
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`copilot_profile:${input.workspaceId}:${input.key}`}, 0))`,
  );
  const [current] = await tx
    .select()
    .from(m)
    .where(
      and(
        eq(m.workspaceId, input.workspaceId),
        eq(m.kind, 'profile'),
        eq(m.profileKey, input.key),
        eq(m.status, 'active'),
      ),
    );
  if (current && current.content === content) return current;
  if (current) {
    await tx
      .update(m)
      .set({ status: 'superseded', updatedAt: sql`now()` })
      .where(eq(m.id, current.id));
  }
  const [row] = await tx
    .insert(m)
    .values({
      workspaceId: input.workspaceId,
      kind: 'profile',
      profileKey: input.key,
      content,
      sourceType: input.sourceType ?? 'member',
      sourceLabel: input.sourceLabel,
      sourceRef: input.sourceRef ?? null,
      supersedesId: current?.id ?? null,
      createdBy: input.createdBy ?? null,
    })
    .returning();
  if (!row) throw new Error('copilot: perfil não materializou.');
  return row;
}

async function addFact(
  tx: DbTx,
  input: {
    workspaceId: string;
    content: string;
    sourceType: CopilotMemorySourceType;
    sourceLabel: string;
    sourceRef?: CopilotJsonObject | null;
    createdBy?: string | null;
  },
): Promise<CopilotMemoryEntryRow> {
  const [row] = await tx
    .insert(copilotMemoryEntries)
    .values({
      workspaceId: input.workspaceId,
      kind: 'fact',
      content: input.content.trim(),
      sourceType: input.sourceType,
      sourceLabel: input.sourceLabel,
      sourceRef: input.sourceRef ?? null,
      createdBy: input.createdBy ?? null,
    })
    .returning();
  if (!row) throw new Error('copilot: fato não materializou.');
  return row;
}

/** Esquece um fato ativo. `null` se não é um fato ativo. */
async function forget(
  tx: DbTx,
  input: { id: string; memberId: string | null },
): Promise<CopilotMemoryEntryRow | null> {
  const m = copilotMemoryEntries;
  const [row] = await tx
    .update(m)
    .set({
      status: 'forgotten',
      forgottenBy: input.memberId,
      forgottenAt: sql`now()`,
      updatedAt: sql`now()`,
    })
    .where(and(eq(m.id, input.id), eq(m.kind, 'fact'), eq(m.status, 'active')))
    .returning();
  return row ?? null;
}

/** Restaura um fato esquecido. `null` se não é um fato esquecido. */
async function restore(tx: DbTx, input: { id: string }): Promise<CopilotMemoryEntryRow | null> {
  const m = copilotMemoryEntries;
  const [row] = await tx
    .update(m)
    .set({ status: 'active', forgottenBy: null, forgottenAt: null, updatedAt: sql`now()` })
    .where(and(eq(m.id, input.id), eq(m.kind, 'fact'), eq(m.status, 'forgotten')))
    .returning();
  return row ?? null;
}

/**
 * Corrige um fato ativo: o original vira `superseded` e o novo nasce com `source_type='member'`
 * (quem corrigiu é a fonte agora) e `supersedes_id` apontando para o original. `null` se o
 * original não é um fato ativo (CAS: duas correções paralelas → uma vence).
 */
async function correct(
  tx: DbTx,
  input: { id: string; content: string; memberId: string; sourceLabel: string },
): Promise<{ original: CopilotMemoryEntryRow; corrected: CopilotMemoryEntryRow } | null> {
  const m = copilotMemoryEntries;
  const [original] = await tx
    .update(m)
    .set({ status: 'superseded', updatedAt: sql`now()` })
    .where(and(eq(m.id, input.id), eq(m.kind, 'fact'), eq(m.status, 'active')))
    .returning();
  if (!original) return null;
  const [corrected] = await tx
    .insert(m)
    .values({
      workspaceId: original.workspaceId,
      kind: 'fact',
      content: input.content.trim(),
      sourceType: 'member',
      sourceLabel: input.sourceLabel,
      supersedesId: original.id,
      createdBy: input.memberId,
    })
    .returning();
  if (!corrected) throw new Error('copilot: correção não materializou.');
  return { original, corrected };
}

export const copilotMemoryRepo = {
  listActiveForPrompt,
  listFacts,
  listProfile,
  upsertProfile,
  addFact,
  forget,
  restore,
  correct,
} as const;
