/**
 * Fatos da memória (F73-S11; A10): ensinar, listar, esquecer, restaurar e corrigir.
 *
 * Regras de produto:
 *  - Fato de PESSOA (`source_type='member'`) tem precedência: o `listActiveForPrompt` do repo
 *    ordena pessoa > Copiloto > integração, e corrigir cria o fato novo como `member`.
 *  - A fonte é sempre visível (`source_label`): "Escrito por Bruna", "Pedido de Paula ao
 *    Copiloto em 10/10/2026".
 *  - Esquecer vale na hora: o fato sai do prompt do turno seguinte (a sessão relê a memória a
 *    cada turno). Restaurar só até 24 h depois de esquecer; depois, é Ensinar de novo.
 *  - No máximo 200 fatos ativos por workspace (serializado por advisory lock).
 *
 * Todas as funções rodam sob o `tx` RLS do workspace: id de outro workspace é "não encontrado".
 */
import { and, desc, eq, getTableColumns, or, sql } from 'drizzle-orm';
import {
  InvalidCursorError,
  copilotMemoryRepo,
  decodeCursor,
  encodeCursor,
  schema,
  type CopilotMemoryEntryRow,
  type DbTx,
} from '@hm/db';
import { MEMORY_ACTIVE_FACTS_MAX, MemoryFactSchema, type MemoryFact } from '@hm/shared';
import {
  MEMORY_RESTORE_WINDOW_HOURS,
  countActiveFacts,
  fail,
  lockFacts,
  memberRefs,
  normalizeFactText,
  ok,
  recordMemoryAudit,
  sourceLabelCopilot,
  sourceLabelMember,
  type AuditContext,
  type MemoryResult,
} from './common';

export { InvalidCursorError };

const m = schema.copilotMemoryEntries;

/** Página padrão e teto da lista da tela de memória. */
export const MEMORY_FACTS_PAGE_DEFAULT = 20;
export const MEMORY_FACTS_PAGE_MAX = 50;

/** Coluna calculada no banco: "esquecido há menos de 24 h" (sem depender do relógio do Node). */
const canRestoreSql = sql<boolean>`(${m.status} = 'forgotten' and ${m.forgottenAt} > now() - ${sql.raw(`interval '${MEMORY_RESTORE_WINDOW_HOURS} hours'`)})`;

type FactRow = CopilotMemoryEntryRow & { readonly canRestore: boolean };

async function toDtos(tx: DbTx, rows: readonly FactRow[]): Promise<MemoryFact[]> {
  const refs = await memberRefs(
    tx,
    rows.map((r) => r.createdBy),
  );
  return rows.map((r) =>
    MemoryFactSchema.parse({
      id: r.id,
      content: r.content,
      source_type: r.sourceType,
      source_label: r.sourceLabel,
      status: r.status,
      created_by: (r.createdBy ? refs.get(r.createdBy) : undefined) ?? null,
      created_at: r.createdAt.toISOString(),
      updated_at: r.updatedAt.toISOString(),
      forgotten_at: r.forgottenAt ? r.forgottenAt.toISOString() : null,
      can_restore: r.canRestore,
    }),
  );
}

/** Um fato (qualquer estado) como DTO, ou `null` se não existe neste workspace. */
export async function loadFact(tx: DbTx, id: string): Promise<MemoryFact | null> {
  const [row] = await tx
    .select({ ...getTableColumns(m), canRestore: canRestoreSql })
    .from(m)
    .where(and(sql`${m.workspaceId} = app_current_workspace()`, eq(m.id, id), eq(m.kind, 'fact')))
    .limit(1);
  if (!row) return null;
  const [dto] = await toDtos(tx, [row]);
  return dto ?? null;
}

export interface FactsPage {
  readonly data: MemoryFact[];
  readonly next_cursor: string | null;
}

/**
 * Fatos ativos e os esquecidos há menos de 24 h (os que ainda dá para restaurar), do mais
 * recente para o mais antigo. Paginação keyset `(updated_at, id)` com o cursor opaco do repo.
 * Lança `InvalidCursorError` com cursor malformado.
 */
export async function listFactsPage(
  tx: DbTx,
  input: { readonly cursor?: string | null; readonly limit?: number } = {},
): Promise<FactsPage> {
  const limit = Math.max(
    1,
    Math.min(MEMORY_FACTS_PAGE_MAX, Math.trunc(input.limit ?? MEMORY_FACTS_PAGE_DEFAULT)),
  );
  const cursor = input.cursor ? decodeCursor(input.cursor) : null;
  const cursorTs = sql<string>`to_char(${m.updatedAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
  const rows = await tx
    .select({ ...getTableColumns(m), canRestore: canRestoreSql, cursorTs })
    .from(m)
    .where(
      and(
        sql`${m.workspaceId} = app_current_workspace()`,
        eq(m.kind, 'fact'),
        or(eq(m.status, 'active'), and(eq(m.status, 'forgotten'), sql`${canRestoreSql}`)),
        cursor
          ? sql`(${m.updatedAt}, ${m.id}) < (${cursor.ts}::timestamptz, ${cursor.id}::uuid)`
          : undefined,
      ),
    )
    .orderBy(desc(m.updatedAt), desc(m.id))
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  const nextCursor =
    rows.length > limit && last ? encodeCursor({ ts: last.cursorTs, id: last.id }) : null;
  return { data: await toDtos(tx, page), next_cursor: nextCursor };
}

/** Ensinar (por pessoa): `source_type='member'`, "Escrito por <nome>". */
export async function addMemberFact(
  tx: DbTx,
  input: {
    readonly workspaceId: string;
    readonly memberId: string;
    readonly memberName: string;
    readonly content: string;
    readonly audit?: AuditContext;
  },
): Promise<MemoryResult<MemoryFact>> {
  await lockFacts(tx, input.workspaceId);
  if ((await countActiveFacts(tx, input.workspaceId)) >= MEMORY_ACTIVE_FACTS_MAX) {
    return fail('memory_limit');
  }
  const row = await copilotMemoryRepo.addFact(tx, {
    workspaceId: input.workspaceId,
    content: normalizeFactText(input.content),
    sourceType: 'member',
    sourceLabel: sourceLabelMember(input.memberName),
    createdBy: input.memberId,
  });
  await recordMemoryAudit(tx, {
    workspaceId: input.workspaceId,
    actorMemberId: input.memberId,
    action: 'copilot.memory.fact_added',
    resourceId: row.id,
    metadata: { source_type: 'member' },
    ...(input.audit ? { audit: input.audit } : {}),
  });
  const dto = await loadFact(tx, row.id);
  if (!dto) throw new Error('copilot: fato não materializou.');
  return ok(dto);
}

/**
 * Ensinar a pedido do Copiloto (`memory.remember`, via motor de propostas): o `id` é o do alvo
 * da proposta (estável: repetir a mesma execução não duplica), `source_type='copilot'` e
 * "Pedido de <nome> ao Copiloto em <data>". O recibo desfaz com `forgetFact`.
 */
export async function insertCopilotFact(
  tx: DbTx,
  input: {
    readonly id: string;
    readonly workspaceId: string;
    readonly content: string;
    readonly requestedByMemberId: string;
    readonly requestedByName: string;
    readonly actorMemberId: string;
    readonly now: Date;
    readonly proposalId: string | null;
    readonly note: string | null;
  },
): Promise<MemoryResult<{ readonly id: string }>> {
  await lockFacts(tx, input.workspaceId);
  const [existing] = await tx.select({ id: m.id }).from(m).where(eq(m.id, input.id)).limit(1);
  if (existing) return ok({ id: existing.id });
  if ((await countActiveFacts(tx, input.workspaceId)) >= MEMORY_ACTIVE_FACTS_MAX) {
    return fail('memory_limit');
  }
  await tx.insert(m).values({
    id: input.id,
    workspaceId: input.workspaceId,
    kind: 'fact',
    content: normalizeFactText(input.content),
    sourceType: 'copilot',
    sourceLabel: sourceLabelCopilot(input.requestedByName, input.now),
    sourceRef: {
      via: 'copilot',
      ...(input.proposalId ? { proposal_id: input.proposalId } : {}),
      ...(input.note ? { note: input.note } : {}),
    },
    createdBy: input.requestedByMemberId,
  });
  await recordMemoryAudit(tx, {
    workspaceId: input.workspaceId,
    actorMemberId: input.actorMemberId,
    actorType: 'copilot',
    action: 'copilot.memory.fact_added',
    resourceId: input.id,
    metadata: { source_type: 'copilot' },
    requestedByMemberId: input.requestedByMemberId,
    proposalId: input.proposalId,
  });
  return ok({ id: input.id });
}

async function findFact(
  tx: DbTx,
  id: string,
): Promise<{ id: string; status: CopilotMemoryEntryRow['status']; restorable: boolean } | null> {
  const [row] = await tx
    .select({ id: m.id, status: m.status, restorable: canRestoreSql })
    .from(m)
    .where(and(sql`${m.workspaceId} = app_current_workspace()`, eq(m.id, id), eq(m.kind, 'fact')))
    .limit(1);
  return row ?? null;
}

/**
 * Esquecer: vale na hora (o próximo turno não carrega o fato). Esquecer o que já está
 * esquecido é idempotente; um fato corrigido (`superseded`) não é mais "ativo" → conflito.
 */
export async function forgetFact(
  tx: DbTx,
  input: {
    readonly workspaceId: string;
    readonly id: string;
    readonly memberId: string;
    readonly actorType?: 'member' | 'copilot';
    readonly audit?: AuditContext;
  },
): Promise<MemoryResult<MemoryFact>> {
  const found = await findFact(tx, input.id);
  if (!found) return fail('not_found');
  if (found.status === 'superseded') return fail('not_active');
  if (found.status === 'active') {
    const row = await copilotMemoryRepo.forget(tx, { id: input.id, memberId: input.memberId });
    if (!row) return fail('not_active');
    await recordMemoryAudit(tx, {
      workspaceId: input.workspaceId,
      actorMemberId: input.memberId,
      ...(input.actorType ? { actorType: input.actorType } : {}),
      action: 'copilot.memory.fact_forgotten',
      resourceId: input.id,
      metadata: { source_type: row.sourceType },
      ...(input.audit ? { audit: input.audit } : {}),
    });
  }
  const dto = await loadFact(tx, input.id);
  if (!dto) return fail('not_found');
  return ok(dto);
}

/** Restaurar: só até 24 h depois de esquecer, e respeitando o teto de 200 ativos. */
export async function restoreFact(
  tx: DbTx,
  input: {
    readonly workspaceId: string;
    readonly id: string;
    readonly memberId: string;
    readonly audit?: AuditContext;
  },
): Promise<MemoryResult<MemoryFact>> {
  const found = await findFact(tx, input.id);
  if (!found) return fail('not_found');
  if (found.status !== 'forgotten') return fail('not_forgotten');
  if (!found.restorable) return fail('restore_window_closed');
  await lockFacts(tx, input.workspaceId);
  if ((await countActiveFacts(tx, input.workspaceId)) >= MEMORY_ACTIVE_FACTS_MAX) {
    return fail('memory_limit');
  }
  const row = await copilotMemoryRepo.restore(tx, { id: input.id });
  if (!row) return fail('not_forgotten');
  await recordMemoryAudit(tx, {
    workspaceId: input.workspaceId,
    actorMemberId: input.memberId,
    action: 'copilot.memory.fact_restored',
    resourceId: input.id,
    metadata: { source_type: row.sourceType },
    ...(input.audit ? { audit: input.audit } : {}),
  });
  const dto = await loadFact(tx, input.id);
  if (!dto) return fail('not_found');
  return ok(dto);
}

/**
 * Corrigir: o original vira `superseded` e o texto novo nasce como fato de PESSOA ("Escrito por
 * <nome>"), que tem precedência sobre o aprendido. Devolve o fato novo.
 */
export async function correctFact(
  tx: DbTx,
  input: {
    readonly workspaceId: string;
    readonly id: string;
    readonly memberId: string;
    readonly memberName: string;
    readonly content: string;
    readonly audit?: AuditContext;
  },
): Promise<MemoryResult<MemoryFact>> {
  const found = await findFact(tx, input.id);
  if (!found) return fail('not_found');
  if (found.status !== 'active') return fail('not_active');
  const result = await copilotMemoryRepo.correct(tx, {
    id: input.id,
    content: normalizeFactText(input.content),
    memberId: input.memberId,
    sourceLabel: sourceLabelMember(input.memberName),
  });
  if (!result) return fail('not_active');
  await recordMemoryAudit(tx, {
    workspaceId: input.workspaceId,
    actorMemberId: input.memberId,
    action: 'copilot.memory.fact_corrected',
    resourceId: result.corrected.id,
    metadata: {
      supersedes_id: result.original.id,
      original_source_type: result.original.sourceType,
    },
    ...(input.audit ? { audit: input.audit } : {}),
  });
  const dto = await loadFact(tx, result.corrected.id);
  if (!dto) return fail('not_found');
  return ok(dto);
}
