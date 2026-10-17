/**
 * Seam de fontes externas do briefing (`integration_alert`; F75).
 *
 * A F73 não implementa nenhum alerta de integração: ela só abre a porta. A F75 registra um
 * provedor na subida do processo e o briefing passa a considerá-lo, sem mudar a F73.
 *
 * Contrato do provedor:
 * - `collect` devolve candidatos `integration_alert` já escritos (título, motivos, ação);
 * - cada candidato traz o `asOf` DO DADO. Dado mais velho que `maxAgeMs` não entra: dado velho
 *   não aparece como fato (§7.1);
 * - `recheck` (opcional) reconfere um item já gravado na revalidação (>60 min). Devolve o
 *   candidato atualizado, ou `null` se o alerta já foi resolvido. Sem `recheck`, o item só
 *   sobrevive à revalidação se o dado ainda estiver dentro de `maxAgeMs`.
 */
import { InternalRouteSchema } from '@hm/shared';
import { BRIEFING_SOURCE_MAX_AGE_MS, type BriefingCandidate, type CandidateContext } from './types';

export interface BriefingSourceProvider {
  /** Identidade estável do provedor (vira `refs.sourceId`). */
  readonly id: string;
  /** Idade máxima do dado para valer como fato. Padrão: o de `integration_alert`. */
  readonly maxAgeMs?: number;
  collect(ctx: CandidateContext): Promise<readonly BriefingCandidate[]>;
  recheck?(ctx: CandidateContext, candidate: StoredRef): Promise<BriefingCandidate | null>;
}

/** O que o provedor recebe para reconferir um item gravado. */
export interface StoredRef {
  readonly sourceId: string;
  readonly externalRef: string | null;
}

const providers = new Map<string, BriefingSourceProvider>();

/** Registra um provedor. Devolve a função que o remove (testes). Id repetido substitui. */
export function registerBriefingSource(provider: BriefingSourceProvider): () => void {
  providers.set(provider.id, provider);
  return () => {
    if (providers.get(provider.id) === provider) providers.delete(provider.id);
  };
}

export function listBriefingSources(): readonly BriefingSourceProvider[] {
  return [...providers.values()];
}

export function getBriefingSource(id: string): BriefingSourceProvider | undefined {
  return providers.get(id);
}

export function sourceMaxAgeMs(provider: BriefingSourceProvider | undefined): number {
  return provider?.maxAgeMs ?? BRIEFING_SOURCE_MAX_AGE_MS.integration_alert;
}

/**
 * Candidato de provedor é entrada externa: confere forma, rota interna e idade do dado.
 * Devolve `null` para o que não vale como fato.
 */
export function acceptProviderCandidate(
  provider: BriefingSourceProvider,
  candidate: BriefingCandidate,
  now: Date,
): BriefingCandidate | null {
  if (candidate.kind !== 'integration_alert' || candidate.facts.kind !== 'integration_alert') {
    return null;
  }
  if (now.getTime() - candidate.asOf.getTime() > sourceMaxAgeMs(provider)) return null;
  const { facts } = candidate;
  if (facts.title.trim().length === 0 || facts.why.length === 0) return null;
  if (facts.action.kind === 'navigate' && !InternalRouteSchema.safeParse(facts.action.value).success) {
    return null;
  }
  if (!Number.isFinite(candidate.valueAtRisk) || candidate.valueAtRisk < 0) return null;
  return {
    ...candidate,
    refs: { ...candidate.refs, sourceId: provider.id },
  };
}
