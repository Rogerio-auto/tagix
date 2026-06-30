import { describe, expect, it } from 'vitest';
import { buildSections, type DashboardSection, type SectionId } from './sections';
import type { CardType, DashboardCard, MetricCategory } from './types';

/**
 * F55-S06 — `buildSections` é a costura pura do Dashboard v3 (shell editorial Stripe).
 * Cobrimos: ordem curada do strip de KPIs (independe da ordem do payload), fallback
 * role-safe quando keys de KPI não chegam (nunca inventa card), classificação por
 * `cardType` nas seções corretas, cap do strip, seções vazias omitidas, tipo futuro
 * que não some da tela, e pureza (não muta a entrada).
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

function section(sections: readonly DashboardSection[], id: SectionId): DashboardSection | undefined {
  return sections.find((s) => s.id === id);
}

describe('buildSections', () => {
  it('promove o strip de KPIs na ordem curada, não na ordem do payload', () => {
    const cards = [
      card('conversoes_workspace_mes'),
      card('valor_total_pipeline'),
      card('valor_convertido_workspace_mes'),
      card('deals_fechados_ganho_mes'),
    ];
    const kpis = section(buildSections(cards), 'kpis');
    expect(kpis?.layout).toBe('kpis');
    expect(keys(kpis?.cards ?? [])).toEqual([
      'valor_convertido_workspace_mes',
      'valor_total_pipeline',
      'deals_fechados_ganho_mes',
      'conversoes_workspace_mes',
    ]);
  });

  it('promove apenas as keys de KPI que chegaram (fallback role-safe)', () => {
    // AGENT: só keys pessoais presentes; nenhuma workspace deve aparecer.
    const cards = [
      card('minhas_conversas_abertas'),
      card('resolvidas_hoje_por_mim'),
      card('tme_pessoal_24h'),
    ];
    const sections = buildSections(cards);
    expect(keys(section(sections, 'kpis')?.cards ?? [])).toEqual([
      'minhas_conversas_abertas',
      'resolvidas_hoje_por_mim',
    ]);
    // O stat não-KPI desce para a seção secundária.
    expect(keys(section(sections, 'secondary')?.cards ?? [])).toEqual(['tme_pessoal_24h']);
  });

  it('não inventa KPI quando nenhuma key curada está presente', () => {
    const cards = [card('metrica_qualquer'), card('outra_metrica')];
    const sections = buildSections(cards);
    expect(section(sections, 'kpis')).toBeUndefined();
    expect(keys(section(sections, 'secondary')?.cards ?? [])).toEqual([
      'metrica_qualquer',
      'outra_metrica',
    ]);
  });

  it('classifica por cardType nas seções corretas e na ordem editorial', () => {
    const cards = [
      card('valor_total_pipeline', 'stat'),
      card('inbox_por_canal', 'chart'),
      card('desempenho_30d', 'timeseries'),
      card('leaderboard_produtividade', 'leaderboard'),
      card('performance_por_atendente', 'table'),
      card('leads_recentes', 'feed'),
      card('tme_pessoal_24h', 'stat'),
    ];
    const sections = buildSections(cards);
    expect(keys(section(sections, 'kpis')?.cards ?? [])).toEqual(['valor_total_pipeline']);
    expect(keys(section(sections, 'performance')?.cards ?? [])).toEqual(['desempenho_30d']);
    expect(keys(section(sections, 'trends')?.cards ?? [])).toEqual(['inbox_por_canal']);
    // leaderboard + table compartilham a seção de rankings.
    expect(keys(section(sections, 'rankings')?.cards ?? [])).toEqual([
      'leaderboard_produtividade',
      'performance_por_atendente',
    ]);
    expect(keys(section(sections, 'feed')?.cards ?? [])).toEqual(['leads_recentes']);
    expect(keys(section(sections, 'secondary')?.cards ?? [])).toEqual(['tme_pessoal_24h']);
    // Ordem de leitura vertical: KPIs → desempenho → tendências → rankings → feed → secundário.
    expect(sections.map((s) => s.id)).toEqual([
      'kpis',
      'performance',
      'trends',
      'rankings',
      'feed',
      'secondary',
    ]);
  });

  it('limita o strip a 4 KPIs e o excedente curado não duplica no secundário', () => {
    const cards = [
      card('valor_convertido_workspace_mes'),
      card('valor_total_pipeline'),
      card('deals_fechados_ganho_mes'),
      card('conversoes_workspace_mes'),
      card('minhas_conversas_abertas'),
    ];
    const sections = buildSections(cards);
    expect(section(sections, 'kpis')?.cards).toHaveLength(4);
    expect(keys(section(sections, 'secondary')?.cards ?? [])).toEqual(['minhas_conversas_abertas']);
  });

  it('omite seções vazias (nada renderiza em branco)', () => {
    const sections = buildSections([card('valor_total_pipeline')]);
    expect(sections.map((s) => s.id)).toEqual(['kpis']);
  });

  it('um cardType futuro/desconhecido não some da tela (cai em secundário)', () => {
    const cards = [card('metrica_nova_qualquer', 'placar' as CardType)];
    const sections = buildSections(cards);
    expect(keys(section(sections, 'secondary')?.cards ?? [])).toEqual(['metrica_nova_qualquer']);
  });

  it('agrupa os cards de Negócio numa faixa própria logo após os KPIs, na ordem curada', () => {
    const cards = [
      card('valor_total_pipeline', 'stat'),
      card('funil_pipeline', 'table'),
      card('roi_ia', 'stat'),
      card('placar_ia_humano', 'scoreboard' as CardType),
    ];
    const sections = buildSections(cards);
    // Ordem curada (não a do payload) e roteamento por key, não por cardType.
    expect(keys(section(sections, 'negocio')?.cards ?? [])).toEqual([
      'placar_ia_humano',
      'roi_ia',
      'funil_pipeline',
    ]);
    // funil (table) NÃO vaza para rankings; roi (stat) NÃO vaza para secundário.
    expect(section(sections, 'rankings')).toBeUndefined();
    expect(section(sections, 'secondary')).toBeUndefined();
    // Negócio fica logo após os KPIs na leitura vertical.
    expect(sections.map((s) => s.id)).toEqual(['kpis', 'negocio']);
  });

  it('é pura — não muta a lista de entrada', () => {
    const cards = [card('valor_total_pipeline'), card('inbox_por_canal', 'chart')];
    const snapshot = keys(cards);
    buildSections(cards);
    expect(keys(cards)).toEqual(snapshot);
  });
});
