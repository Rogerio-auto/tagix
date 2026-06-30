/**
 * Formatação de valores do dashboard. Pt-BR, sem hardcode de moeda nos componentes.
 */
import type { MetricValue } from './types';

export function formatInt(n: number): string {
  return new Intl.NumberFormat('pt-BR').format(n);
}

export function formatBRLFromCents(cents: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);
}

export function formatUSD(usd: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'USD' }).format(usd);
}

/** Lê um número de um value jsonb com fallback seguro. */
export function readNumber(value: Record<string, unknown> | null, key: string): number | null {
  const v = value?.[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Duração legível a partir de segundos: "1m 42s", "12s", "—" se null. */
export function formatDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return '—';
  const total = Math.round(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  if (m === 0) return `${s}s`;
  return `${m}m ${s}s`;
}

/** Percentual inteiro: "78%". */
export function formatPercent(pct: number): string {
  return `${Math.round(pct)}%`;
}

/**
 * Formata uma célula de tabela conforme a convenção da `column.key` (contrato
 * F28-S01): `*_cents` → BRL; `*_seg`/`*_resposta_seg` → duração; numérico puro → int;
 * resto → string. Mantém a renderização genérica sem hardcode por métrica.
 */
export function formatTableCell(key: string, raw: unknown): string {
  if (raw === null || raw === undefined) return '—';
  if (key.endsWith('_cents')) {
    return formatBRLFromCents(Number(raw));
  }
  if (key.endsWith('_seg')) {
    return formatDuration(typeof raw === 'number' ? raw : Number(raw));
  }
  if (key === 'cost_usd') {
    return formatUSD(Number(raw));
  }
  if (typeof raw === 'number') {
    return formatInt(raw);
  }
  const asNum = Number(raw);
  if (typeof raw === 'string' && raw.trim() !== '' && Number.isFinite(asNum) && /^\d+$/.test(raw)) {
    return formatInt(asNum);
  }
  return String(raw);
}

/**
 * §F29 Onda B — formatação de score de qualidade (0-100): "90 / 100". `null` → "—".
 */
export function formatScore100(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  return `${Math.round(value)} / 100`;
}

/**
 * Rótulo textual do sentimento CSAT (acompanha a barra de distribuição — a11y: não
 * depender só de cor). Faixas: ≥30 positivo, ≤-30 negativo, entre neutro.
 */
export function csatSentimentLabel(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return 'Sem dados';
  if (value >= 30) return 'Positivo';
  if (value <= -30) return 'Negativo';
  return 'Neutro';
}

/** Rótulo legível pt-BR de uma categoria de objeção (vocab fixo §2). */
const OBJECTION_LABELS: Record<string, string> = {
  price: 'Preço',
  timing: 'Momento',
  trust: 'Confiança',
  competitor: 'Concorrente',
  feature_gap: 'Falta de recurso',
  authority: 'Decisão/Autoridade',
  other: 'Outro',
};

export function objectionCategoryLabel(category: string): string {
  return OBJECTION_LABELS[category] ?? category;
}

/**
 * F55-S06 — camada de **clareza** (UX §2.4: nenhum número órfão). Caption curto,
 * editorial, que explica o que um KPI representa. Texto estático descritivo — NUNCA
 * dado fabricado (o contrato não traz delta histórico; quem trouxer é S05/S07). Um
 * KPI sem entrada aqui simplesmente não ganha legenda (cai em `null`).
 */
const METRIC_CONTEXT: Record<string, string> = {
  // Negócio / pipeline / conversões — a régua de dinheiro e resultado.
  valor_total_pipeline: 'Soma dos negócios em aberto',
  valor_convertido_workspace_mes: 'Receita confirmada no mês',
  deals_fechados_ganho_mes: 'Negócios ganhos no mês',
  conversoes_workspace_mes: 'Total de conversões no mês',
  conversoes_minhas_mes: 'Suas conversões no mês',
  conversoes_por_tipo: 'Distribuição por tipo de conversão',
  novos_contatos_mes: 'Novos contatos neste mês',
  contatos_total_workspace: 'Base total de contatos',
  // Minha mesa (atendente) — a própria carga e resultado.
  minhas_conversas_abertas: 'Atribuídas a você, em andamento',
  minha_fila_pendente: 'Aguardando sua primeira resposta',
  resolvidas_hoje_por_mim: 'Encerradas por você hoje',
  // Operação (supervisão) — o pulso da fila.
  aguardando_atribuicao: 'Sem atendente designado',
  em_atendimento_ia: 'Atendidas pelo agente de IA agora',
  sla_violado_hoje: 'Passaram do tempo de resposta hoje',
  transferencias_24h: 'Entre atendentes nas últimas 24h',
  tempo_medio_primeira_resposta_24h: 'Média nas últimas 24h',
  tempo_medio_resolucao_24h: 'Média nas últimas 24h',
  volume_inbound_24h: 'Mensagens recebidas por hora (24h)',
  volume_outbound_24h: 'Mensagens enviadas por hora (24h)',
  // Agentes de IA — custo e desempenho do robô.
  custo_llm_hoje_usd: 'Gasto com IA hoje',
  custo_llm_mes_usd: 'Gasto com IA no mês',
  cap_mensal_consumido_pct: 'Do orçamento mensal de IA',
  agente_handoffs_24h: 'Repasses da IA para humano (24h)',
  agente_resolucoes_24h: 'Resolvidas pela IA (24h)',
  latencia_agente_p95_24h: 'Tempo de resposta da IA (p95)',
  qualidade_resposta_media: 'Nota média das respostas da IA',
};

/** Caption editorial de um KPI (clareza §2.4) ou `null` quando não há. */
export function metricContext(key: string): string | null {
  return METRIC_CONTEXT[key] ?? null;
}

/**
 * Valor exibido de um KPI decomposto em **principal** (número grande) e **secundário**
 * (sub-linha de contexto). Fonte única de formatação para `HeroCard`/`StatCard` —
 * antes duplicada nos dois. A escolha da "face" respeita a intenção da métrica:
 * cards de VALOR lideram com dinheiro (contagem desce para a sub-linha); cards de
 * VOLUME lideram com a contagem (dinheiro desce). Assim nenhum número fica órfão.
 */
export interface MetricDisplay {
  readonly primary: string;
  readonly secondary: string | null;
}

export function formatMetricDisplay(key: string, value: MetricValue | null): MetricDisplay {
  if (!value) return { primary: '—', secondary: null };
  // §F29: qualidade média é um score 0-100 → "90 / 100".
  if (key === 'qualidade_resposta_media') {
    return { primary: formatScore100(readNumber(value, 'value')), secondary: null };
  }
  // Contrato Onda A (F28-S01): { value, unit } — duração (s), latência (ms) ou %.
  const scalar = readNumber(value, 'value');
  if (scalar !== null) {
    const unit = typeof value['unit'] === 'string' ? value['unit'] : '';
    if (unit === 's') return { primary: formatDuration(scalar), secondary: null };
    if (unit === '%') return { primary: formatPercent(scalar), secondary: null };
    if (unit === 'ms') return { primary: `${formatInt(scalar)} ms`, secondary: null };
    return { primary: formatInt(scalar), secondary: null };
  }
  const cents = readNumber(value, 'valueCents');
  const usd = readNumber(value, 'costUsd');
  const count = readNumber(value, 'count');
  if (count !== null && cents !== null) {
    // Métrica de valor → dinheiro lidera; contagem vira contexto. Caso contrário,
    // a contagem é a manchete e o dinheiro acompanha.
    const moneyLeads = /valor|receita|faturamento|pipeline/.test(key);
    if (moneyLeads) {
      return {
        primary: formatBRLFromCents(cents),
        secondary: `${formatInt(count)} ${count === 1 ? 'conversão' : 'conversões'}`,
      };
    }
    return { primary: formatInt(count), secondary: formatBRLFromCents(cents) };
  }
  if (cents !== null) return { primary: formatBRLFromCents(cents), secondary: null };
  if (usd !== null) return { primary: formatUSD(usd), secondary: null };
  if (count !== null) return { primary: formatInt(count), secondary: null };
  return { primary: '—', secondary: null };
}
