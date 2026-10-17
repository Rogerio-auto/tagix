/**
 * F73-S09 — linhas da checagem de política (puro), uma por regra: janela de envio, consentimento,
 * conversa de 24 h, modelo aprovado, variáveis, destinatários, agendamento e campanha.
 */
import { describe, expect, it } from 'vitest';
import type { PolicyCheck } from '@hm/shared';
import type { CampaignProgress } from '../../../services/campaigns/lifecycle';
import type { SendMessagesArgs } from './message-args';
import { campaignPolicy, messagePolicy } from './policy';
import type {
  EvaluationContext,
  RecipientEvaluation,
  RecipientSkip,
  TemplateRow,
} from './recipients';

const ID = '11111111-1111-4111-8111-111111111111';
const TEXT: SendMessagesArgs = { contact_ids: [ID], content: { kind: 'text', text: 'Oi' } };
const TPL: SendMessagesArgs = {
  contact_ids: [ID],
  content: { kind: 'template', template_id: ID, variables: [] },
};
const TEMPLATE: TemplateRow = {
  id: ID,
  channelId: ID,
  name: 'lembrete_consulta',
  language: 'pt_BR',
  category: 'UTILITY',
  status: 'APPROVED',
  isAvailable: true,
  components: [],
  provider: 'meta_whatsapp',
};
const CTX: EvaluationContext = {
  workspace: { market: 'BR', timezone: 'America/Sao_Paulo', locale: 'pt-BR' },
  template: null,
  templateProblem: null,
  recipientCount: 1,
};
/** 12:00 em São Paulo (dentro do horário comercial). */
const NOON = new Date('2026-10-17T15:00:00Z');

function ev(skip: RecipientSkip | null, n = 0): RecipientEvaluation {
  return {
    targetId: `${n}`,
    label: `Pessoa ${n}`,
    conversationId: skip?.kind === 'no_conversation' ? null : ID,
    provider: 'meta_whatsapp',
    purpose: 'transactional',
    eventVersion: null,
    skip,
    text: skip ? null : 'Oi',
    template: null,
  };
}

const many = (n: number, skip: RecipientSkip | null = null) =>
  Array.from({ length: n }, (_, i) => ev(skip, i));

function row(checks: readonly PolicyCheck[], key: string): PolicyCheck | undefined {
  return checks.find((c) => c.key === key);
}

const consent: RecipientSkip = {
  kind: 'consent',
  code: 'suppressed',
  reason: 'pediu para não receber',
};
const quiet: RecipientSkip = { kind: 'quiet_hours', code: 'quiet_hours', reason: 'fora da janela' };
const closed: RecipientSkip = { kind: 'window_closed', code: 'window_closed', reason: 'fechada' };

describe('messagePolicy', () => {
  it('tudo certo: ok em todas as linhas', () => {
    const checks = messagePolicy(TEXT, CTX, many(3), NOON);
    expect(checks.map((c) => [c.key, c.status])).toEqual([
      ['send_window', 'ok'],
      ['consent', 'ok'],
      ['window_24h', 'ok'],
      ['recipients', 'ok'],
    ]);
    expect(row(checks, 'send_window')?.detail).toContain('12:00 em Sao Paulo');
  });

  it('send_window: fora do horário comercial do workspace = warn; parte fora da janela legal = warn; todos = block', () => {
    const night = new Date('2026-10-18T02:00:00Z'); // 23:00 em São Paulo
    expect(row(messagePolicy(TEXT, CTX, many(2), night), 'send_window')?.status).toBe('warn');
    const some = [...many(2), ev(quiet, 9)];
    const partial = row(messagePolicy(TEXT, CTX, some, NOON), 'send_window');
    expect(partial).toMatchObject({ status: 'warn' });
    expect(partial?.detail).toContain('1 de 3');
    expect(row(messagePolicy(TEXT, CTX, many(2, quiet), NOON), 'send_window')?.status).toBe(
      'block',
    );
  });

  it('consent: "11 de 12 · 1 será pulado"; ninguém pode = block', () => {
    const items = [...many(11), ev(consent, 99)];
    const c = row(messagePolicy(TEXT, CTX, items, NOON), 'consent');
    expect(c).toMatchObject({ status: 'warn' });
    expect(c?.detail).toContain('11 de 12 · 1 será pulado');
    expect(row(messagePolicy(TEXT, CTX, many(2, consent), NOON), 'consent')?.status).toBe('block');
  });

  it('window_24h: texto livre com conversa fechada = block; modelo aprovado = ok', () => {
    const items = [ev(null), ev(closed, 1)];
    expect(row(messagePolicy(TEXT, CTX, items, NOON), 'window_24h')?.status).toBe('block');
    const tplChecks = messagePolicy(TPL, { ...CTX, template: TEMPLATE }, many(2), NOON);
    expect(row(tplChecks, 'window_24h')?.status).toBe('ok');
    expect(row(tplChecks, 'template_approved')).toMatchObject({ status: 'ok' });
    expect(row(tplChecks, 'template_approved')?.detail).toContain('lembrete_consulta');
  });

  it('template_approved: problema do modelo = block', () => {
    const checks = messagePolicy(
      TPL,
      {
        ...CTX,
        template: { ...TEMPLATE, status: 'REJECTED' },
        templateProblem: 'Modelo "x" não está aprovado (REJECTED).',
      },
      many(1, { kind: 'template', code: 'template_unavailable', reason: 'modelo indisponível' }),
      NOON,
    );
    expect(row(checks, 'template_approved')?.status).toBe('block');
    expect(row(checks, 'recipients')?.status).toBe('block');
  });

  it('variáveis e destinatários sem conversa: warn com a contagem; agendamento: warn', () => {
    const items = [
      ev(null),
      ev({ kind: 'variable', code: 'missing_hora', reason: 'sem horário de avaliação' }, 1),
      ev({ kind: 'no_conversation', code: 'no_conversation', reason: 'sem conversa' }, 2),
    ];
    const checks = messagePolicy({ ...TEXT, send_at: '2026-10-18T12:00:00Z' }, CTX, items, NOON);
    expect(row(checks, 'variables')).toMatchObject({ status: 'warn' });
    expect(row(checks, 'variables')?.detail).toContain('1 de 3 sem horário de avaliação');
    expect(row(checks, 'recipients')).toMatchObject({ status: 'warn' });
    expect(row(checks, 'schedule')).toMatchObject({ status: 'warn' });
    expect(row(checks, 'schedule')?.detail).toContain('09:00');
  });

  it('nenhuma linha de saldo de mensagens (o conceito não existe no produto)', () => {
    const keys = messagePolicy(TEXT, CTX, many(1), NOON).map((c) => c.key);
    expect(keys.some((k) => k.includes('balance') || k.includes('saldo'))).toBe(false);
  });
});

describe('campaignPolicy', () => {
  const progress: CampaignProgress = {
    id: ID,
    name: 'Clareamento',
    status: 'running',
    updatedAt: null,
    endAt: null,
    recipients: 840,
    alreadySent: 512,
    scheduled: 328,
    costUsed: null,
  };

  it('cancelar: enviadas e agendadas em aviso; custo só para quem vê custo (null = sem registro)', () => {
    const checks = campaignPolicy('cancel', progress, { canSeeCosts: true });
    expect(checks).toEqual([
      {
        key: 'campaign_status',
        status: 'ok',
        label: 'Status da campanha',
        detail: 'Enviando agora.',
      },
      {
        key: 'already_sent',
        status: 'warn',
        label: 'Já enviadas',
        detail: '512 de 840 já saíram e não voltam.',
      },
      {
        key: 'scheduled',
        status: 'warn',
        label: 'Agendadas',
        detail: '328 ainda iam sair; com o cancelamento, não saem mais.',
      },
      {
        key: 'cost_used',
        status: 'ok',
        label: 'Custo já usado',
        detail: 'Custo por campanha ainda não é registrado.',
      },
    ]);
    expect(
      campaignPolicy('cancel', progress, { canSeeCosts: false }).some((c) => c.key === 'cost_used'),
    ).toBe(false);
  });

  it('transição inválida = block (cancelar concluída, retomar enviando)', () => {
    expect(
      campaignPolicy('cancel', { ...progress, status: 'completed' }, { canSeeCosts: false })[0]
        ?.status,
    ).toBe('block');
    expect(campaignPolicy('resume', progress, { canSeeCosts: false })[0]?.status).toBe('block');
    expect(campaignPolicy('pause', progress, { canSeeCosts: false })[0]?.status).toBe('ok');
  });
});
