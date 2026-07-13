/**
 * Maquina de estados do recipient de campanha (F56-S03 / AUDITORIA §3.4 CAMP-03/04/06).
 *
 * Nucleo PURO (sem DB, sem relogio implicito) das tres decisoes que faltavam:
 *
 *  1. DRIP (CAMP-03): apos despachar o step i, o recipient volta a `pending`
 *     agendado para `now + steps[i+1].delaySeconds`; ao esgotar os steps vira
 *     `completed`. Antes o recipient morria em `sending` e `delaySeconds` nunca
 *     era lido — a campanha entregava so o passo 0.
 *
 *  2. TERMINAL (CAMP-04): `campaignIsExhausted` decide se a campanha acabou
 *     (nenhum recipient em `pending|sending`) -> status `completed` + nextTickAt
 *     null. Antes a campanha ficava `running` reagendando a cada 60s p/ sempre.
 *
 *  3. TETO DIARIO (CAMP-06): `evaluateDailyQuota` aplica `dailyLimit` sobre
 *     `messagesSentToday`, com reset por virada de dia no fuso da campanha
 *     (`lastDailyResetAt`). Antes as tres colunas existiam e nunca eram lidas.
 *
 * Tudo aqui e deterministico: `now` sempre entra por parametro (testavel sem
 * fake timers), fusos resolvidos por Intl (mesma tecnica de windows.ts).
 */

/** Step da campanha na ordem de posicao (indice do array = indice do passo). */
export interface CampaignStepRef {
  readonly id: string;
  readonly position: number;
  readonly delaySeconds: number;
}

/** Estados do recipient relevantes para a maquina (subset do CHECK do schema). */
export type RecipientStatus =
  | 'pending'
  | 'sending'
  | 'completed'
  | 'responded'
  | 'failed'
  | 'opted_out';

/** Estados que ainda dao trabalho ao tick (campanha nao pode ser terminal). */
export const ACTIVE_RECIPIENT_STATUSES: readonly RecipientStatus[] = ['pending', 'sending'];

/** Tentativas de despacho do MESMO step antes de dar o recipient por falho. */
export const MAX_DISPATCH_ATTEMPTS = 5;

/**
 * Idade maxima de um claim `sending` antes do reaper devolve-lo a `pending`.
 * O claim e transacional (commit/rollback atomico), entao so sobra `sending`
 * em cenario patologico (kill -9 entre COMMIT e o proximo passo) ou em dado
 * legado do bug CAMP-03. Defesa em profundidade: 10min.
 */
export const STALE_CLAIM_MS = 10 * 60 * 1000;

/** Backoff base entre tentativas de despacho do mesmo step. */
export const DISPATCH_BACKOFF_BASE_MS = 60 * 1000;
/** Teto do backoff (nao adianta esperar mais que isso num tick de 60s). */
export const DISPATCH_BACKOFF_MAX_MS = 30 * 60 * 1000;

/**
 * Backoff exponencial (1min, 2, 4, 8... teto 30min) para re-despachar o step
 * apos falha transitoria. Espelha o padrao de `scheduled_followups` (claim
 * atomico + attempts + backoff) ja usado em followups.ts.
 */
export function dispatchBackoffMs(attempts: number): number {
  const n = Math.max(1, Math.floor(attempts));
  const raw = DISPATCH_BACKOFF_BASE_MS * 2 ** (n - 1);
  return Math.min(raw, DISPATCH_BACKOFF_MAX_MS);
}

/** Proximo step a despachar dado o ultimo indice enviado (-1 = nenhum ainda). */
export function nextStepFor(
  steps: readonly CampaignStepRef[],
  lastStepIndex: number | null,
): { readonly step: CampaignStepRef; readonly index: number } | null {
  const index = (lastStepIndex ?? -1) + 1;
  if (index < 0) return null;
  const step = steps[index];
  if (!step) return null;
  return { step, index };
}

/** true se o recipient ja consumiu todos os steps da campanha. */
export function isExhausted(
  steps: readonly CampaignStepRef[],
  lastStepIndex: number | null,
): boolean {
  return nextStepFor(steps, lastStepIndex) === null;
}

/** Patch de estado do recipient apos um step ser despachado com sucesso. */
export interface RecipientTransition {
  readonly status: 'pending' | 'completed';
  readonly lastStepIndex: number;
  readonly lastStepAt: Date;
  readonly nextStepAt: Date | null;
  readonly completedAt: Date | null;
  readonly attempts: 0;
}

/**
 * CAMP-03/04: transicao apos despachar `sentIndex`.
 * Ha proximo step  -> `pending` com nextStepAt = now + delaySeconds do PROXIMO.
 * Nao ha           -> `completed` (estado terminal do recipient).
 * `attempts` zera: o contador e por-step, nao por-recipient.
 */
export function advanceAfterDispatch(
  steps: readonly CampaignStepRef[],
  sentIndex: number,
  now: Date,
): RecipientTransition {
  const next = nextStepFor(steps, sentIndex);
  if (!next) {
    return {
      status: 'completed',
      lastStepIndex: sentIndex,
      lastStepAt: now,
      nextStepAt: null,
      completedAt: now,
      attempts: 0,
    };
  }
  const delayMs = Math.max(0, next.step.delaySeconds) * 1000;
  return {
    status: 'pending',
    lastStepIndex: sentIndex,
    lastStepAt: now,
    nextStepAt: new Date(now.getTime() + delayMs),
    completedAt: null,
    attempts: 0,
  };
}

/** Patch de estado apos uma falha transitoria no despacho do step atual. */
export interface DispatchFailureTransition {
  readonly status: 'pending' | 'failed';
  readonly nextStepAt: Date | null;
  readonly failedReason: string | null;
}

/**
 * Falha transitoria: reagenda o MESMO step com backoff ate MAX_DISPATCH_ATTEMPTS;
 * a partir dai o recipient e dado por falho (nao trava a campanha em `sending`).
 */
export function afterDispatchFailure(
  attempts: number,
  now: Date,
  reason: string,
): DispatchFailureTransition {
  if (attempts >= MAX_DISPATCH_ATTEMPTS) {
    return { status: 'failed', nextStepAt: null, failedReason: reason };
  }
  return {
    status: 'pending',
    nextStepAt: new Date(now.getTime() + dispatchBackoffMs(attempts)),
    failedReason: null,
  };
}

/** true se nao ha mais nada a fazer na campanha (CAMP-04). */
export function campaignIsExhausted(counts: {
  readonly total: number;
  readonly active: number;
}): boolean {
  // total===0 e defensivo: campanha recem-ativada cujos recipients ainda estao
  // sendo importados NAO pode ser dada por concluida.
  return counts.total > 0 && counts.active === 0;
}

// ─── Teto diario (CAMP-06) ───────────────────────────────────────────────────

/** Snapshot das colunas de cota que ja existiam no schema e ninguem lia. */
export interface DailyQuotaState {
  readonly dailyLimit: number | null;
  readonly messagesSentToday: number;
  readonly lastDailyResetAt: Date | null;
  readonly timezone: string;
}

export interface DailyQuota {
  /** Envios ainda permitidos hoje. `null` = sem teto configurado. */
  readonly remaining: number | null;
  /** true se o contador precisa ser zerado (virou o dia no fuso da campanha). */
  readonly needsReset: boolean;
  /** Instante da proxima virada de dia — usado como nextTickAt quando a cota estoura. */
  readonly resetsAt: Date;
}

/** Offset (ms) do fuso no instante dado. Positivo a leste de Greenwich. */
function timezoneOffsetMs(at: Date, timezone: string): number {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = fmt.formatToParts(at);
  const get = (t: string): number => Number(parts.find((p) => p.type === t)?.value ?? '0');
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour') % 24,
    get('minute'),
    get('second'),
  );
  return asUtc - at.getTime();
}

/** Fuso invalido (dado sujo) nunca derruba o worker: cai em UTC. */
function safeTimezone(timezone: string): string {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    return timezone;
  } catch {
    return 'UTC';
  }
}

/** Instante da meia-noite local (inicio do dia) do dia que contem `now`. */
export function startOfDayInTz(now: Date, timezone: string): Date {
  const tz = safeTimezone(timezone);
  const offset = timezoneOffsetMs(now, tz);
  const local = new Date(now.getTime() + offset);
  const midnightAsUtc = Date.UTC(
    local.getUTCFullYear(),
    local.getUTCMonth(),
    local.getUTCDate(),
  );
  // Duas passadas: o offset na meia-noite pode diferir do offset em `now` (DST).
  const guess = new Date(midnightAsUtc - offset);
  const offsetAtMidnight = timezoneOffsetMs(guess, tz);
  return new Date(midnightAsUtc - offsetAtMidnight);
}

/** Instante da proxima meia-noite local (> now). */
export function nextDayStartInTz(now: Date, timezone: string): Date {
  const start = startOfDayInTz(now, timezone);
  // +26h cruza qualquer dia, inclusive os de 23h/25h por DST.
  const inTheNextDay = new Date(start.getTime() + 26 * 60 * 60 * 1000);
  const next = startOfDayInTz(inTheNextDay, timezone);
  if (next.getTime() <= now.getTime()) {
    return new Date(now.getTime() + 60 * 60 * 1000);
  }
  return next;
}

/**
 * CAMP-06: saldo do teto diario. `lastDailyResetAt` anterior a meia-noite local
 * (ou nulo) => o contador de hoje e zero, independente do que esta gravado.
 */
export function evaluateDailyQuota(state: DailyQuotaState, now: Date): DailyQuota {
  const dayStart = startOfDayInTz(now, state.timezone);
  const needsReset =
    state.lastDailyResetAt === null || state.lastDailyResetAt.getTime() < dayStart.getTime();
  const sentToday = needsReset ? 0 : Math.max(0, state.messagesSentToday);
  const limit = state.dailyLimit;
  // `null` = sem teto (coluna nullable). Um teto explicito de 0 e respeitado ao
  // pe da letra (nada sai hoje) — nao reinterpretamos como "ilimitado".
  const remaining = limit === null ? null : Math.max(0, limit - sentToday);
  return { remaining, needsReset, resetsAt: nextDayStartInTz(now, state.timezone) };
}
