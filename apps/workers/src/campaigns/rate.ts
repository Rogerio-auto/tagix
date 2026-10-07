/**
 * Ritmo de envio de campanha (CAMPAIGNS.md 7). Nucleo PURO e deterministico:
 * `now` sempre entra por parametro, nada le relogio implicito.
 *
 * 1. Rate adaptativo (`effectiveRatePerMinute`):
 *    - YELLOW -> metade do rate; RED -> 0 (o caller pausa a campanha);
 *    - delivery_rate < 0.85 -> 70% do rate (throttle por queda de entrega);
 *    - piso de 1 quando o resultado seria 0 mas a quality nao e RED.
 *
 * 2. Compasso (F58-S11) — GCRA / token bucket com estado DURAVEL:
 *    o cursor do balde e `campaigns.next_tick_at` ("a proxima mensagem pode sair
 *    a partir de"). Cada envio empurra o cursor `intervalMs = 60000/rate` para a
 *    frente; o balde acumula no maximo `burst` creditos (~ uma janela de
 *    `burstWindowMs`). Resultado: a vazao media e EXATAMENTE o ritmo configurado
 *    (nao mais o rate/4 por minuto de antes) e nunca sai uma rajada maior que a
 *    janela de compasso — mesmo depois de horas parada. Como o cursor mora no
 *    Postgres, reinicio de processo nao zera o balde nem libera rajada.
 *
 * 3. Portao do disparo (`decideDispatchGate`): decide, sob o lock de linha da
 *    campanha (SELECT ... FOR NO KEY UPDATE no db-ports), se UMA mensagem pode sair
 *    agora — status, prazo final, teto diario e compasso — e devolve o patch
 *    atomico (cursor + contador do dia). E o que torna teto diario e ritmo
 *    corretos sob concorrencia: a decisao e por mensagem, serializada pela
 *    linha, e roda na mesma transacao que grava a entrega.
 */
import type { QualityRating } from '@hm/channels';
import { evaluateDailyQuota } from './steps/state';

export interface RateInputs {
  readonly baseRatePerMinute: number;
  readonly qualityRating: QualityRating;
  /** delivery_rate atual (delivered/sent); undefined = sem dados ainda. */
  readonly deliveryRate?: number | null;
}

/**
 * Calcula o rate efetivo/min. Retorna 0 SOMENTE em RED (sinal de auto-pause).
 * Em qualquer outro caso o piso e 1 (nunca trava por arredondamento).
 */
export function effectiveRatePerMinute(inputs: RateInputs): number {
  if (inputs.qualityRating === 'RED') return 0;
  let rate = inputs.baseRatePerMinute;
  if (inputs.qualityRating === 'YELLOW') rate = Math.floor(rate * 0.5);
  if (inputs.deliveryRate != null && inputs.deliveryRate < 0.85) {
    rate = Math.floor(rate * 0.7);
  }
  return Math.max(1, rate);
}

/**
 * Janela de compasso padrao: o maior bloco de mensagens que sai "junto" equivale
 * a 5s de ritmo. Casa com o intervalo padrao do scheduler (5s) — o balde precisa
 * cobrir o intervalo entre varreduras, senao a vazao cai abaixo do configurado.
 */
export const DEFAULT_PACING_WINDOW_MS = 5000;

/** Intervalo entre mensagens (ms inteiros, arredondado PARA CIMA: nunca excede o rate). */
export function pacingIntervalMs(ratePerMinute: number): number {
  const rate = Math.max(1, Math.floor(ratePerMinute));
  return Math.ceil(60_000 / rate);
}

/**
 * Capacidade do balde: creditos que cabem na janela de compasso, +1 para que a
 * varredura periodica nao perca vazao por granularidade (o credito que "vence"
 * entre duas varreduras nao se perde).
 */
export function pacingBurst(ratePerMinute: number, windowMs: number): number {
  const interval = pacingIntervalMs(ratePerMinute);
  return Math.max(1, Math.floor(Math.max(0, windowMs) / interval) + 1);
}

export interface PaceInputs {
  readonly ratePerMinute: number;
  /** Cursor duravel (`next_tick_at`). `null` = balde cheio desde agora. */
  readonly cursor: Date | null;
  readonly now: Date;
  readonly windowMs: number;
}

export interface PacePlan {
  readonly intervalMs: number;
  readonly burst: number;
  /** Creditos disponiveis AGORA (0 = ainda nao e hora). */
  readonly credits: number;
  /** Cursor efetivo apos aplicar o teto do balde (idle nao acumula alem do burst). */
  readonly effectiveCursor: Date;
}

/**
 * Cursor efetivo: o balde guarda no maximo `windowMs` de ociosidade (tolerancia
 * do GCRA). A tolerancia e em TEMPO, nao em mensagens: assim o atraso da
 * varredura (o tick roda a cada ~5s, nao no instante exato do cursor) e
 * absorvido sem perder vazao mesmo quando o intervalo entre mensagens e maior
 * que a janela (ex.: 7/min = uma a cada 8,6s).
 */
function effectiveCursorMs(cursor: Date | null, nowMs: number, windowMs: number): number {
  const floor = nowMs - Math.max(0, windowMs);
  if (cursor === null) return floor; // sem historico: balde cheio (no maximo `burst`).
  return Math.max(cursor.getTime(), floor);
}

/** Quantas mensagens podem sair agora pelo compasso (dimensiona o lote do tick). */
export function planPace(inputs: PaceInputs): PacePlan {
  const intervalMs = pacingIntervalMs(inputs.ratePerMinute);
  const burst = pacingBurst(inputs.ratePerMinute, inputs.windowMs);
  const nowMs = inputs.now.getTime();
  const eff = effectiveCursorMs(inputs.cursor, nowMs, inputs.windowMs);
  const credits = eff > nowMs ? 0 : Math.min(burst, Math.floor((nowMs - eff) / intervalMs) + 1);
  return { intervalMs, burst, credits, effectiveCursor: new Date(eff) };
}

/**
 * @deprecated F58-S11: o lote agora sai do compasso (`planPace`). Mantido so
 * para quem ainda importa pelo barrel; nao e usado pelo tick.
 */
export function batchSizeForTick(ratePerMinute: number): number {
  return Math.max(1, Math.floor(ratePerMinute / 4));
}

// ─── Portao por mensagem (atomico sob lock de linha) ─────────────────────────

/** Estado da campanha lido sob `FOR NO KEY UPDATE` no momento do disparo. */
export interface DispatchGateState {
  readonly status: string;
  readonly endAt: Date | null;
  /** Cursor do compasso. */
  readonly nextTickAt: Date | null;
  readonly dailyLimit: number | null;
  readonly messagesSentToday: number;
  readonly lastDailyResetAt: Date | null;
  readonly timezone: string;
}

export interface DispatchGateParams {
  readonly now: Date;
  readonly ratePerMinute: number;
  readonly windowMs: number;
}

/** Por que o portao fechou (o tick para o lote e decide o proximo passo). */
export type DispatchGateReason = 'not_running' | 'ended' | 'daily_quota' | 'pace';

export type DispatchGateDecision =
  | {
      readonly kind: 'reserve';
      /** Patch a gravar NA MESMA transacao do envio. */
      readonly patch: {
        readonly nextTickAt: Date;
        readonly messagesSentToday: number;
        readonly lastDailyResetAt: Date;
      };
    }
  | {
      readonly kind: 'closed';
      readonly reason: DispatchGateReason;
      /** Quando vale tentar de novo (`null` = nao depende de tempo). */
      readonly retryAt: Date | null;
    };

/**
 * Decide se UMA mensagem sai agora. Ordem dos portoes = ordem de gravidade:
 * campanha nao-running (pausada/cancelada no meio do lote) > prazo final >
 * teto diario > compasso.
 */
export function decideDispatchGate(
  state: DispatchGateState,
  params: DispatchGateParams,
): DispatchGateDecision {
  const { now } = params;
  if (state.status !== 'running') return { kind: 'closed', reason: 'not_running', retryAt: null };
  if (state.endAt !== null && state.endAt.getTime() <= now.getTime()) {
    return { kind: 'closed', reason: 'ended', retryAt: null };
  }

  const quota = evaluateDailyQuota(
    {
      dailyLimit: state.dailyLimit,
      messagesSentToday: state.messagesSentToday,
      lastDailyResetAt: state.lastDailyResetAt,
      timezone: state.timezone,
    },
    now,
  );
  if (quota.remaining !== null && quota.remaining <= 0) {
    return { kind: 'closed', reason: 'daily_quota', retryAt: quota.resetsAt };
  }

  const pace = planPace({
    ratePerMinute: params.ratePerMinute,
    cursor: state.nextTickAt,
    now,
    windowMs: params.windowMs,
  });
  if (pace.credits <= 0) {
    return { kind: 'closed', reason: 'pace', retryAt: pace.effectiveCursor };
  }

  const sentToday = quota.needsReset ? 0 : Math.max(0, state.messagesSentToday);
  return {
    kind: 'reserve',
    patch: {
      nextTickAt: new Date(pace.effectiveCursor.getTime() + pace.intervalMs),
      messagesSentToday: sentToday + 1,
      lastDailyResetAt:
        quota.needsReset || state.lastDailyResetAt === null ? now : state.lastDailyResetAt,
    },
  };
}
