/**
 * Dado velho não aparece como fato (COPILOTO.md §7.1).
 *
 * Um briefing gerado há mais de 60 min (`BRIEFING_REVALIDATE_AFTER_MS`) é reconferido ao abrir,
 * item a item, pela MESMA consulta que o gerou:
 *
 *   - o registro mudou de estado (negócio movido, lead respondido, compromisso confirmado,
 *     sugestão decidida, campanha saudável) → o item `resolved` SAI da lista e conta como
 *     "N já resolvido(s)";
 *   - ainda vale → o item é atualizado com os números de agora (`as_of` = agora);
 *   - não deu para conferir (consulta falhou ou provedor sem `recheck`) e o dado já passou do
 *     limite da fonte (`BRIEFING_SOURCE_MAX_AGE_MS`) → o item sai por `stale`, nunca vira fato.
 *
 * Se não sobra nenhum item: `status='stale'` quando algum saiu por dado velho, senão `empty`.
 * A revalidação NÃO grava: o snapshot do dia fica como foi gerado e cada abertura reconfere
 * (barato: uma consulta por item, só depois de 60 min).
 */
import type { BriefingItem, BriefingItemKind } from '@hm/shared';
import type { DbTx } from '@hm/db';
import {
  collectAutopilotPending,
  collectCampaignIssues,
  collectDealsIdle,
  collectEventsToday,
  collectLeadsWaiting,
  lazyTicket,
  type TicketLoader,
} from './candidates';
import { buildItem, priorityForRank, type ScoredCandidate } from './compose';
import { scoreItem } from './score';
import { acceptProviderCandidate, getBriefingSource, sourceMaxAgeMs } from './sources';
import { makeTextKit, type TextKit } from './texts';
import {
  BRIEFING_REVALIDATE_AFTER_MS,
  BRIEFING_SOURCE_MAX_AGE_MS,
  type BriefingCandidate,
  type CandidateContext,
  type StoredBriefingItem,
} from './types';

/** O briefing gerado em `generatedAt` já precisa ser reconferido em `now`? */
export function needsRevalidation(generatedAt: Date, now: Date): boolean {
  return now.getTime() - generatedAt.getTime() > BRIEFING_REVALIDATE_AFTER_MS;
}

/** Idade máxima do dado do item, conforme a fonte. */
function maxAgeFor(item: StoredBriefingItem): number {
  if (item._meta.kind === 'integration_alert') {
    const sourceId = item._meta.refs.sourceId;
    return sourceMaxAgeMs(sourceId ? getBriefingSource(sourceId) : undefined);
  }
  return BRIEFING_SOURCE_MAX_AGE_MS[item._meta.kind];
}

/** O dado do item (`as_of`) é mais velho que o limite da fonte em `now`? */
export function isStale(item: StoredBriefingItem, now: Date): boolean {
  return now.getTime() - new Date(item.as_of).getTime() > maxAgeFor(item);
}

type Rechecked =
  | { readonly state: 'open'; readonly candidate: BriefingCandidate }
  | { readonly state: 'resolved' };

async function recheck(
  tx: DbTx,
  ctx: CandidateContext,
  item: StoredBriefingItem,
  ticket: TicketLoader,
): Promise<Rechecked> {
  const kind: BriefingItemKind = item._meta.kind;
  let found: BriefingCandidate | undefined;
  switch (kind) {
    case 'deals_idle': {
      const stageId = item._meta.refs.stageId;
      if (!stageId) return { state: 'resolved' };
      [found] = await collectDealsIdle(tx, ctx, { stageId });
      break;
    }
    case 'leads_waiting':
      [found] = await collectLeadsWaiting(tx, ctx, ticket);
      break;
    case 'events_today':
      [found] = await collectEventsToday(tx, ctx);
      break;
    case 'autopilot_pending':
      [found] = await collectAutopilotPending(tx, ctx);
      break;
    case 'campaign_issue': {
      const campaignId = item._meta.refs.campaignId;
      if (!campaignId) return { state: 'resolved' };
      [found] = await collectCampaignIssues(tx, ctx, ticket, { campaignId });
      break;
    }
    case 'integration_alert': {
      const sourceId = item._meta.refs.sourceId;
      const provider = sourceId ? getBriefingSource(sourceId) : undefined;
      // Sem provedor ou sem `recheck` não há como conferir: cai no limite de idade.
      if (!provider?.recheck) throw new Error('briefing: item sem como reconferir.');
      const fresh = await provider.recheck(ctx, {
        sourceId: provider.id,
        externalRef: item._meta.refs.externalRef ?? null,
      });
      const accepted = fresh ? acceptProviderCandidate(provider, fresh, ctx.now) : null;
      return accepted ? { state: 'open', candidate: accepted } : { state: 'resolved' };
    }
  }
  return found ? { state: 'open', candidate: found } : { state: 'resolved' };
}

export interface RevalidationResult {
  readonly items: StoredBriefingItem[];
  /** Saíram por já estarem resolvidos ("1 já resolvido"). */
  readonly resolved: number;
  /** Saíram por dado velho que não deu para conferir. */
  readonly stale: number;
}

interface Slot {
  readonly score: number;
  readonly since: number;
  readonly key: string;
  readonly scored?: ScoredCandidate;
  readonly kept?: StoredBriefingItem;
}

function compareSlots(a: Slot, b: Slot): number {
  if (b.score !== a.score) return b.score - a.score;
  if (a.since !== b.since) return a.since - b.since;
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

/**
 * Reconfere os itens de um briefing já gravado. Cada reconferência roda num savepoint: uma
 * consulta que estoura o `statement_timeout` não aborta a transação inteira (os outros itens
 * seguem sendo conferidos).
 */
export async function revalidate(
  tx: DbTx,
  ctx: CandidateContext,
  stored: readonly StoredBriefingItem[],
): Promise<RevalidationResult> {
  const kit: TextKit = makeTextKit(ctx.fmt);
  const ticket = lazyTicket(tx, ctx);
  const slots: Slot[] = [];
  let resolved = 0;
  let stale = 0;

  for (const item of stored) {
    let outcome: Rechecked | null = null;
    try {
      outcome = await tx.transaction((sp) => recheck(sp, ctx, item, ticket));
    } catch {
      outcome = null;
    }
    if (outcome === null) {
      // Não deu para conferir: só sobrevive enquanto o dado ainda está dentro do limite.
      if (isStale(item, ctx.now)) {
        stale += 1;
      } else {
        slots.push({
          score: item._meta.score,
          since: Date.parse(item._meta.since),
          key: item.id,
          kept: item,
        });
      }
      continue;
    }
    if (outcome.state === 'resolved') {
      resolved += 1;
      continue;
    }
    const scored: ScoredCandidate = {
      candidate: outcome.candidate,
      breakdown: scoreItem(outcome.candidate, ctx.now),
    };
    slots.push({
      score: scored.breakdown.score,
      since: scored.candidate.oldestAt.getTime(),
      key: scored.candidate.key,
      scored,
    });
  }

  slots.sort(compareSlots);
  const items = slots.map((slot, rank): StoredBriefingItem => {
    if (slot.scored) return buildItem(slot.scored, rank, kit);
    const kept = slot.kept as StoredBriefingItem;
    const priority: BriefingItem['priority'] = priorityForRank(rank);
    return { ...kept, priority };
  });
  return { items, resolved, stale };
}
