/**
 * Sessões e mensagens do Copiloto (F73-S01).
 *
 * Sessões são PRIVADAS do membro (ADR-003 §5): o RLS garante o workspace e quem filtra por
 * `member_id` é este repo (`getOwned`, `listByMember`, `rename`, `archive`). Não existe leitura de
 * sessão "de qualquer membro" aqui de propósito.
 */
import { and, desc, eq, getTableColumns, inArray, isNull, sql } from 'drizzle-orm';
import type { DbTx } from '../../client';
import {
  copilotMessages,
  copilotSessions,
  type CopilotJsonObject,
  type CopilotMessageRole,
  type CopilotMessageRow,
  type CopilotSessionOrigin,
  type CopilotSessionRow,
} from '../../schema/copilot';
import {
  beforeCursor,
  clampLimit,
  cursorTs,
  decodeCursor,
  toPage,
  type CopilotPage,
} from './cursor';

export const COPILOT_SESSIONS_PAGE_MAX = 50;
export const COPILOT_MESSAGES_PAGE_MAX = 100;
export const COPILOT_PROMPT_HISTORY_MAX = 12;

// ─── Sessões ─────────────────────────────────────────────────────────────────────

export interface CreateCopilotSessionInput {
  workspaceId: string;
  memberId: string;
  origin: CopilotSessionOrigin;
  title?: string | null;
  lastPageContext?: CopilotJsonObject | null;
}

async function createSession(tx: DbTx, input: CreateCopilotSessionInput): Promise<CopilotSessionRow> {
  const [row] = await tx
    .insert(copilotSessions)
    .values({
      workspaceId: input.workspaceId,
      memberId: input.memberId,
      origin: input.origin,
      title: input.title ?? null,
      lastPageContext: input.lastPageContext ?? null,
    })
    .returning();
  if (!row) throw new Error('copilot: sessão não materializou.');
  return row;
}

/** Sessões do membro, mais recentes primeiro (keyset por `updated_at`, `id`). */
async function listByMember(
  tx: DbTx,
  input: { memberId: string; cursor?: string | null; limit?: number; includeArchived?: boolean },
): Promise<CopilotPage<CopilotSessionRow>> {
  const limit = clampLimit(input.limit, 20, COPILOT_SESSIONS_PAGE_MAX);
  const cursor = input.cursor ? decodeCursor(input.cursor) : null;
  const rows = await tx
    .select({ ...getTableColumns(copilotSessions), cursorTs: cursorTs(copilotSessions.updatedAt) })
    .from(copilotSessions)
    .where(
      and(
        sql`${copilotSessions.workspaceId} = app_current_workspace()`,
        eq(copilotSessions.memberId, input.memberId),
        input.includeArchived ? undefined : isNull(copilotSessions.archivedAt),
        cursor ? beforeCursor(copilotSessions.updatedAt, copilotSessions.id, cursor) : undefined,
      ),
    )
    .orderBy(desc(copilotSessions.updatedAt), desc(copilotSessions.id))
    .limit(limit + 1);
  return toPage(rows, limit);
}

/** A sessão, se for DESTE membro. Sessão de outro membro = inexistente (sem oráculo). */
async function getOwned(tx: DbTx, id: string, memberId: string): Promise<CopilotSessionRow | null> {
  const [row] = await tx
    .select()
    .from(copilotSessions)
    .where(and(eq(copilotSessions.id, id), eq(copilotSessions.memberId, memberId)));
  return row ?? null;
}

async function rename(
  tx: DbTx,
  id: string,
  memberId: string,
  title: string,
): Promise<CopilotSessionRow | null> {
  const [row] = await tx
    .update(copilotSessions)
    .set({ title: title.trim(), updatedAt: sql`now()` })
    .where(and(eq(copilotSessions.id, id), eq(copilotSessions.memberId, memberId)))
    .returning();
  return row ?? null;
}

/** Arquiva (idempotente: rearquivar preserva o instante original). */
async function archive(tx: DbTx, id: string, memberId: string): Promise<CopilotSessionRow | null> {
  const [row] = await tx
    .update(copilotSessions)
    .set({ archivedAt: sql`coalesce(${copilotSessions.archivedAt}, now())` })
    .where(and(eq(copilotSessions.id, id), eq(copilotSessions.memberId, memberId)))
    .returning();
  return row ?? null;
}

/** Marca atividade (sobe a sessão na lista) e, se vier, guarda o último contexto de página. */
async function touch(
  tx: DbTx,
  id: string,
  input: { lastPageContext?: CopilotJsonObject | null } = {},
): Promise<void> {
  await tx
    .update(copilotSessions)
    .set({
      updatedAt: sql`now()`,
      ...(input.lastPageContext !== undefined ? { lastPageContext: input.lastPageContext } : {}),
    })
    .where(eq(copilotSessions.id, id));
}

export const copilotSessionsRepo = {
  create: createSession,
  listByMember,
  getOwned,
  rename,
  archive,
  touch,
} as const;

// ─── Mensagens ───────────────────────────────────────────────────────────────────

export interface AppendCopilotMessageInput {
  workspaceId: string;
  sessionId: string;
  role: CopilotMessageRole;
  content: string;
  turnId?: string | null;
  blocks?: CopilotJsonObject | null;
  toolResults?: CopilotJsonObject[] | null;
  pageContext?: CopilotJsonObject | null;
  proposalId?: string | null;
}

async function append(tx: DbTx, input: AppendCopilotMessageInput): Promise<CopilotMessageRow> {
  const [row] = await tx
    .insert(copilotMessages)
    .values({
      workspaceId: input.workspaceId,
      sessionId: input.sessionId,
      role: input.role,
      content: input.content,
      turnId: input.turnId ?? null,
      blocks: input.blocks ?? null,
      toolResults: input.toolResults ?? null,
      pageContext: input.pageContext ?? null,
      proposalId: input.proposalId ?? null,
    })
    .returning();
  if (!row) throw new Error('copilot: mensagem não materializou.');
  return row;
}

/**
 * Histórico da sessão em páginas "carregar anteriores": a primeira página traz as mensagens
 * MAIS RECENTES; `nextCursor` aponta para as mais antigas. Dentro da página, os itens vêm em
 * ordem cronológica (pronta para renderizar). A posse da sessão é conferida pelo chamador
 * (`getOwned`) antes.
 */
async function listBySession(
  tx: DbTx,
  input: { sessionId: string; cursor?: string | null; limit?: number },
): Promise<CopilotPage<CopilotMessageRow>> {
  const limit = clampLimit(input.limit, 50, COPILOT_MESSAGES_PAGE_MAX);
  const cursor = input.cursor ? decodeCursor(input.cursor) : null;
  const rows = await tx
    .select({ ...getTableColumns(copilotMessages), cursorTs: cursorTs(copilotMessages.createdAt) })
    .from(copilotMessages)
    .where(
      and(
        eq(copilotMessages.sessionId, input.sessionId),
        cursor ? beforeCursor(copilotMessages.createdAt, copilotMessages.id, cursor) : undefined,
      ),
    )
    .orderBy(desc(copilotMessages.createdAt), desc(copilotMessages.id))
    .limit(limit + 1);
  const page = toPage(rows, limit);
  return { items: [...page.items].reverse(), nextCursor: page.nextCursor };
}

/** Últimas `n` (≤ 12) falas de usuário/assistente para o prompt, em ordem cronológica. */
async function lastForPrompt(
  tx: DbTx,
  sessionId: string,
  n: number = COPILOT_PROMPT_HISTORY_MAX,
): Promise<Pick<CopilotMessageRow, 'id' | 'role' | 'content' | 'createdAt'>[]> {
  const limit = clampLimit(n, COPILOT_PROMPT_HISTORY_MAX, COPILOT_PROMPT_HISTORY_MAX);
  const rows = await tx
    .select({
      id: copilotMessages.id,
      role: copilotMessages.role,
      content: copilotMessages.content,
      createdAt: copilotMessages.createdAt,
    })
    .from(copilotMessages)
    .where(
      and(
        eq(copilotMessages.sessionId, sessionId),
        inArray(copilotMessages.role, ['user', 'assistant']),
      ),
    )
    .orderBy(desc(copilotMessages.createdAt), desc(copilotMessages.id))
    .limit(limit);
  return rows.reverse();
}

export const copilotMessagesRepo = { append, listBySession, lastForPrompt } as const;
