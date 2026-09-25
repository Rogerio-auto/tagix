/**
 * Regra de resposta humana (F70-S04) — espelho da rota de envio da API
 * (F30-S04 + F55-S02). Pura: sem DB, sem mocks.
 */
import { describe, expect, it } from 'vitest';
import { planHumanReply } from './human-takeover';

const at = new Date('2026-09-24T12:00:00Z');
const earlier = new Date('2026-09-24T11:00:00Z');
const later = new Date('2026-09-24T13:00:00Z');

describe('planHumanReply', () => {
  it('ai on → pausa com human_takeover, autor, instante e atividade humana', () => {
    const plan = planHumanReply(
      { aiMode: 'on', firstResponseAt: null, aiLastHumanAt: null },
      { memberId: 'm-1', at, countsAsResponse: true },
    );
    expect(plan.paused).toBe(true);
    expect(plan.patch).toEqual({
      aiMode: 'paused',
      aiPausedReason: 'human_takeover',
      aiPausedAt: at,
      aiPausedBy: 'm-1',
      aiLastHumanAt: at,
      firstResponseAt: at,
    });
  });

  it('ai paused → não mexe no modo nem no motivo; só atividade humana', () => {
    const plan = planHumanReply(
      { aiMode: 'paused', firstResponseAt: earlier, aiLastHumanAt: earlier },
      { memberId: 'm-1', at, countsAsResponse: true },
    );
    expect(plan.paused).toBe(false);
    expect(plan.patch).toEqual({ aiLastHumanAt: at });
  });

  it('ai off → não liga nem pausa', () => {
    const plan = planHumanReply(
      { aiMode: 'off', firstResponseAt: null, aiLastHumanAt: null },
      { memberId: null, at, countsAsResponse: true },
    );
    expect(plan.paused).toBe(false);
    expect(plan.patch).toEqual({ aiLastHumanAt: at, firstResponseAt: at });
  });

  it('first_response_at nunca é sobrescrito', () => {
    const plan = planHumanReply(
      { aiMode: 'off', firstResponseAt: earlier, aiLastHumanAt: null },
      { memberId: 'm-1', at, countsAsResponse: true },
    );
    expect(plan.patch.firstResponseAt).toBeUndefined();
  });

  it('conversa aberta pelo próprio eco não conta como primeira resposta', () => {
    const plan = planHumanReply(
      { aiMode: 'off', firstResponseAt: null, aiLastHumanAt: null },
      { memberId: 'm-1', at, countsAsResponse: false },
    );
    expect(plan.patch.firstResponseAt).toBeUndefined();
    expect(plan.patch.aiLastHumanAt).toBe(at);
  });

  it('eco atrasado não puxa ai_last_human_at para trás', () => {
    const plan = planHumanReply(
      { aiMode: 'paused', firstResponseAt: earlier, aiLastHumanAt: later },
      { memberId: 'm-1', at, countsAsResponse: true },
    );
    expect(plan.patch).toEqual({});
  });
});
