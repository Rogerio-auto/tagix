/**
 * Previsão de receita do Copiloto (F73-S06; COPILOTO.md P5): explicável e determinística.
 * Nada de LLM, nada de modelo estatístico opaco: três fórmulas que uma pessoa confere à mão.
 *
 * ## Definição
 *
 * Para um período (mês corrente ou seguinte):
 *
 *   fechado   = Σ valor dos negócios GANHOS com `closed_at` dentro do período
 *   previsto  = fechado + Σ_{negócios abertos} valor × p(estágio)
 *   intervalo = previsto ± 1,28 × √( Σ_{abertos} valor² × p × (1 − p) )      (80% de confiança)
 *
 * `p(estágio)` = ganhos ÷ (ganhos + perdidos) entre os negócios DECIDIDOS (ganhos ou perdidos)
 * nos últimos 180 dias que PASSARAM pelo estágio (estão nele hoje ou o histórico de
 * `stage_changed` o cita como origem ou destino). Piso de `MIN_DECIDED` (10) decididos:
 * abaixo disso o estágio não tem amostra para falar por si e usa a taxa global do funil
 * (mesma conta, todos os estágios do funil). Se nem o funil tem decididos, p = 0 e o
 * componente diz "sem histórico" (nunca inventa uma taxa).
 *
 * ## Por que o intervalo é assim
 *
 * Cada negócio aberto fecha (ganho = valor) ou não (0): variável de Bernoulli escalada, de
 * variância valor² × p × (1 − p). Somando negócios independentes, a variância é a soma, e 1,28
 * é o quantil de 90% da normal (intervalo central de 80%). É uma aproximação declarada, não
 * uma promessa: negócios do mesmo cliente não são independentes. Limites naturais aplicados:
 * o piso é o já fechado (receita ganha não desfaz) e o teto é fechado + Σ valor aberto (ninguém
 * paga mais do que o valor do negócio).
 *
 * ## Escopo e período
 *
 * Todos os números respeitam o escopo do membro (AGENT: os seus). Não existe "data prevista
 * de fechamento" no modelo de dados: todo o funil aberto entra no previsto, e o período só
 * decide qual receita já está FECHADA. O texto de `why[]` diz isso quando relevante.
 *
 * Este módulo é puro (sem banco, sem relógio): o SQL mora em `forecast-revenue.ts`.
 */

/** Mínimo de negócios decididos para o estágio falar por si. */
export const MIN_DECIDED = 10;
/** Janela do histórico de decisões, em dias. */
export const HISTORY_WINDOW_DAYS = 180;
/** Quantil de 90% da normal padrão: intervalo central de 80%. */
export const Z_80 = 1.28;

/** Decididos que passaram por um estágio (ou por todo o funil, no agregado global). */
export interface DecidedStat {
  readonly won: number;
  readonly lost: number;
}

export type ProbabilityBasis = 'stage' | 'pipeline' | 'none';

export interface StageProbability {
  /** Probabilidade de ganho, 0..1. */
  readonly p: number;
  readonly basis: ProbabilityBasis;
  /** Decididos que sustentam `p` (do estágio, ou do funil quando `basis !== 'stage'`). */
  readonly decided: number;
}

/** Negócios abertos de um estágio, já agregados (a soma de quadrados evita carregar cada negócio). */
export interface OpenStageAggregate {
  readonly stageId: string;
  readonly pipelineId: string;
  readonly stageName: string;
  readonly deals: number;
  /** Σ valor, em unidades da moeda. */
  readonly sumValue: number;
  /** Σ valor², em unidades da moeda ao quadrado. */
  readonly sumSquares: number;
}

export interface ForecastInput {
  /** Σ ganhos do período, em unidades. */
  readonly closed: number;
  readonly open: readonly OpenStageAggregate[];
  /** Decididos por estágio (chave = `stageId`). */
  readonly stageStats: ReadonlyMap<string, DecidedStat>;
  /** Decididos do funil inteiro (chave = `pipelineId`). */
  readonly pipelineStats: ReadonlyMap<string, DecidedStat>;
}

export interface ForecastComponent {
  readonly stageId: string;
  readonly stageName: string;
  readonly deals: number;
  readonly sumValue: number;
  readonly probability: StageProbability;
  /** Σ valor × p do estágio: quanto ele contribui para o previsto. */
  readonly expected: number;
  /** Σ valor² × p × (1 − p) do estágio: quanto ele contribui para a variância. */
  readonly variance: number;
}

export interface Forecast {
  readonly closed: number;
  readonly predicted: number;
  readonly low: number;
  readonly high: number;
  /** Σ valor aberto (o teto natural do previsto). */
  readonly openValue: number;
  /** Do maior para o menor `expected`. */
  readonly components: readonly ForecastComponent[];
}

/** p do estágio, com o piso de decididos e a queda para a taxa do funil. */
export function stageProbability(
  stage: DecidedStat | undefined,
  pipeline: DecidedStat | undefined,
): StageProbability {
  const stageDecided = (stage?.won ?? 0) + (stage?.lost ?? 0);
  if (stage && stageDecided >= MIN_DECIDED) {
    return { p: stage.won / stageDecided, basis: 'stage', decided: stageDecided };
  }
  const pipelineDecided = (pipeline?.won ?? 0) + (pipeline?.lost ?? 0);
  if (pipeline && pipelineDecided > 0) {
    return { p: pipeline.won / pipelineDecided, basis: 'pipeline', decided: pipelineDecided };
  }
  return { p: 0, basis: 'none', decided: 0 };
}

/** Calcula a previsão. Puro e determinístico. */
export function computeForecast(input: ForecastInput): Forecast {
  const components: ForecastComponent[] = input.open.map((agg) => {
    const probability = stageProbability(
      input.stageStats.get(agg.stageId),
      input.pipelineStats.get(agg.pipelineId),
    );
    const { p } = probability;
    return {
      stageId: agg.stageId,
      stageName: agg.stageName,
      deals: agg.deals,
      sumValue: agg.sumValue,
      probability,
      expected: agg.sumValue * p,
      variance: agg.sumSquares * p * (1 - p),
    };
  });
  const expected = components.reduce((s, c) => s + c.expected, 0);
  const variance = components.reduce((s, c) => s + c.variance, 0);
  const openValue = components.reduce((s, c) => s + c.sumValue, 0);
  const predicted = input.closed + expected;
  const spread = Z_80 * Math.sqrt(variance);
  return {
    closed: input.closed,
    predicted,
    low: Math.max(input.closed, predicted - spread),
    high: Math.min(input.closed + openValue, predicted + spread),
    openValue,
    components: [...components].sort((a, b) => b.expected - a.expected),
  };
}

/** Agrega negócios abertos (valor em unidades) por estágio. Usado nos testes e em quem já tem a lista. */
export function aggregateOpenDeals(
  deals: readonly {
    readonly stageId: string;
    readonly pipelineId: string;
    readonly stageName: string;
    readonly value: number;
  }[],
): OpenStageAggregate[] {
  const byStage = new Map<string, OpenStageAggregate>();
  for (const d of deals) {
    const prev = byStage.get(d.stageId);
    byStage.set(d.stageId, {
      stageId: d.stageId,
      pipelineId: d.pipelineId,
      stageName: d.stageName,
      deals: (prev?.deals ?? 0) + 1,
      sumValue: (prev?.sumValue ?? 0) + d.value,
      sumSquares: (prev?.sumSquares ?? 0) + d.value * d.value,
    });
  }
  return [...byStage.values()];
}

export interface ForecastFormat {
  money(units: number): string;
  percent(fraction: number): string;
  count(n: number): string;
}

/** Quantos componentes entram em `why[]` (o contrato aceita até 3). */
export const WHY_MAX = 3;
const WHY_TEXT_MAX = 200;

/**
 * `why[]`: os maiores componentes do previsto, em pt-BR e por modelo de texto. Números
 * formatados por `Intl` (o chamador injeta o locale do workspace).
 */
export function explainForecast(forecast: Forecast, fmt: ForecastFormat): string[] {
  const lines: string[] = [];
  for (const c of forecast.components) {
    if (lines.length >= WHY_MAX) break;
    if (c.deals === 0) continue;
    const plural = c.deals === 1 ? 'negócio' : 'negócios';
    const head = `${c.stageName}: ${fmt.count(c.deals)} ${plural} somam ${fmt.money(c.sumValue)}`;
    const { basis, p, decided } = c.probability;
    const tail =
      basis === 'none'
        ? 'sem histórico de ganhos e perdas para estimar'
        : `${fmt.percent(p)} de chance (${
            basis === 'stage' ? 'neste estágio' : 'média do funil'
          }, ${fmt.count(decided)} decididos em ${HISTORY_WINDOW_DAYS} dias), esperado ${fmt.money(c.expected)}`;
    const line = `${head}; ${tail}`;
    lines.push(line.length > WHY_TEXT_MAX ? `${line.slice(0, WHY_TEXT_MAX - 1)}…` : line);
  }
  return lines;
}
