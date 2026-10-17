/**
 * Geração do briefing do dia, idempotente por (membro, data local do workspace).
 *
 * `getOrCreateToday` é o único ponto de entrada (rota e agendador): lê a linha do dia; se não
 * existe, gera na hora (candidatos → score → ≤ 3 itens → `upsert`); se existe e tem mais de
 * 60 min, reconfere os itens ao devolver (freshness.ts) SEM regravar o snapshot.
 *
 * Meta de latência: p95 ≤ 300 ms com os índices atuais. A medição e o `EXPLAIN` do que ficou
 * lento estão na nota de execução do slot; índice faltante é registrado ali, não criado aqui.
 */
import { z } from 'zod';
import {
  copilotBriefingsRepo,
  type CopilotBriefingRow,
  type CopilotJsonObject,
  type DbTx,
} from '@hm/db';
import {
  BRIEFING_ITEM_KINDS,
  BriefingItemSchema,
  BriefingSchema,
  type Briefing,
} from '@hm/shared';
import { loadWorkspaceFormat } from '../../../internal/copilot/read-crm/common';
import type { CopilotPrincipal } from '../identity/principal';
import { collectCandidates } from './candidates';
import { compose, toPublicItem } from './compose';
import { needsRevalidation, revalidate } from './freshness';
import type { BriefingCandidate, CandidateContext, StoredBriefingItem } from './types';

/** `YYYY-MM-DD` do instante no fuso dado. Fuso inválido cai em UTC (nunca lança). */
export function localDateOf(at: Date, timezone: string): string {
  const format = (tz: string): string =>
    new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(at);
  try {
    return format(timezone);
  } catch {
    return format('UTC');
  }
}

/** Minutos desde a meia-noite local. Fuso inválido cai em UTC. */
export function localMinutesOf(at: Date, timezone: string): number {
  const parts = (tz: string): number => {
    const out = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(at);
    const hour = Number(out.find((p) => p.type === 'hour')?.value ?? '0');
    const minute = Number(out.find((p) => p.type === 'minute')?.value ?? '0');
    return (hour % 24) * 60 + minute;
  };
  try {
    return parts(timezone);
  } catch {
    return parts('UTC');
  }
}

const StoredMetaSchema = z
  .object({
    v: z.number().int(),
    kind: z.enum(BRIEFING_ITEM_KINDS),
    score: z.number(),
    since: z.string(),
    refs: z
      .object({
        stageId: z.string().optional(),
        campaignId: z.string().optional(),
        sourceId: z.string().optional(),
        externalRef: z.string().optional(),
      })
      .strict(),
  })
  .strict();

/** `BriefingItem` + `_meta` como gravado no jsonb. */
export const StoredBriefingItemSchema = BriefingItemSchema.extend({ _meta: StoredMetaSchema });

/** Itens gravados válidos. Linha corrompida é descartada (o briefing nunca quebra por ela). */
export function parseStoredItems(raw: readonly CopilotJsonObject[]): StoredBriefingItem[] {
  const out: StoredBriefingItem[] = [];
  for (const entry of raw) {
    const parsed = StoredBriefingItemSchema.safeParse(entry);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

/** Tira os metadados internos: o que sai na API é exatamente o `BriefingItem` do contrato. */
export function publicItems(items: readonly StoredBriefingItem[]): Briefing['items'] {
  return items.map(toPublicItem);
}

export interface BriefingOptions {
  /** Relógio injetável (testes). */
  readonly now?: Date;
  /** `false` pula a reconferência (o agendador só precisa garantir que o briefing existe). */
  readonly revalidate?: boolean;
}

export interface TodayBriefing {
  readonly briefing: Briefing;
  readonly row: CopilotBriefingRow;
  /** Gerado agora por esta chamada (não existia). */
  readonly created: boolean;
}

/** Candidatos → itens → `upsert`. Não confere se já existe: quem chama decide. */
async function generateRow(
  tx: DbTx,
  ctx: CandidateContext,
): Promise<{ row: CopilotBriefingRow; candidates: number }> {
  const candidates: BriefingCandidate[] = await collectCandidates(tx, ctx);
  const composed = compose(candidates, { fmt: ctx.fmt, now: ctx.now });
  const row = await copilotBriefingsRepo.upsert(tx, {
    workspaceId: ctx.principal.workspaceId,
    memberId: ctx.principal.memberId,
    forDate: ctx.forDate,
    dataAsOf: ctx.now,
    items: composed.items as unknown as CopilotJsonObject[],
    overflowCount: composed.overflowCount,
    status: composed.items.length > 0 ? 'ready' : 'empty',
  });
  return { row, candidates: candidates.length };
}

export async function getOrCreateToday(
  tx: DbTx,
  principal: CopilotPrincipal,
  options: BriefingOptions = {},
): Promise<TodayBriefing> {
  const now = options.now ?? new Date();
  const fmt = await loadWorkspaceFormat(tx, principal.workspaceId);
  const forDate = localDateOf(now, fmt.timezone);
  const ctx: CandidateContext = { principal, fmt, now, forDate };

  let row = await copilotBriefingsRepo.getFor(tx, principal.memberId, forDate);
  let created = false;
  if (!row) {
    ({ row } = await generateRow(tx, ctx));
    created = true;
  }

  let items = parseStoredItems(row.items);
  let status = row.status;
  let resolvedCount = 0;
  let dataAsOf = row.dataAsOf;
  if (!created && options.revalidate !== false && needsRevalidation(row.generatedAt, now)) {
    const result = await revalidate(tx, ctx, items);
    items = result.items;
    resolvedCount = result.resolved;
    dataAsOf = now;
    status = items.length > 0 ? 'ready' : result.stale > 0 ? 'stale' : 'empty';
  }

  const briefing = BriefingSchema.parse({
    id: row.id,
    for_date: row.forDate,
    generated_at: row.generatedAt.toISOString(),
    data_as_of: dataAsOf.toISOString(),
    status,
    currency: fmt.currency,
    items: publicItems(items),
    overflow_count: row.overflowCount,
    resolved_count: resolvedCount,
    seen_at: row.seenAt ? row.seenAt.toISOString() : null,
  });
  return { briefing, row, created };
}
