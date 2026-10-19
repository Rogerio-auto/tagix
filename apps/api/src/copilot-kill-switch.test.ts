/**
 * F73-S17 — chave global do Copiloto (`COPILOT_ENABLED`).
 *
 * - `parseCopilotEnabled`: ausente/inválido em produção = DESLIGADO; dev/teste = ligado.
 * - `createApp`: desligado ⇒ `/api/copilot/*` e o callback interno `/internal/copilot/*` nem são
 *   montados (404 do roteador padrão); ligado ⇒ as portas existem (401 sem credencial).
 * - `createApiServer`: desligado ⇒ sweeper, briefing e alerta de orçamento NÃO sobem, nem com a
 *   opção explícita; ligado ⇒ sobem.
 */
import request from 'supertest';
import type * as ProposalsModule from './services/copilot/proposals';
import type * as BriefingModule from './services/copilot/briefing';
import type * as UsageModule from './services/copilot/usage';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { closeDb } from '@hm/db';

const mocks = vi.hoisted(() => {
  const stoppable = () => ({ stop: async (): Promise<void> => undefined });
  return {
    startProposalSweeper: vi.fn(stoppable),
    startBriefingScheduler: vi.fn(stoppable),
    startBudgetAlertScheduler: vi.fn(stoppable),
  };
});

vi.mock('./services/copilot/proposals', async (importOriginal) => ({
  ...(await importOriginal<typeof ProposalsModule>()),
  startProposalSweeper: mocks.startProposalSweeper,
}));
vi.mock('./services/copilot/briefing', async (importOriginal) => ({
  ...(await importOriginal<typeof BriefingModule>()),
  startBriefingScheduler: mocks.startBriefingScheduler,
}));
vi.mock('./services/copilot/usage', async (importOriginal) => ({
  ...(await importOriginal<typeof UsageModule>()),
  startBudgetAlertScheduler: mocks.startBudgetAlertScheduler,
}));
// Sem Redis/Socket.io reais: o que importa aqui são os trabalhos de fundo.
vi.mock('./socket', () => ({
  createSocketServer: () => ({ close: () => undefined }),
}));

import { createApp } from './app';
import { closeHealth } from './health';
import { parseCopilotEnabled } from './config';
import { createApiServer } from './server';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

afterAll(async () => {
  await closeHealth();
  await closeDb();
});

describe('parseCopilotEnabled', () => {
  const cases: ReadonlyArray<readonly [string, NodeJS.ProcessEnv, boolean]> = [
    ['produção sem a variável → desligado', { NODE_ENV: 'production' }, false],
    [
      'produção com a variável vazia → desligado',
      { NODE_ENV: 'production', COPILOT_ENABLED: '' },
      false,
    ],
    [
      'produção com valor inválido → desligado',
      { NODE_ENV: 'production', COPILOT_ENABLED: 'yes' },
      false,
    ],
    [
      'produção com "1" (não é booleano estrito) → desligado',
      { NODE_ENV: 'production', COPILOT_ENABLED: '1' },
      false,
    ],
    ['produção com "true" → ligado', { NODE_ENV: 'production', COPILOT_ENABLED: 'true' }, true],
    [
      'produção com "TRUE " (caixa/espaço) → ligado',
      { NODE_ENV: 'production', COPILOT_ENABLED: 'TRUE ' },
      true,
    ],
    [
      'produção com "false" → desligado',
      { NODE_ENV: 'production', COPILOT_ENABLED: 'false' },
      false,
    ],
    ['desenvolvimento sem a variável → ligado', { NODE_ENV: 'development' }, true],
    ['sem NODE_ENV e sem a variável → ligado (dev)', {}, true],
    ['teste sem a variável → ligado', { NODE_ENV: 'test' }, true],
    ['teste com "false" → desligado', { NODE_ENV: 'test', COPILOT_ENABLED: 'false' }, false],
    [
      'desenvolvimento com valor inválido → desligado (falha fechada)',
      { NODE_ENV: 'development', COPILOT_ENABLED: 'flase' },
      false,
    ],
  ];
  it.each(cases)('%s', (_name, env, expected) => {
    expect(parseCopilotEnabled(env)).toBe(expected);
  });
});

describe('createApp — portas do Copiloto', () => {
  it('desligado: /api/copilot/* e o callback interno respondem 404', async () => {
    vi.stubEnv('COPILOT_ENABLED', 'false');
    const app = createApp();
    for (const path of ['/api/copilot/me', '/api/copilot/sessions', '/api/copilot/briefing']) {
      const res = await request(app).get(path);
      expect(res.status, path).toBe(404);
    }
    const internal = await request(app).post('/internal/copilot/tools/search_contacts').send({});
    expect(internal.status).toBe(404);
    // Cookie de sessão não muda nada: a rota não existe.
    const withCookie = await request(app).get('/api/copilot/me').set('Cookie', 'hm_session=x');
    expect(withCookie.status).toBe(404);
  });

  it('produção sem COPILOT_ENABLED: 404 (falha fechada)', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('COPILOT_ENABLED', '');
    vi.stubEnv('COPILOT_GRANT_SECRET', 'k'.repeat(48));
    vi.stubEnv('AGENT_RUNTIME_TOKEN', 'tok-diferente-do-segredo-do-grant');
    const app = createApp();
    expect((await request(app).get('/api/copilot/me')).status).toBe(404);
    expect(
      (await request(app).post('/internal/copilot/tools/search_contacts').send({})).status,
    ).toBe(404);
  });

  it('ligado: as portas existem (401 sem credencial, não 404)', async () => {
    vi.stubEnv('COPILOT_ENABLED', 'true');
    const app = createApp();
    expect((await request(app).get('/api/copilot/me')).status).toBe(401);
    const internal = await request(app).post('/internal/copilot/tools/search_contacts').send({});
    expect(internal.status).not.toBe(404);
  });

  it('dev/teste sem a variável: comportamento atual preservado (ligado)', async () => {
    vi.stubEnv('COPILOT_ENABLED', '');
    const app = createApp();
    expect((await request(app).get('/api/copilot/me')).status).toBe(401);
  });
});

describe('createApiServer — trabalhos de fundo do Copiloto', () => {
  const all = { copilotSweeper: true, copilotBriefing: true, copilotBudgetAlert: true } as const;

  it('desligado: nenhum agendador sobe, nem com a opção explícita', async () => {
    vi.stubEnv('COPILOT_ENABLED', 'false');
    const server = createApiServer(all);
    expect(mocks.startProposalSweeper).not.toHaveBeenCalled();
    expect(mocks.startBriefingScheduler).not.toHaveBeenCalled();
    expect(mocks.startBudgetAlertScheduler).not.toHaveBeenCalled();
    await server.stopBackground();
  });

  it('produção sem COPILOT_ENABLED: nenhum agendador sobe', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('COPILOT_ENABLED', '');
    vi.stubEnv('COPILOT_GRANT_SECRET', 'k'.repeat(48));
    const server = createApiServer();
    expect(mocks.startProposalSweeper).not.toHaveBeenCalled();
    expect(mocks.startBriefingScheduler).not.toHaveBeenCalled();
    expect(mocks.startBudgetAlertScheduler).not.toHaveBeenCalled();
    await server.stopBackground();
  });

  it('ligado: os três agendadores sobem', async () => {
    vi.stubEnv('COPILOT_ENABLED', 'true');
    const server = createApiServer(all);
    expect(mocks.startProposalSweeper).toHaveBeenCalledTimes(1);
    expect(mocks.startBriefingScheduler).toHaveBeenCalledTimes(1);
    expect(mocks.startBudgetAlertScheduler).toHaveBeenCalledTimes(1);
    await server.stopBackground();
  });

  it('ligado em NODE_ENV=test sem opções: continua desligado pelo default de teste', async () => {
    vi.stubEnv('COPILOT_ENABLED', 'true');
    const server = createApiServer();
    expect(mocks.startBriefingScheduler).not.toHaveBeenCalled();
    await server.stopBackground();
  });
});
