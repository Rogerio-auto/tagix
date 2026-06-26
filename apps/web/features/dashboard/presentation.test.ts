import { describe, expect, it } from 'vitest';
import { buildTiers } from './presentation';
import type { CardType, DashboardCard, MetricCategory } from './types';

/**
 * F48-S08 — `buildTiers` é a costura pura do Command Center. Cobrimos: ordem curada
 * do hero (independe da ordem do payload), fallback quando keys do hero não chegam
 * (role-safe — nunca inventa card), cards ocultos/ausentes que não vazam para tier
 * algum, classificação por `cardType` e cap do hero.
 */

function card(
  key: string,
  cardType: CardType = 'stat',
  category: MetricCategory = 'atendimento',
): DashboardCard {
  return {
    key,
    label: key,
    category,
    cardType,
    cadence: 'snapshot_5min',
    value: { count: 1 },
    drillHref: null,
  };
}

const keys = (cards: readonly DashboardCard[]): string[] => cards.map((c) => c.key);

describe('buildTiers', () => {
  it('promove o hero na ordem curada, não na ordem do payload', () => {
    // Payload em ordem "errada" de propósito.
    const cards = [
      card('conversoes_workspace_mes'),
      card('valor_total_pipeline'),
      card('valor_convertido_workspace_mes'),
      card('deals_fechados_ganho_mes'),
    ];
    const { hero } = buildTiers(cards);
    expect(keys(hero)).toEqual([
      'valor_convertido_workspace_mes',
      'valor_total_pipeline',
      'deals_fechados_ganho_mes',
      'conversoes_workspace_mes',
    ]);
  });

  it('promove apenas as keys de hero que chegaram (fallback role-safe)', () => {
    // AGENT: só keys pessoais presentes; nenhuma workspace deve aparecer.
    const cards = [
      card('minhas_conversas_abertas'),
      card('resolvidas_hoje_por_mim'),
      card('tme_pessoal_24h'),
    ];
    const { hero, secondary } = buildTiers(cards);
    expect(keys(hero)).toEqual(['minhas_conversas_abertas', 'resolvidas_hoje_por_mim']);
    // O stat não-hero desce para secundário.
    expect(keys(secondary)).toEqual(['tme_pessoal_24h']);
  });

  it('não inventa hero quando nenhuma key curada está presente', () => {
    const cards = [card('metrica_qualquer'), card('outra_metrica')];
    const { hero, secondary } = buildTiers(cards);
    expect(hero).toHaveLength(0);
    expect(keys(secondary)).toEqual(['metrica_qualquer', 'outra_metrica']);
  });

  it('não vaza cards ausentes do payload para tier algum (ocultos respeitados)', () => {
    // applyLayout já removeu o oculto antes; buildTiers só vê o que sobrou.
    const cards = [card('valor_total_pipeline')];
    const tiers = buildTiers(cards);
    const all = [
      ...tiers.hero,
      ...tiers.charts,
      ...tiers.timeseries,
      ...tiers.leaderboards,
      ...tiers.feeds,
      ...tiers.secondary,
    ];
    expect(keys(all)).toEqual(['valor_total_pipeline']);
  });

  it('classifica por cardType nos tiers corretos', () => {
    const cards = [
      card('valor_total_pipeline', 'stat'),
      card('inbox_por_canal', 'chart'),
      card('desempenho_30d', 'timeseries'),
      card('leaderboard_produtividade', 'leaderboard'),
      card('performance_por_atendente', 'table'),
      card('leads_recentes', 'feed'),
      card('tme_pessoal_24h', 'stat'),
    ];
    const t = buildTiers(cards);
    expect(keys(t.hero)).toEqual(['valor_total_pipeline']);
    expect(keys(t.charts)).toEqual(['inbox_por_canal']);
    expect(keys(t.timeseries)).toEqual(['desempenho_30d']);
    // leaderboard + table compartilham o tier de rankings.
    expect(keys(t.leaderboards)).toEqual([
      'leaderboard_produtividade',
      'performance_por_atendente',
    ]);
    expect(keys(t.feeds)).toEqual(['leads_recentes']);
    expect(keys(t.secondary)).toEqual(['tme_pessoal_24h']);
  });

  it('limita o hero a 4 cards e o excedente curado não vira secundário duplicado', () => {
    // Todas as 4 keys de workspace + 1 de agente: hero cap=4, a 5ª curada não aparece
    // como hero, mas como é stat não-hero, desce para secundário.
    const cards = [
      card('valor_convertido_workspace_mes'),
      card('valor_total_pipeline'),
      card('deals_fechados_ganho_mes'),
      card('conversoes_workspace_mes'),
      card('minhas_conversas_abertas'),
    ];
    const { hero, secondary } = buildTiers(cards);
    expect(hero).toHaveLength(4);
    expect(keys(secondary)).toEqual(['minhas_conversas_abertas']);
  });

  it('é pura — não muta a lista de entrada', () => {
    const cards = [card('valor_total_pipeline'), card('inbox_por_canal', 'chart')];
    const snapshot = keys(cards);
    buildTiers(cards);
    expect(keys(cards)).toEqual(snapshot);
  });
});
