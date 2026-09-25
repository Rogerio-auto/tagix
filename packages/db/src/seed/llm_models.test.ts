/**
 * Catálogo global de modelos (`llm_models_whitelist`) — contrato do seed.
 *
 * F70-S31: o Claude Sonnet 5 entra na whitelist do Node com o id, o contexto e o
 * preço confirmados na lista pública do OpenRouter (25/09/2026) e com a mesma
 * política de planos do Sonnet 4. Pure: sem banco (o upsert é coberto pela
 * integração do seed da Arcada, que faz fail-fast na whitelist).
 */
import { describe, expect, it } from 'vitest';
import { ARCADA_MODEL } from './agent_templates_arcada.content';
import { LLM_MODELS } from './llm_models';

const SONNET_5 = 'anthropic/claude-sonnet-5';

function bySlug(slug: string) {
  return LLM_MODELS.find((m) => m.slug === slug);
}

describe('llm_models — catálogo', () => {
  it('slugs são únicos e no formato provider/modelo do OpenRouter', () => {
    const slugs = LLM_MODELS.map((m) => m.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const s of slugs) expect(s).toMatch(/^[a-z0-9-]+\/[a-z0-9.:-]+$/);
  });

  it('Sonnet 5: id, contexto, capacidades e preço do OpenRouter', () => {
    expect(bySlug(SONNET_5)).toMatchObject({
      displayName: 'Claude Sonnet 5',
      upstreamProvider: 'anthropic',
      contextLength: 1_000_000,
      supportsTools: true,
      supportsVision: true,
      supportsStreaming: true,
      // USD por 1M tokens = preço por token × 1M (0.000002 e 0.00001).
      pricingPromptPer1m: '2.000000',
      pricingCompletionPer1m: '10.000000',
      isActive: true,
    });
  });

  it('Sonnet 5 tem a mesma política de planos do Sonnet 4', () => {
    const sonnet4 = bySlug('anthropic/claude-sonnet-4');
    expect(sonnet4).toBeDefined();
    expect(bySlug(SONNET_5)?.defaultPlanKeys).toEqual(sonnet4?.defaultPlanKeys);
  });

  it('o modelo da Arcada está ativo na whitelist', () => {
    expect(ARCADA_MODEL).toBe(SONNET_5);
    expect(bySlug(ARCADA_MODEL)?.isActive).toBe(true);
  });
});
