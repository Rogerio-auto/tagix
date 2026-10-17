/**
 * Composição do briefing: pontua, escolhe os 3 maiores (desempate pelo mais antigo), conta o
 * `overflow_count` e escreve o texto com o locale e a moeda do workspace.
 *
 * "Briefing longo é lista de tarefas, não briefing": 3 é teto de produto (`BRIEFING_MAX_ITEMS`),
 * não parâmetro. Determinístico de ponta a ponta: mesmo conjunto de candidatos, mesmo `now`,
 * mesmo resultado, byte a byte (a ordem final nunca depende da ordem em que os coletores
 * devolveram).
 */
import {
  BRIEFING_MAX_ITEMS,
  BriefingItemSchema,
  type BriefingItem,
  type InternalRoute,
} from '@hm/shared';
import type { WorkspaceFormat } from '../../../internal/copilot/read-crm/common';
import { BRIEFING_SCORE_VERSION, scoreItem, type ScoreBreakdown } from './score';
import { makeTextKit, renderItemTexts, type TextKit } from './texts';
import type { BriefingCandidate, CandidateFacts, StoredBriefingItem } from './types';

export interface ScoredCandidate {
  readonly candidate: BriefingCandidate;
  readonly breakdown: ScoreBreakdown;
}

export interface ComposedBriefing {
  /** No máximo 3, do maior score para o menor. */
  readonly items: StoredBriefingItem[];
  /** Quantos candidatos ficaram de fora ("e mais N itens"). */
  readonly overflowCount: number;
}

/** Ordem total: score desc → mais antigo primeiro → chave (estável entre execuções). */
export function compareScored(a: ScoredCandidate, b: ScoredCandidate): number {
  if (b.breakdown.score !== a.breakdown.score) return b.breakdown.score - a.breakdown.score;
  const byAge = a.candidate.oldestAt.getTime() - b.candidate.oldestAt.getTime();
  if (byAge !== 0) return byAge;
  return a.candidate.key < b.candidate.key ? -1 : a.candidate.key > b.candidate.key ? 1 : 0;
}

export function scoreAll(candidates: readonly BriefingCandidate[], now: Date): ScoredCandidate[] {
  return candidates
    .map((candidate) => ({ candidate, breakdown: scoreItem(candidate, now) }))
    .sort(compareScored);
}

const PRIORITY_BY_RANK = ['high', 'medium', 'low'] as const;

/** Prioridade pela posição no briefing: 1º alta, 2º média, 3º baixa. */
export function priorityForRank(rank: number): BriefingItem['priority'] {
  return PRIORITY_BY_RANK[Math.min(Math.max(rank, 0), PRIORITY_BY_RANK.length - 1)] ?? 'low';
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Ação de um clique: `ask` quando há pedido pronto, senão `navigate`. */
function actionFor(
  facts: CandidateFacts,
  texts: { actionLabel: string; ask: string | null },
): BriefingItem['action'] {
  const label = clip(texts.actionLabel, 80);
  if (facts.kind === 'integration_alert') {
    return facts.action.kind === 'ask'
      ? { kind: 'ask', value: clip(facts.action.value, 2000), label }
      : { kind: 'navigate', value: facts.action.value as InternalRoute, label };
  }
  if (texts.ask) return { kind: 'ask', value: clip(texts.ask, 2000), label };
  switch (facts.kind) {
    case 'deals_idle':
      return { kind: 'navigate', value: `/pipeline?stage=${facts.stageId}`, label };
    case 'leads_waiting':
      return { kind: 'navigate', value: '/hoje', label };
    case 'events_today':
      return { kind: 'navigate', value: '/calendar', label };
    case 'autopilot_pending':
      return { kind: 'navigate', value: '/pipeline', label };
    case 'campaign_issue':
      return { kind: 'navigate', value: `/campaigns/${facts.campaignId}`, label };
  }
}

/**
 * O item como a API o expõe: os campos do contrato, escolhidos um a um (nada de `_meta`, e
 * nenhum campo novo vaza por acidente).
 */
export function toPublicItem(item: StoredBriefingItem): BriefingItem {
  return {
    id: item.id,
    kind: item.kind,
    priority: item.priority,
    title: item.title,
    value_at_risk: item.value_at_risk,
    why: item.why,
    as_of: item.as_of,
    source: item.source,
    action: item.action,
  };
}

/** Monta UM item (texto + ação + metadados de revalidação). Valida contra o contrato. */
export function buildItem(
  scored: ScoredCandidate,
  rank: number,
  kit: TextKit,
): StoredBriefingItem {
  const { candidate, breakdown } = scored;
  const texts = renderItemTexts(kit, candidate.facts, {
    value: breakdown.valueAtRisk,
    weight: breakdown.weight,
  });
  const item: BriefingItem = BriefingItemSchema.parse({
    id: clip(candidate.key, 64),
    kind: candidate.kind,
    priority: priorityForRank(rank),
    title: clip(texts.title, 200),
    value_at_risk: Math.round(breakdown.valueAtRisk * 100) / 100,
    why: texts.why.slice(0, 3).map((line) => clip(line, 200)),
    as_of: candidate.asOf.toISOString(),
    source: clip(candidate.source, 120),
    action: actionFor(candidate.facts, texts),
  });
  return {
    ...item,
    _meta: {
      v: BRIEFING_SCORE_VERSION,
      kind: candidate.kind,
      score: breakdown.score,
      since: candidate.oldestAt.toISOString(),
      refs: candidate.refs,
    },
  };
}

/** Os candidatos viram o briefing: ≤ 3 itens + `overflow_count`. */
export function compose(
  candidates: readonly BriefingCandidate[],
  options: { readonly fmt: WorkspaceFormat; readonly now: Date },
): ComposedBriefing {
  const kit = makeTextKit(options.fmt);
  const ranked = scoreAll(candidates, options.now);
  const top = ranked.slice(0, BRIEFING_MAX_ITEMS);
  return {
    items: top.map((scored, rank) => buildItem(scored, rank, kit)),
    overflowCount: Math.max(0, ranked.length - top.length),
  };
}
