import { describe, expect, it } from 'vitest';
import type { schema } from '@hm/db';
import { encodeBindings, type TemplateBinding } from './contracts';
import { runPreflight, type PreflightIssue } from './preflight';
import type { CampaignStepSummary, EstimateBase } from './service';

type CampaignRow = typeof schema.campaigns.$inferSelect;

const NOW = new Date('2026-08-11T12:00:00.000Z');
const HEALTHY = { qualityRating: 'GREEN', tierLimit: 10_000 };

const CATALOG_COMPONENTS = [
  { type: 'BODY', text: 'Olá {{1}}, sua oferta acaba hoje.' },
];

function campaign(overrides: Partial<CampaignRow> = {}): CampaignRow {
  return {
    id: '00000000-0000-0000-0000-0000000000c1',
    workspaceId: '00000000-0000-0000-0000-0000000000a1',
    channelId: '00000000-0000-0000-0000-0000000000b1',
    name: 'Oferta de agosto',
    type: 'broadcast',
    status: 'draft',
    startAt: null,
    endAt: null,
    timezone: 'America/Sao_Paulo',
    sendWindows: { enabled: true, windows: [{ day: 2, start: '09:00', end: '18:00' }] },
    rateLimitPerMinute: 30,
    dailyLimit: 1_000,
    messagesSentToday: 0,
    lastDailyResetAt: null,
    nextTickAt: null,
    autoHandoffOnReply: true,
    aiHandoffAgentId: null,
    segmentId: null,
    createdBy: null,
    createdAt: NOW,
    updatedAt: null,
    ...overrides,
  };
}

const BINDING: TemplateBinding = {
  component: 'body',
  index: 1,
  source: { kind: 'contact', field: 'displayName', fallback: 'cliente' },
};

function step(overrides: Partial<CampaignStepSummary> = {}): CampaignStepSummary {
  return {
    position: 0,
    templateName: 'oferta_agosto',
    languageCode: 'pt_BR',
    delaySeconds: 0,
    templateComponents: encodeBindings([BINDING]),
    category: 'MARKETING',
    status: 'APPROVED',
    isAvailable: true,
    templateComponentsFromCatalog: CATALOG_COMPONENTS,
    ...overrides,
  };
}

function base(overrides: Partial<EstimateBase> = {}): EstimateBase {
  return {
    campaign: campaign(),
    steps: [step()],
    totalDelaySeconds: 0,
    requiresMarketingOptIn: true,
    audience: { total: 100, eligible: 100, invalid: 0, duplicate: 0, optedOut: 0, noConsent: 0 },
    ...overrides,
  };
}

function run(overrides: Partial<EstimateBase> = {}, health = HEALTHY, channelAvailable = true) {
  return runPreflight({
    base: base(overrides),
    channelAvailable,
    health,
    overrides: {},
    now: NOW,
  });
}

function codes(issues: readonly PreflightIssue[], blocking?: boolean): string[] {
  return issues
    .filter((issue) => blocking === undefined || issue.blocking === blocking)
    .map((issue) => issue.code);
}

describe('preflight — pode iniciar?', () => {
  it('campanha saudável libera o início', () => {
    const result = run();
    expect(result.ok).toBe(true);
    expect(codes(result.issues, true)).toEqual([]);
  });

  it('canal desconectado bloqueia e aponta a etapa do canal', () => {
    const result = run({}, HEALTHY, false);
    expect(result.ok).toBe(false);
    const issue = result.issues.find((i) => i.code === 'CAMPAIGN_CHANNEL_NOT_AVAILABLE');
    expect(issue).toMatchObject({ blocking: true, stage: 'channel' });
  });

  it('sem mensagem escolhida, bloqueia na etapa Mensagem', () => {
    const result = run({ steps: [], requiresMarketingOptIn: false });
    expect(codes(result.issues, true)).toContain('CAMPAIGN_NO_MESSAGE');
  });

  it.each([
    ['PENDING', 'está em análise'],
    ['REJECTED', 'precisa de ajustes'],
    ['PAUSED', 'está pausado'],
    ['DISABLED', 'está desativado'],
  ])('modelo %s bloqueia com o motivo em linguagem de produto', (status, label) => {
    const result = run({ steps: [step({ status })] });
    const issue = result.issues.find((i) => i.code === 'CAMPAIGN_TEMPLATE_NOT_APPROVED');
    expect(issue).toMatchObject({ blocking: true, stage: 'message', step: 1 });
    expect(issue?.message).toContain(label);
  });

  it('modelo sumido do catálogo pede sincronização', () => {
    const result = run({ steps: [step({ status: null, category: null, isAvailable: null })] });
    expect(codes(result.issues, true)).toContain('CAMPAIGN_TEMPLATE_NOT_FOUND');
  });

  it('modelo removido no provider bloqueia', () => {
    const result = run({ steps: [step({ isAvailable: false })] });
    expect(codes(result.issues, true)).toContain('CAMPAIGN_TEMPLATE_UNAVAILABLE');
  });

  it('variável sem valor bloqueia e diz qual é', () => {
    const result = run({ steps: [step({ templateComponents: encodeBindings([]) })] });
    const issue = result.issues.find((i) => i.code === 'CAMPAIGN_VARIABLE_MISSING');
    expect(issue).toMatchObject({ blocking: true, stage: 'message', step: 1, component: 'body', index: 1 });
  });

  it('rascunho antigo sem contrato de bindings pede revisão, sem travar', () => {
    const result = run({
      steps: [step({ templateComponents: [{ type: 'body', parameters: [{ type: 'text', text: 'Ana' }] }] })],
    });
    const issue = result.issues.find((i) => i.code === 'CAMPAIGN_VARIABLES_NOT_REVIEWABLE');
    expect(issue).toMatchObject({ blocking: false, step: 1 });
    expect(result.ok).toBe(true);
  });

  it('rascunho sem componente nenhum, com modelo que exige variável, bloqueia', () => {
    const result = run({ steps: [step({ templateComponents: [] })] });
    expect(codes(result.issues, true)).toContain('CAMPAIGN_VARIABLE_MISSING');
  });

  it('contato sem permissão para ofertas bloqueia em MARKETING', () => {
    const result = run({
      audience: { total: 100, eligible: 90, invalid: 0, duplicate: 0, optedOut: 0, noConsent: 10 },
    });
    const issue = result.issues.find((i) => i.code === 'CAMPAIGN_AUDIENCE_WITHOUT_CONSENT');
    expect(issue).toMatchObject({ blocking: true, stage: 'audience' });
    expect(issue?.message).toContain('10 contatos');
  });

  it('modelo transacional não exige permissão de ofertas', () => {
    const result = run({
      steps: [step({ category: 'UTILITY' })],
      requiresMarketingOptIn: false,
      audience: { total: 100, eligible: 100, invalid: 0, duplicate: 0, optedOut: 0, noConsent: 0 },
    });
    expect(codes(result.issues, true)).toEqual([]);
  });

  it('público vazio bloqueia', () => {
    const result = run({
      audience: { total: 10, eligible: 0, invalid: 10, duplicate: 0, optedOut: 0, noConsent: 0 },
    });
    expect(codes(result.issues, true)).toContain('CAMPAIGN_AUDIENCE_EMPTY');
  });

  it('qualidade RED bloqueia; YELLOW só avisa', () => {
    expect(codes(run({}, { qualityRating: 'RED', tierLimit: 10_000 }).issues, true)).toContain(
      'CAMPAIGN_CHANNEL_BLOCKED',
    );
    const yellow = run({}, { qualityRating: 'YELLOW', tierLimit: 10_000 });
    expect(yellow.ok).toBe(true);
    expect(codes(yellow.issues, false)).toContain('CAMPAIGN_CHANNEL_QUALITY_WARNING');
  });

  it('capacidade desconhecida só bloqueia em disparo grande', () => {
    const unknown = { qualityRating: 'UNKNOWN', tierLimit: 0 };
    const small = run(
      { audience: { total: 10, eligible: 10, invalid: 0, duplicate: 0, optedOut: 0, noConsent: 0 } },
      unknown,
    );
    expect(codes(small.issues, true)).not.toContain('CAMPAIGN_PROVIDER_CAPACITY_UNKNOWN');
    const big = run(
      { audience: { total: 5_000, eligible: 5_000, invalid: 0, duplicate: 0, optedOut: 0, noConsent: 0 } },
      unknown,
    );
    expect(codes(big.issues, true)).toContain('CAMPAIGN_PROVIDER_CAPACITY_UNKNOWN');
  });

  it('público acima da capacidade diária do canal bloqueia — igual à ativação', () => {
    const result = run(
      { audience: { total: 500, eligible: 500, invalid: 0, duplicate: 0, optedOut: 0, noConsent: 0 } },
      { qualityRating: 'GREEN', tierLimit: 250 },
    );
    const issue = result.issues.find((i) => i.code === 'CAMPAIGN_AUDIENCE_EXCEEDS_TIER');
    expect(issue).toMatchObject({ blocking: true, stage: 'audience' });
  });

  it('envio único com várias mensagens bloqueia; sequência com uma só avisa', () => {
    const single = run({ steps: [step(), step({ position: 1 })] });
    expect(codes(single.issues, true)).toContain('CAMPAIGN_SINGLE_EXPECTS_ONE_MESSAGE');
    const sequence = run({ campaign: campaign({ type: 'drip' }) });
    expect(codes(sequence.issues, false)).toContain('CAMPAIGN_SEQUENCE_EXPECTS_MORE_MESSAGES');
    expect(sequence.ok).toBe(true);
  });

  it('tipo triggered não passa pela Revisão', () => {
    const result = run({ campaign: campaign({ type: 'triggered' }) });
    expect(codes(result.issues, true)).toContain('CAMPAIGN_TRIGGERED_NOT_AVAILABLE');
  });

  it('sem horários definidos e com ritmo agressivo, avisa sem bloquear', () => {
    const result = run({
      campaign: campaign({ sendWindows: { enabled: false }, rateLimitPerMinute: 120 }),
    });
    expect(codes(result.issues, false)).toEqual(
      expect.arrayContaining(['CAMPAIGN_SEND_WINDOWS_DISABLED', 'CAMPAIGN_RATE_TOO_HIGH']),
    );
    expect(result.ok).toBe(true);
  });

  it('a estimativa acompanha o resultado para a Revisão não pedir outra chamada', () => {
    const result = run();
    expect(result.estimate.messages).toBe(100);
    expect(result.estimate.capacity.providerDailyLimit).toBe(10_000);
    expect(result.estimate.duration.approximateDays).toBeGreaterThan(0);
  });
});
