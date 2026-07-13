import { describe, expect, it } from 'vitest';
import {
  blankStep,
  emptyWizardState,
  stepsAreSafeToPersist,
  toStepsPayload,
  toWizardState,
} from './hydrate';
import type { CampaignDetail, CampaignStepRecord, StepDraft } from './types';

function stepRecord(over: Partial<CampaignStepRecord> = {}): CampaignStepRecord {
  return {
    id: 'st-1',
    campaignId: 'c-1',
    position: 0,
    templateName: 'promo_black_friday',
    languageCode: 'pt_BR',
    templateComponents: [],
    delaySeconds: 0,
    stopOnReply: true,
    ...over,
  };
}

function detail(over: Partial<CampaignDetail> = {}): CampaignDetail {
  return {
    campaign: {
      id: 'c-1',
      workspaceId: 'w-1',
      channelId: 'ch-1',
      name: 'Black Friday',
      type: 'drip',
      status: 'draft',
      timezone: 'America/Sao_Paulo',
      startAt: null,
      endAt: null,
      sendWindows: {
        enabled: true,
        timezone: 'America/Sao_Paulo',
        windows: [{ day: 1, start: '09:00', end: '18:00' }],
      },
      rateLimitPerMinute: 45,
      dailyLimit: 1000,
      autoHandoffOnReply: false,
      aiHandoffAgentId: null,
      createdAt: '2026-07-01T12:00:00.000Z',
      updatedAt: null,
      ...over.campaign,
    },
    steps: over.steps ?? [stepRecord()],
    followups: over.followups ?? [],
  };
}

describe('toWizardState (CAMP-05: hidratação da edição)', () => {
  it('carrega nome, tipo, canal, janelas, rate limit e handoff reais', () => {
    const state = toWizardState(detail());

    expect(state.name).toBe('Black Friday');
    expect(state.type).toBe('drip');
    expect(state.channelId).toBe('ch-1');
    expect(state.rateLimitPerMinute).toBe(45);
    expect(state.autoHandoffOnReply).toBe(false);
    expect(state.sendWindows).toEqual({
      enabled: true,
      timezone: 'America/Sao_Paulo',
      windows: [{ day: 1, start: '09:00', end: '18:00' }],
    });
    // Nunca sobrescreve o servidor com os defaults do modo criação.
    expect(state).not.toEqual(emptyWizardState());
  });

  it('ordena os steps por position e preserva idioma/stopOnReply/componentes', () => {
    const state = toWizardState(
      detail({
        steps: [
          stepRecord({ id: 'b', position: 1, templateName: 'follow', delaySeconds: 3600 }),
          stepRecord({
            id: 'a',
            position: 0,
            templateName: 'abertura',
            languageCode: 'en_US',
            stopOnReply: false,
            templateComponents: [{ type: 'body', parameters: [{ type: 'text', text: 'Ana' }] }],
          }),
        ],
      }),
    );

    expect(state.steps.map((s) => s.templateName)).toEqual(['abertura', 'follow']);
    expect(state.steps[0]?.languageCode).toBe('en_US');
    expect(state.steps[0]?.stopOnReply).toBe(false);
    expect(state.steps[0]?.templateComponents).toHaveLength(1);
    expect(state.steps[1]?.delaySeconds).toBe(3600);
  });

  it('campanha sem steps abre com um step em branco (nunca lista vazia)', () => {
    const state = toWizardState(detail({ steps: [] }));
    expect(state.steps).toEqual([blankStep()]);
  });

  it('tolera payload degradado (sendWindows nulo, tipo desconhecido, rate zerado)', () => {
    const state = toWizardState(
      detail({
        campaign: {
          ...detail().campaign,
          sendWindows: null,
          type: 'unknown' as CampaignDetail['campaign']['type'],
          rateLimitPerMinute: 0,
        },
      }),
    );

    expect(state.sendWindows).toEqual({ enabled: false });
    expect(state.type).toBe('broadcast');
    expect(state.rateLimitPerMinute).toBe(30);
  });

  it('não traz destinatários do servidor para o CSV da sessão', () => {
    expect(toWizardState(detail()).rows).toEqual([]);
  });
});

describe('toStepsPayload (PUT /steps é delete+insert)', () => {
  it('reindexa posições e devolve os componentes hidratados', () => {
    const steps: StepDraft[] = [
      {
        templateName: '  abertura  ',
        languageCode: 'en_US',
        delaySeconds: -5,
        stopOnReply: false,
        templateComponents: [{ type: 'body' }],
      },
      {
        templateName: 'follow',
        languageCode: '',
        delaySeconds: 120,
        stopOnReply: true,
        templateComponents: [],
      },
    ];

    expect(toStepsPayload(steps)).toEqual([
      {
        position: 0,
        templateName: 'abertura',
        languageCode: 'en_US',
        delaySeconds: 0,
        stopOnReply: false,
        templateComponents: [{ type: 'body' }],
      },
      {
        position: 1,
        templateName: 'follow',
        languageCode: 'pt_BR',
        delaySeconds: 120,
        stopOnReply: true,
        templateComponents: [],
      },
    ]);
  });

  it('round-trip hidratar → persistir não perde nada do servidor', () => {
    const source = detail({
      steps: [
        stepRecord({
          position: 0,
          templateName: 'abertura',
          languageCode: 'es_ES',
          stopOnReply: false,
          delaySeconds: 90,
          templateComponents: [{ type: 'header' }],
        }),
      ],
    });

    expect(toStepsPayload(toWizardState(source).steps)).toEqual([
      {
        position: 0,
        templateName: 'abertura',
        languageCode: 'es_ES',
        delaySeconds: 90,
        stopOnReply: false,
        templateComponents: [{ type: 'header' }],
      },
    ]);
  });
});

describe('stepsAreSafeToPersist (guarda anti-apagamento)', () => {
  it('bloqueia rascunho vazio ou com template em branco', () => {
    expect(stepsAreSafeToPersist([])).toBe(false);
    expect(stepsAreSafeToPersist([blankStep()])).toBe(false);
    expect(
      stepsAreSafeToPersist([{ ...blankStep(), templateName: 'ok' }, blankStep()]),
    ).toBe(false);
  });

  it('libera quando todo step tem template', () => {
    expect(stepsAreSafeToPersist([{ ...blankStep(), templateName: 'promo' }])).toBe(true);
  });
});
