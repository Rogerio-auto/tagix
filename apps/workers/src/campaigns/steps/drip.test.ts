/**
 * Teste de ponta-a-ponta da maquina de estados (F56-S03), com um DB em memoria
 * que implementa as CampaignTickPorts com a MESMA semantica do db-ports real
 * (claim atomico, idempotency key, transicoes de steps/state.ts). Roda ticks
 * sucessivos no relogio simulado e cobra o comportamento observavel:
 *
 *   CAMP-03  drip de 2+ passos envia TODOS os passos respeitando delaySeconds;
 *   CAMP-04  recipient e campanha chegam a `completed` (nextTickAt = null);
 *   CAMP-06  dailyLimit interrompe o batch e reseta na virada do dia.
 *   F58-S11  compasso (GCRA): vazao = ritmo configurado, sem rajada; prazo final;
 *            reserva de ritmo/cota pelo MESMO nucleo puro do db-ports real.
 */
import { describe, it, expect, vi } from 'vitest';
import type { Logger } from '@hm/logger';
import {
  processCampaign,
  deliveryIdempotencyKey,
  type CampaignQuota,
  type CampaignTickPorts,
  type DispatchOutcome,
  type PendingDispatch,
  type ProcessCampaignResult,
  type ReapResult,
  type RunningCampaign,
} from '../tick';
import { decideDispatchGate } from '../rate';
import {
  advanceAfterDispatch,
  campaignIsExhausted,
  evaluateDailyQuota,
  MAX_DISPATCH_ATTEMPTS,
  STALE_CLAIM_MS,
  type CampaignStepRef,
  type RecipientStatus,
} from './state';

function makeLogger(): Logger {
  const l = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  return { ...l, child: () => l } as unknown as Logger;
}

interface FakeRecipient {
  id: string;
  contactId: string;
  status: RecipientStatus;
  lastStepIndex: number | null;
  lastStepAt: Date | null;
  nextStepAt: Date | null;
  completedAt: Date | null;
  attempts: number;
}

interface FakeCampaign {
  status: 'running' | 'paused' | 'completed';
  endAt: Date | null;
  nextTickAt: Date | null;
  dailyLimit: number | null;
  messagesSentToday: number;
  lastDailyResetAt: Date | null;
  timezone: string;
}

interface FakeDb {
  readonly campaign: FakeCampaign;
  readonly steps: CampaignStepRef[];
  readonly recipients: FakeRecipient[];
  /** idempotencyKey -> delivery (a UNIQUE do schema). */
  readonly deliveries: Map<string, { stepId: string; recipientId: string }>;
  readonly sent: Array<{ recipientId: string; stepId: string; at: Date }>;
  readonly ports: CampaignTickPorts;
}

/** DB em memoria espelhando as regras de db-ports.ts (sem Postgres). */
function makeDb(init: {
  steps: CampaignStepRef[];
  recipients: number;
  dailyLimit?: number | null;
  timezone?: string;
  endAt?: Date | null;
}): FakeDb {
  const steps = init.steps;
  const campaign: FakeCampaign = {
    status: 'running',
    endAt: init.endAt ?? null,
    nextTickAt: new Date(0),
    dailyLimit: init.dailyLimit ?? null,
    messagesSentToday: 0,
    lastDailyResetAt: null,
    timezone: init.timezone ?? 'America/Sao_Paulo',
  };
  const recipients: FakeRecipient[] = Array.from({ length: init.recipients }, (_, i) => ({
    id: `r${i}`,
    contactId: `c${i}`,
    status: 'pending' as RecipientStatus,
    lastStepIndex: -1,
    lastStepAt: null,
    nextStepAt: null,
    completedAt: null,
    attempts: 0,
  }));
  const deliveries = new Map<string, { stepId: string; recipientId: string }>();
  const sent: Array<{ recipientId: string; stepId: string; at: Date }> = [];

  const isDue = (r: FakeRecipient, now: Date): boolean =>
    r.status === 'pending' && (r.nextStepAt === null || r.nextStepAt <= now);

  const ports: CampaignTickPorts = {
    // F59-S05: portao permissivo — este arquivo cobre drip/terminal/teto diario.
    checkConsent: async () => ({
      allowed: true as const,
      usedFallbackTimezone: false,
      timezone: 'America/Sao_Paulo',
    }),
    denyRecipient: async () => undefined,
    // F71-S06: assinatura ativa — o portao tem teste proprio em tick.test.ts.
    checkSubscription: async () => ({ active: true as const, status: 'active' }),
    promoteScheduledCampaigns: async () => [],
    listDueCampaigns: async () => [],
    inspectChannel: async () => ({
      kind: 'ready' as const,
      health: { qualityRating: 'GREEN' as const, tierLimit: 1000 },
    }),
    deferRecipient: async () => undefined,

    reapRecipients: async (_c, now): Promise<ReapResult> => {
      let recovered = 0;
      let finalized = 0;
      const cutoff = new Date(now.getTime() - STALE_CLAIM_MS);
      for (const r of recipients) {
        if (r.status === 'sending' && (r.lastStepAt ?? new Date(0)) < cutoff) {
          if (r.attempts >= MAX_DISPATCH_ATTEMPTS) {
            r.status = 'failed';
          } else {
            r.status = 'pending';
            r.nextStepAt = now;
          }
          recovered += 1;
        }
      }
      for (const r of recipients) {
        if (r.status === 'pending' && (r.lastStepIndex ?? -1) + 1 >= steps.length) {
          r.status = 'completed';
          r.completedAt = now;
          r.nextStepAt = null;
          finalized += 1;
        }
      }
      return { recovered, finalized };
    },

    ensureDailyQuota: async (_c, now): Promise<CampaignQuota> => {
      const q = evaluateDailyQuota(
        {
          dailyLimit: campaign.dailyLimit,
          messagesSentToday: campaign.messagesSentToday,
          lastDailyResetAt: campaign.lastDailyResetAt,
          timezone: campaign.timezone,
        },
        now,
      );
      return { remaining: q.remaining, resetsAt: q.resetsAt };
    },

    pendingRecipients: async (_c, limit, now): Promise<PendingDispatch[]> => {
      const out: PendingDispatch[] = [];
      for (const r of recipients) {
        if (out.length >= limit) break;
        if (!isDue(r, now)) continue;
        const idx = (r.lastStepIndex ?? -1) + 1;
        const step = steps[idx];
        if (!step) continue;
        out.push({ recipientId: r.id, contactId: r.contactId, stepId: step.id, stepIndex: idx });
      }
      return out;
    },

    enqueueDelivery: async (_c, d, key, now, pacing): Promise<DispatchOutcome> => {
      const r = recipients.find((x) => x.id === d.recipientId);
      // Claim atomico: so despacha quem ainda esta pending E devido.
      if (!r || !isDue(r, now)) return { kind: 'skipped' };

      if (deliveries.has(key)) {
        // Step ja despachado: nao reenvia, mas destrava o drip.
        Object.assign(r, advanceAfterDispatch(steps, d.stepIndex, now));
        return { kind: 'duplicate' };
      }
      // F58-S11: o MESMO portao puro do db-ports (la sob FOR NO KEY UPDATE). Recusa = rollback.
      const gate = decideDispatchGate(campaign, { now, ...pacing });
      if (gate.kind === 'closed') {
        return { kind: 'gate_closed', reason: gate.reason, retryAt: gate.retryAt };
      }
      campaign.nextTickAt = gate.patch.nextTickAt;
      campaign.messagesSentToday = gate.patch.messagesSentToday;
      campaign.lastDailyResetAt = gate.patch.lastDailyResetAt;
      r.attempts += 1;
      deliveries.set(key, { stepId: d.stepId, recipientId: d.recipientId });
      sent.push({ recipientId: d.recipientId, stepId: d.stepId, at: now });
      Object.assign(r, advanceAfterDispatch(steps, d.stepIndex, now));
      return { kind: 'enqueued' };
    },

    settleCampaign: async () => {
      const total = recipients.length;
      const active = recipients.filter(
        (r) => r.status === 'pending' || r.status === 'sending',
      ).length;
      if (!campaignIsExhausted({ total, active })) return false;
      if (campaign.status !== 'running') return false;
      campaign.status = 'completed';
      campaign.nextTickAt = null;
      return true;
    },

    closeCampaign: async () => {
      if (campaign.status !== 'running') return { closed: false, notReached: 0 };
      let notReached = 0;
      for (const r of recipients) {
        if (r.status === 'pending') {
          r.status = 'failed';
          r.nextStepAt = null;
          notReached += 1;
        }
      }
      campaign.status = 'completed';
      campaign.nextTickAt = null;
      return { closed: true, notReached };
    },

    pauseCampaign: async () => {
      if (campaign.status !== 'running') return;
      campaign.status = 'paused';
      campaign.nextTickAt = null;
    },

    // Mesma semantica do SQL real: least(greatest(cursor, at), end_at).
    scheduleNextTick: async (_id, at) => {
      if (campaign.status !== 'running') return;
      const cursor = campaign.nextTickAt ?? at;
      let next = cursor > at ? cursor : at;
      if (campaign.endAt !== null && campaign.endAt < next) next = campaign.endAt;
      campaign.nextTickAt = next;
    },

    applyErrorAction: async () => undefined,
  };

  return { campaign, steps, recipients, deliveries, sent, ports };
}

const CAMP: RunningCampaign = {
  id: 'camp1',
  workspaceId: 'ws1',
  channelId: 'ch1',
  sendWindows: null,
  rateLimitPerMinute: 60,
  deliveryRate: null,
  endAt: null,
  nextTickAt: null,
};

/**
 * Roda um tick so se a campanha esta running e o nextTickAt ja venceu. O snapshot
 * vem do "banco" (como o listDueCampaigns real): cursor e prazo atuais.
 */
async function tickAt(
  db: FakeDb,
  now: Date,
  camp: RunningCampaign = CAMP,
): Promise<ProcessCampaignResult | null> {
  if (db.campaign.status !== 'running') return null;
  const next = db.campaign.nextTickAt;
  if (next !== null && next > now) return null;
  const snapshot: RunningCampaign = {
    ...camp,
    endAt: db.campaign.endAt,
    nextTickAt: db.campaign.nextTickAt,
  };
  return processCampaign(snapshot, { ports: db.ports, logger: makeLogger() }, now);
}

const T0 = new Date('2026-07-13T12:00:00Z');
const minutes = (n: number): number => n * 60_000;

describe('CAMP-03 — drip multi-passo', () => {
  const steps: CampaignStepRef[] = [
    { id: 's0', position: 0, delaySeconds: 0 },
    { id: 's1', position: 1, delaySeconds: 600 }, // +10min
    { id: 's2', position: 2, delaySeconds: 1800 }, // +30min
  ];

  it('envia TODOS os passos respeitando delaySeconds (e nada antes da hora)', async () => {
    const db = makeDb({ steps, recipients: 1 });

    // t0: sai o passo 0; recipient volta a pending agendado p/ t0+10min.
    const r0 = await tickAt(db, T0);
    expect(r0?.dispatched).toBe(1);
    expect(db.sent.map((s) => s.stepId)).toEqual(['s0']);
    const rec = db.recipients[0]!;
    expect(rec.status).toBe('pending');
    expect(rec.nextStepAt?.getTime()).toBe(T0.getTime() + minutes(10));

    // t0+1min .. +9min: o tick roda mas NAO envia (passo 1 ainda nao venceu).
    for (const m of [1, 5, 9]) {
      const r = await tickAt(db, new Date(T0.getTime() + minutes(m)));
      expect(r?.dispatched ?? 0).toBe(0);
    }
    expect(db.sent).toHaveLength(1);

    // t0+10min: passo 1 devido -> sai; proximo agendado p/ +30min.
    const t10 = new Date(T0.getTime() + minutes(10));
    const r1 = await tickAt(db, t10);
    expect(r1?.dispatched).toBe(1);
    expect(db.sent.map((s) => s.stepId)).toEqual(['s0', 's1']);
    expect(db.recipients[0]!.nextStepAt?.getTime()).toBe(t10.getTime() + minutes(30));

    // t0+40min: ultimo passo -> recipient e campanha terminais.
    const t40 = new Date(T0.getTime() + minutes(40));
    const r2 = await tickAt(db, t40);
    expect(r2?.dispatched).toBe(1);
    expect(db.sent.map((s) => s.stepId)).toEqual(['s0', 's1', 's2']);
    expect(db.recipients[0]!.status).toBe('completed');
    expect(db.recipients[0]!.completedAt).toEqual(t40);
    expect(r2?.completed).toBe(true);
    expect(db.campaign.status).toBe('completed');
    expect(db.campaign.nextTickAt).toBeNull();
  });

  it('IDEMPOTENCIA: delivery ja existente nao reenvia e nao prende o recipient', async () => {
    const db = makeDb({ steps, recipients: 1 });
    // Simula crash pos-envio: a delivery do passo 0 ja existe, o recipient nao andou.
    db.deliveries.set(deliveryIdempotencyKey(CAMP.id, 'r0', 's0'), {
      stepId: 's0',
      recipientId: 'r0',
    });

    const r = await tickAt(db, T0);
    expect(r?.dispatched).toBe(0);
    expect(r?.duplicates).toBe(1);
    expect(db.sent).toHaveLength(0); // nao reenviou
    // ...mas o drip avancou (senao o recipient ficaria eternamente no passo 0).
    expect(db.recipients[0]!.lastStepIndex).toBe(0);
    expect(db.recipients[0]!.nextStepAt?.getTime()).toBe(T0.getTime() + minutes(10));
  });

  it('claim atomico: um segundo tick no mesmo instante nao redespacha', async () => {
    const db = makeDb({ steps, recipients: 1 });
    await tickAt(db, T0);
    const again = await processCampaign(CAMP, { ports: db.ports, logger: makeLogger() }, T0);
    expect(again.dispatched).toBe(0);
    expect(db.sent).toHaveLength(1);
  });
});

describe('CAMP-04 — estado terminal', () => {
  it('campanha de 1 passo conclui apos o batch (para de reagendar)', async () => {
    const db = makeDb({ steps: [{ id: 's0', position: 0, delaySeconds: 0 }], recipients: 3 });
    const r = await tickAt(db, T0);
    expect(r?.dispatched).toBe(3);
    expect(r?.completed).toBe(true);
    expect(db.campaign.status).toBe('completed');
    expect(db.campaign.nextTickAt).toBeNull();
    expect(db.recipients.every((x) => x.status === 'completed')).toBe(true);
    // Campanha completed nao volta a ser tickada.
    expect(await tickAt(db, new Date(T0.getTime() + minutes(1)))).toBeNull();
  });

  it('reaper fecha recipient legado preso em `sending` sem proximo step', async () => {
    const db = makeDb({ steps: [{ id: 's0', position: 0, delaySeconds: 0 }], recipients: 1 });
    const legacy = db.recipients[0]!;
    legacy.status = 'sending'; // estado morto do bug CAMP-03
    legacy.lastStepIndex = 0;
    legacy.lastStepAt = new Date(T0.getTime() - STALE_CLAIM_MS - 1000);

    const r = await tickAt(db, T0);
    expect(legacy.status).toBe('completed');
    expect(r?.completed).toBe(true);
    expect(db.campaign.status).toBe('completed');
  });

  it('campanha sem recipients NAO e concluida (import pode estar em voo)', async () => {
    const db = makeDb({ steps: [{ id: 's0', position: 0, delaySeconds: 0 }], recipients: 0 });
    const r = await tickAt(db, T0);
    expect(r?.completed).toBe(false);
    expect(db.campaign.status).toBe('running');
    expect(db.campaign.nextTickAt?.getTime()).toBe(T0.getTime() + minutes(1));
  });
});

describe('CAMP-06 — teto diario', () => {
  const steps: CampaignStepRef[] = [{ id: 's0', position: 0, delaySeconds: 0 }];

  it('dailyLimit corta o batch e dorme ate a virada do dia; no dia seguinte reseta', async () => {
    const db = makeDb({ steps, recipients: 5, dailyLimit: 2 });

    // Tick 1: o rate permitiria 15/batch, mas o teto diario permite 2.
    const r1 = await tickAt(db, T0);
    expect(r1?.dispatched).toBe(2);
    expect(db.campaign.messagesSentToday).toBe(2);

    // Tick 2 (mesmo dia): saldo zerado -> nao envia e reagenda p/ a virada.
    const t2 = new Date(T0.getTime() + minutes(1));
    const r2 = await tickAt(db, t2);
    expect(r2?.dispatched).toBe(0);
    expect(r2?.quotaExhausted).toBe(true);
    // 13/07 12:00Z = 09:00 BRT -> vira 14/07 03:00Z.
    expect(db.campaign.nextTickAt?.toISOString()).toBe('2026-07-14T03:00:00.000Z');
    expect(db.sent).toHaveLength(2);

    // Dia seguinte: contador zera e o envio retoma.
    const nextDay = new Date('2026-07-14T12:00:00Z');
    const r3 = await tickAt(db, nextDay);
    expect(r3?.dispatched).toBe(2);
    expect(db.campaign.messagesSentToday).toBe(2);
    expect(db.sent).toHaveLength(4);

    // Terceiro dia: sai o ultimo e a campanha fecha.
    const day3 = new Date('2026-07-15T12:00:00Z');
    const r4 = await tickAt(db, day3);
    expect(r4?.dispatched).toBe(1);
    expect(r4?.completed).toBe(true);
    expect(db.sent).toHaveLength(5);
    expect(db.campaign.status).toBe('completed');
  });

  it('sem dailyLimit o batch e limitado apenas pelo compasso', async () => {
    const db = makeDb({ steps, recipients: 40, dailyLimit: null });
    const r = await tickAt(db, T0);
    // rate 60/min, janela 5s -> balde de 6 (5s de ritmo + 1 de granularidade).
    expect(r?.dispatched).toBe(6);
    expect(db.campaign.status).toBe('running');
  });

  it('cota estourada NAO impede o fechamento de uma campanha ja esgotada', async () => {
    const db = makeDb({ steps, recipients: 1, dailyLimit: 1 });
    const r1 = await tickAt(db, T0);
    expect(r1?.dispatched).toBe(1);
    // Fechou no proprio tick (unico recipient completou).
    expect(db.campaign.status).toBe('completed');
    expect(db.campaign.nextTickAt).toBeNull();
  });
});

describe('F58-S11 — compasso ao longo do tempo (relogio simulado)', () => {
  const steps: CampaignStepRef[] = [{ id: 's0', position: 0, delaySeconds: 0 }];

  /** Varre de `from` ate `to` a cada `pollMs`, como o scheduler real. */
  async function runFor(
    db: FakeDb,
    from: Date,
    durationMs: number,
    pollMs: number,
    camp: RunningCampaign,
  ): Promise<void> {
    for (let t = 0; t <= durationMs; t += pollMs) {
      await tickAt(db, new Date(from.getTime() + t), camp);
    }
  }

  /** Maior numero de envios em qualquer janela deslizante de `windowMs`. */
  function maxInWindow(sent: ReadonlyArray<{ at: Date }>, windowMs: number): number {
    let best = 0;
    for (let i = 0; i < sent.length; i++) {
      const start = sent[i]!.at.getTime();
      let n = 0;
      for (let j = i; j < sent.length && sent[j]!.at.getTime() < start + windowMs; j++) n += 1;
      best = Math.max(best, n);
    }
    return best;
  }

  for (const rate of [1, 7, 30, 60, 120, 600]) {
    it(`${rate}/min: vazao = ritmo configurado (nao rate/4) e sem rajada`, { timeout: 30_000 }, async () => {
      // Sobra de publico: a vazao e limitada pelo compasso, nunca pela falta de gente.
      const db = makeDb({ steps, recipients: rate * 11 + 60, dailyLimit: null });
      const camp = { ...CAMP, rateLimitPerMinute: rate };
      await runFor(db, T0, minutes(10) - 1, 5000, camp);

      // Em 10 minutos sai ~10x o ritmo. Teto: 10*rate + o balde inicial (burst).
      const burst = Math.floor(5000 / Math.ceil(60_000 / rate)) + 1;
      expect(db.sent.length).toBeLessThanOrEqual(rate * 10 + burst);
      expect(db.sent.length).toBeGreaterThanOrEqual(Math.floor(rate * 10 * 0.97));

      // Nunca mais que um minuto de ritmo (+balde) dentro de QUALQUER minuto.
      expect(maxInWindow(db.sent, 60_000)).toBeLessThanOrEqual(rate + burst);
      // E dentro de 5s, no maximo o balde: nada de despejar o minuto inteiro.
      expect(maxInWindow(db.sent, 5000)).toBeLessThanOrEqual(Math.max(burst, 2 * burst - 1));
    });
  }

  it('YELLOW (ritmo efetivo menor) chega ao portao: 60/min vira 30/min de verdade', async () => {
    const db = makeDb({ steps, recipients: 1000, dailyLimit: null });
    db.ports.inspectChannel = async () => ({
      kind: 'ready',
      health: { qualityRating: 'YELLOW', tierLimit: 1000 },
    });
    await runFor(db, T0, minutes(10) - 1, 5000, CAMP);
    expect(db.sent.length).toBeLessThanOrEqual(30 * 10 + 4);
    expect(db.sent.length).toBeGreaterThanOrEqual(290);
  });

  it('ociosidade longa nao acumula credito: depois de 1h parada sai so o balde', async () => {
    const db = makeDb({ steps, recipients: 1000, dailyLimit: null });
    const camp = { ...CAMP, rateLimitPerMinute: 600 };
    db.campaign.nextTickAt = new Date(T0.getTime() - minutes(60));
    const r = await tickAt(db, T0, camp);
    // 600/min = 100ms entre mensagens; janela 5s => balde de 51.
    expect(r?.dispatched).toBe(51);
  });

  it('prazo final interrompe no meio: nada sai depois do end_at e quem sobrou fica de fora', async () => {
    const endAt = new Date(T0.getTime() + minutes(2));
    const db = makeDb({ steps, recipients: 500, dailyLimit: null, endAt });
    await runFor(db, T0, minutes(5), 5000, CAMP);
    expect(db.sent.every((s) => s.at.getTime() < endAt.getTime())).toBe(true);
    expect(db.sent.length).toBeGreaterThanOrEqual(115);
    expect(db.sent.length).toBeLessThanOrEqual(127);
    expect(db.campaign.status).toBe('completed');
    expect(db.recipients.filter((r) => r.status === 'failed').length).toBe(500 - db.sent.length);
  });

  it('reagendamento nunca passa do prazo (fecha na hora mesmo dormindo por cota)', async () => {
    const endAt = new Date(T0.getTime() + minutes(30));
    const db = makeDb({ steps, recipients: 10, dailyLimit: 2, endAt });
    await tickAt(db, T0);
    await tickAt(db, new Date(T0.getTime() + minutes(1)));
    // A cota mandaria dormir ate a meia-noite; o prazo puxa para end_at.
    expect(db.campaign.nextTickAt?.getTime()).toBe(endAt.getTime());
    await tickAt(db, endAt);
    expect(db.campaign.status).toBe('completed');
    expect(db.sent).toHaveLength(2);
  });

  it('teto diario no fuso com horario de verao (America/New_York, 08/03/2026)', async () => {
    // 08/03/2026 02:00 local pula para 03:00 (dia de 23h). Meia-noite = 05:00Z (EST);
    // a meia-noite seguinte e 04:00Z de 09/03 (EDT).
    const db = makeDb({ steps, recipients: 6, dailyLimit: 2, timezone: 'America/New_York' });
    const morning = new Date('2026-03-08T14:00:00Z'); // 10:00 EDT
    const r1 = await tickAt(db, morning);
    expect(r1?.dispatched).toBe(2);
    const r2 = await tickAt(db, new Date(morning.getTime() + minutes(1)));
    expect(r2?.quotaExhausted).toBe(true);
    expect(db.campaign.nextTickAt?.toISOString()).toBe('2026-03-09T04:00:00.000Z');
    // 23:59 local ainda e o mesmo dia: nada sai.
    expect(await tickAt(db, new Date('2026-03-09T03:59:00Z'))).toBeNull();
    // Virou o dia local: a cota reseta. O balde acorda vazio (sem rajada na
    // virada) e completa o saldo na varredura seguinte.
    const r3 = await tickAt(db, new Date('2026-03-09T04:00:00Z'));
    expect(r3?.dispatched).toBe(1);
    const r4 = await tickAt(db, new Date('2026-03-09T04:00:05Z'));
    expect(r4?.dispatched).toBe(1);
    expect(db.campaign.messagesSentToday).toBe(2);
    expect(db.sent).toHaveLength(4);
  });
});
