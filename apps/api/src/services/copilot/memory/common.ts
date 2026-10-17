/**
 * Peças comuns da memória do negócio (F73-S11): resultado tipado, nomes de membro, rótulo de
 * fonte, trava de limite e trilha em `audit_logs`.
 *
 * A memória é por workspace e vale para a equipe inteira. Toda leitura/escrita roda sob o `tx`
 * RLS do workspace; a trilha NUNCA leva o conteúdo (só ids, chaves e contagens).
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import { schema, type DbTx } from '@hm/db';
import type { MemberRef } from '@hm/shared';

/** Janela em que um fato esquecido ainda pode ser restaurado (spec A10). */
export const MEMORY_RESTORE_WINDOW_HOURS = 24;

export type MemoryFailureCode =
  | 'not_found'
  | 'not_active'
  | 'not_forgotten'
  | 'restore_window_closed'
  | 'memory_limit';

export const MEMORY_ERROR_MESSAGES: Readonly<Record<MemoryFailureCode, string>> = {
  not_found: 'Não encontrei este item na memória.',
  not_active: 'Este fato não está mais ativo. Atualize a lista para ver o estado atual.',
  not_forgotten: 'Este fato não está esquecido.',
  restore_window_closed:
    'Já passaram 24 horas desde que este fato foi esquecido. Ensine-o de novo para o Copiloto voltar a usá-lo.',
  memory_limit: 'Esqueça algum fato antes de ensinar outro.',
};

export const MEMORY_ERROR_STATUS: Readonly<Record<MemoryFailureCode, number>> = {
  not_found: 404,
  not_active: 409,
  not_forgotten: 409,
  restore_window_closed: 409,
  memory_limit: 409,
};

export type MemoryResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: MemoryFailureCode };

export function ok<T>(value: T): MemoryResult<T> {
  return { ok: true, value };
}

export function fail<T = never>(error: MemoryFailureCode): MemoryResult<T> {
  return { ok: false, error };
}

const UNNAMED_MEMBER = 'Membro da equipe';

/** Nome exibido de um membro; nunca o e-mail. */
export async function memberDisplayName(tx: DbTx, memberId: string): Promise<string> {
  const [row] = await tx
    .select({ name: schema.members.name })
    .from(schema.members)
    .where(eq(schema.members.id, memberId))
    .limit(1);
  return (row?.name ?? '').trim() || UNNAMED_MEMBER;
}

/** `MemberRef` de vários membros de uma vez (quem escreveu, quem alterou). */
export async function memberRefs(
  tx: DbTx,
  ids: readonly (string | null)[],
): Promise<Map<string, MemberRef>> {
  const wanted = [...new Set(ids.filter((id): id is string => id !== null))];
  const out = new Map<string, MemberRef>();
  if (wanted.length === 0) return out;
  const rows = await tx
    .select({ id: schema.members.id, name: schema.members.name })
    .from(schema.members)
    .where(inArray(schema.members.id, wanted));
  for (const r of rows) {
    out.set(r.id, {
      member_id: r.id,
      name: ((r.name ?? '').trim() || UNNAMED_MEMBER).slice(0, 120),
    });
  }
  return out;
}

/** `dd/MM/aaaa` no fuso de Brasília (o rótulo de fonte é lido pela equipe). */
export function formatDatePt(date: Date): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);
}

/** `source_label` tem teto de 120 no banco: o nome é cortado, nunca o rótulo inteiro. */
export function sourceLabelMember(name: string): string {
  return `Escrito por ${name.slice(0, 80)}`.slice(0, 120);
}

export function sourceLabelCopilot(name: string, at: Date): string {
  return `Pedido de ${name.slice(0, 60)} ao Copiloto em ${formatDatePt(at)}`.slice(0, 120);
}

/** Um fato é uma frase: quebras de linha e espaços repetidos viram um espaço. */
export function normalizeFactText(content: string): string {
  return content.replace(/\s+/g, ' ').trim();
}

/**
 * Serializa as escritas de fatos de um workspace (checagem do teto de 200 + inserção) com
 * advisory lock da transação: duas escritas paralelas não ultrapassam o limite.
 */
export async function lockFacts(tx: DbTx, workspaceId: string): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`copilot_facts:${workspaceId}`}, 0))`,
  );
}

export async function countActiveFacts(tx: DbTx, workspaceId: string): Promise<number> {
  const m = schema.copilotMemoryEntries;
  const [row] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(m)
    .where(and(eq(m.workspaceId, workspaceId), eq(m.kind, 'fact'), eq(m.status, 'active')));
  return row?.n ?? 0;
}

export interface AuditContext {
  readonly ipAddress?: string | null;
  readonly userAgent?: string | null;
}

export type MemoryAuditAction =
  | 'copilot.memory.profile_updated'
  | 'copilot.memory.fact_added'
  | 'copilot.memory.fact_forgotten'
  | 'copilot.memory.fact_restored'
  | 'copilot.memory.fact_corrected';

/** Uma linha em `audit_logs`, na MESMA transação da escrita. Sem conteúdo, sem PII. */
export async function recordMemoryAudit(
  tx: DbTx,
  input: {
    readonly workspaceId: string;
    readonly actorMemberId: string | null;
    readonly actorType?: 'member' | 'copilot';
    readonly action: MemoryAuditAction;
    readonly resourceId: string | null;
    readonly metadata: Record<string, string | number | boolean | readonly string[] | null>;
    readonly requestedByMemberId?: string | null;
    readonly proposalId?: string | null;
    readonly audit?: AuditContext;
  },
): Promise<void> {
  await tx.insert(schema.auditLogs).values({
    workspaceId: input.workspaceId,
    actorMemberId: input.actorMemberId,
    actorType: input.actorType ?? 'member',
    action: input.action,
    resourceType: 'copilot_memory',
    resourceId: input.resourceId,
    metadata: { ...input.metadata },
    ipAddress: input.audit?.ipAddress ?? null,
    userAgent: input.audit?.userAgent ?? null,
    ...(input.requestedByMemberId ? { requestedByMemberId: input.requestedByMemberId } : {}),
    ...(input.proposalId ? { copilotProposalId: input.proposalId } : {}),
  });
}
