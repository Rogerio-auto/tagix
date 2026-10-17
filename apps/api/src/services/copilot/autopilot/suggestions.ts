/**
 * Lista de sugestões do piloto automático (F73-S13; COPILOTO.md §5.2).
 *
 * `GET /api/copilot/suggestions?status=&stage_id=&cursor=&limit=`: cada sugestão vem com o negócio
 * resumido (título, nome do contato, valor), o estágio de origem e o de destino, o motivo em
 * linguagem de negócio, a confiança e, depois de decidida, quem decidiu e a proposta. Sempre sob
 * `dealScope` do membro: AGENT só vê sugestão de negócio que é dele (ou de conversa que ele vê).
 *
 * Paginação keyset `(created_at desc, id desc)` com o instante lido do próprio Postgres em
 * microssegundos (o `Date` do JS truncaria em ms e repetiria/pularia linhas do mesmo ms).
 */
import { and, desc, eq, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { InvalidCursorError, decodeCursor, encodeCursor, schema, type DbTx } from '@hm/db';
import type { CopilotSuggestionStatus, Suggestion } from '@hm/shared';
import { startRead } from '../../../internal/copilot/read-crm/limits';
import type { CopilotPrincipal } from '../identity/principal';
import { dealScope } from '../identity/scope';

const { copilotSuggestions: s, deals, contacts, stages, members } = schema;

export const SUGGESTIONS_PAGE_DEFAULT = 20;
export const SUGGESTIONS_PAGE_MAX = 50;

export interface SuggestionPage {
  readonly data: Suggestion[];
  readonly next_cursor: string | null;
}

export interface ListSuggestionsInput {
  readonly status: CopilotSuggestionStatus;
  readonly stageId?: string | undefined;
  readonly cursor?: string | undefined;
  readonly limit?: number | undefined;
}

function clip(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

/** Lança `InvalidCursorError` com cursor malformado (a rota responde 400). */
export async function listSuggestions(
  tx: DbTx,
  principal: CopilotPrincipal,
  input: ListSuggestionsInput,
): Promise<SuggestionPage> {
  // Timeout de leitura + JIT desligado (o predicado de escopo do AGENT dispara o JIT: 18 ms vs 800 ms).
  await startRead(tx);
  const limit = Math.max(
    1,
    Math.min(SUGGESTIONS_PAGE_MAX, Math.trunc(input.limit ?? SUGGESTIONS_PAGE_DEFAULT)),
  );
  const cursor = input.cursor ? decodeCursor(input.cursor) : null;
  const fromStage = alias(stages, 'from_stage');
  const toStage = alias(stages, 'to_stage');
  const createdTs = sql<string>`to_char(${s.createdAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

  const rows = await tx
    .select({
      id: s.id,
      dealId: s.dealId,
      fromStageId: s.fromStageId,
      toStageId: s.toStageId,
      reasonCode: s.reasonCode,
      reasonText: s.reasonText,
      confidence: s.confidence,
      status: s.status,
      proposalId: s.proposalId,
      decidedBy: s.decidedBy,
      decidedAt: s.decidedAt,
      createdAt: s.createdAt,
      createdTs,
      dealTitle: deals.title,
      valueCents: deals.valueCents,
      currency: deals.currency,
      contactName: sql<string | null>`coalesce(${contacts.displayName}, ${contacts.profileName})`,
      fromName: fromStage.name,
      toName: toStage.name,
      decidedByName: members.name,
    })
    .from(s)
    .innerJoin(deals, eq(deals.id, s.dealId))
    .leftJoin(contacts, eq(contacts.id, deals.contactId))
    .innerJoin(fromStage, eq(fromStage.id, s.fromStageId))
    .innerJoin(toStage, eq(toStage.id, s.toStageId))
    .leftJoin(members, eq(members.id, s.decidedBy))
    .where(
      and(
        eq(s.workspaceId, principal.workspaceId),
        eq(s.status, input.status),
        input.stageId ? eq(s.fromStageId, input.stageId) : undefined,
        dealScope(principal) ?? undefined,
        cursor
          ? sql`(${s.createdAt}, ${s.id}) < (${cursor.ts}::timestamptz, ${cursor.id}::uuid)`
          : undefined,
      ),
    )
    .orderBy(desc(s.createdAt), desc(s.id))
    .limit(limit + 1);

  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  const next =
    rows.length > limit && last ? encodeCursor({ ts: last.createdTs, id: last.id }) : null;

  return {
    data: page.map(
      (r): Suggestion => ({
        id: r.id,
        deal: {
          deal_id: r.dealId,
          title: clip(r.dealTitle.trim() || 'Negócio', 200),
          contact_name: r.contactName ? clip(r.contactName, 200) : null,
          value: r.valueCents / 100,
          currency: r.currency,
        },
        from_stage: { stage_id: r.fromStageId, name: clip(r.fromName, 120) },
        to_stage: { stage_id: r.toStageId, name: clip(r.toName, 120) },
        reason_code: r.reasonCode,
        reason_text: clip(r.reasonText, 300),
        confidence: r.confidence,
        status: r.status,
        proposal_id: r.proposalId,
        decided_by:
          r.decidedBy && r.decidedByName
            ? { member_id: r.decidedBy, name: clip(r.decidedByName, 120) }
            : null,
        decided_at: r.decidedAt ? r.decidedAt.toISOString() : null,
        created_at: r.createdAt.toISOString(),
      }),
    ),
    next_cursor: next,
  };
}

export { InvalidCursorError };

/** Pendentes do workspace inteiro (a contagem do `copilot:suggestions_changed`: sem PII). */
export async function countPendingSuggestions(tx: DbTx, workspaceId: string): Promise<number> {
  const [row] = await tx
    .select({ n: sql<number>`count(*)::int`.mapWith(Number) })
    .from(s)
    .where(and(eq(s.workspaceId, workspaceId), eq(s.status, 'pending')));
  return row?.n ?? 0;
}
