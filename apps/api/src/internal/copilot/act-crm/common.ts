/**
 * Peças comuns dos executores de CRM do Copiloto (F73-S08).
 *
 * - Ator e correlação: toda escrita de domínio vai com `actor = { type: 'member', memberId }`
 *   (as permissões usadas: o aprovador, no fluxo de aprovação) e `metadata = { via, proposal_id }`.
 * - Versão: texto do `timestamptz` (`updated_at`, ou `created_at` se nunca foi editado), com a
 *   precisão do banco (microssegundos). Comparar `Date` do JS perderia precisão.
 * - Quem editou: o nome do último ator do histórico DEPOIS da versão lida, para o
 *   "parei em dois que a Paula estava editando". Sem histórico, sem nome (o motor diz "Mudou
 *   depois da prévia").
 */
import { and, desc, eq, gt, inArray, sql, type AnyColumn, type SQL } from 'drizzle-orm';
import { schema, type DbTx } from '@hm/db';
import type { MemberRef } from '@hm/shared';
import type { DealActor, DealMoveMetadata } from '../../../services/deal-move';
import type { ExecutorContext, Json } from '../core/executor-types';

const { members, dealHistory } = schema;

/** Teto de alvos por proposta (o motor recusa acima de `BATCH_LIMIT`). */
export const TARGET_IDS_MAX = 200;

/** Ator das escritas de domínio: o membro cujas permissões são usadas. */
export function memberActor(ctx: Pick<ExecutorContext, 'principal'>): DealActor {
  return { type: 'member', memberId: ctx.principal.memberId, role: ctx.principal.role };
}

/** Correlação das escritas de domínio (sem PII). */
export function correlation(ctx: Pick<ExecutorContext, 'source' | 'proposalId'>): DealMoveMetadata {
  return {
    via: ctx.source,
    ...(ctx.proposalId ? { proposal_id: ctx.proposalId } : {}),
  };
}

/** `coalesce(updated_at, created_at)::text` de uma tabela (versão com precisão do banco). */
export function versionSql(updatedAt: AnyColumn, createdAt: AnyColumn): SQL<string> {
  return sql<string>`coalesce(${updatedAt}, ${createdAt})::text`;
}

/** Nomes de membros por id (só do workspace; sem e-mail nem telefone). */
export async function memberNames(
  tx: DbTx,
  workspaceId: string,
  ids: readonly string[],
): Promise<Map<string, string>> {
  const unique = [...new Set(ids)];
  const out = new Map<string, string>();
  if (unique.length === 0) return out;
  const rows = await tx
    .select({ id: members.id, name: members.name })
    .from(members)
    .where(and(eq(members.workspaceId, workspaceId), inArray(members.id, unique)));
  for (const r of rows) out.set(r.id, clipText(r.name, 120) ?? 'Membro da equipe');
  return out;
}

export function memberRefs(
  ids: readonly string[],
  names: ReadonlyMap<string, string>,
): MemberRef[] {
  return [...new Set(ids)]
    .slice(0, 50)
    .map((id) => ({ member_id: id, name: names.get(id) ?? 'Membro da equipe' }));
}

/** Nome do responsável pela última mudança de um negócio depois da versão `sinceText`. */
export async function lastDealEditor(
  tx: DbTx,
  dealId: string,
  sinceText: string | null,
): Promise<string | undefined> {
  const conds: SQL[] = [eq(dealHistory.dealId, dealId)];
  if (sinceText)
    conds.push(gt(dealHistory.createdAt, sql`${sinceText}::timestamptz - interval '1 second'`));
  const [row] = await tx
    .select({ actorType: dealHistory.actorType, name: members.name })
    .from(dealHistory)
    .leftJoin(members, eq(members.id, dealHistory.actorMemberId))
    .where(and(...conds))
    .orderBy(desc(dealHistory.createdAt))
    .limit(1);
  if (!row) return undefined;
  if (row.name) return clipText(row.name, 120) ?? undefined;
  return row.actorType === 'agent'
    ? 'um agente de IA'
    : row.actorType === 'system'
      ? 'uma automação'
      : row.actorType === 'api'
        ? 'uma integração'
        : undefined;
}

/** Texto aparado e cortado; vazio = `null`. */
export function clipText(value: string | null | undefined, max: number): string | null {
  const trimmed = (value ?? '').trim();
  if (trimmed.length === 0) return null;
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

/** Plural simples ("1 negócio", "7 negócios"). */
export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Lê uma string de um objeto JSON. */
export function jsonString(obj: Json | null | undefined, key: string): string | null {
  const v = obj?.[key];
  return typeof v === 'string' ? v : null;
}

/** Lê um booleano de um objeto JSON. */
export function jsonBool(obj: Json | null | undefined, key: string): boolean | null {
  const v = obj?.[key];
  return typeof v === 'boolean' ? v : null;
}

/** JSON estável (chaves ordenadas) para comparar estados gravados. */
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

/** Uma frase começando em maiúscula, cortada no teto. */
export function sentence(text: string, max: number): string {
  const t = text.trim();
  const s = t.length > 0 ? `${t[0]?.toUpperCase() ?? ''}${t.slice(1)}` : t;
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}
