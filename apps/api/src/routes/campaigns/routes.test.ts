import express from 'express';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { closeDb } from '@hm/db';
import { createCampaignsRouter } from './index';
import { validateCampaign, type ValidationCampaign, type ValidationGraphPorts } from './validate';

const app = express();
app.use(express.json());
app.use(createCampaignsRouter());

afterAll(async () => {
  await closeDb();
});

const ID = '00000000-0000-0000-0000-000000000001';

describe('rotas de campanhas (autorizacao)', () => {
  it('GET /api/campaigns sem sessao -> 401', async () => {
    expect((await request(app).get('/api/campaigns')).status).toBe(401);
  });
  it('POST /api/campaigns sem sessao -> 401', async () => {
    expect((await request(app).post('/api/campaigns').send({})).status).toBe(401);
  });
  it('POST /api/campaigns/:id/validate sem sessao -> 401', async () => {
    expect((await request(app).post('/api/campaigns/' + ID + '/validate').send({})).status).toBe(401);
  });
  it('POST /api/campaigns/:id/activate sem sessao -> 401', async () => {
    expect((await request(app).post('/api/campaigns/' + ID + '/activate').send({})).status).toBe(401);
  });
  it('POST /api/campaigns/:id/pause sem sessao -> 401', async () => {
    expect((await request(app).post('/api/campaigns/' + ID + '/pause').send({})).status).toBe(401);
  });
  it('GET /api/campaigns/:id/metrics sem sessao -> 401', async () => {
    expect((await request(app).get('/api/campaigns/' + ID + '/metrics')).status).toBe(401);
  });
});

// --- Validacao pre-flight (compliance). Graph MOCKADO: nao ha WABA real no dev. ---
function baseWa(overrides: Partial<ValidationCampaign> = {}): ValidationCampaign {
  return {
    id: ID,
    provider: 'meta_whatsapp',
    steps: [{ templateName: 'promo', languageCode: 'pt_BR' }],
    recipientCount: 10,
    recipientsWithoutOptIn: 0,
    recipientsWithoutPriorInteraction: 0,
    sendWindowsEnabled: true,
    rateLimitPerMinute: 30,
    ...overrides,
  };
}

function ports(opts: {
  status?: string;
  category?: string;
  quality?: string;
  tierLimit?: number;
}): ValidationGraphPorts {
  return {
    fetchTemplate: async () => ({
      name: 'promo',
      status: (opts.status ?? 'APPROVED') as never,
      category: (opts.category ?? 'UTILITY') as never,
    }),
    fetchQuality: async () => ({
      qualityRating: (opts.quality ?? 'GREEN') as never,
      tierLimit: opts.tierLimit ?? 1000,
    }),
  };
}

describe('validateCampaign (compliance dura)', () => {
  it('campanha WA saudavel -> safe=true, sem criticos', async () => {
    const r = await validateCampaign(baseWa(), ports({}));
    expect(r.safe).toBe(true);
    expect(r.criticalIssues).toHaveLength(0);
  });

  it('sem steps -> critical', async () => {
    const r = await validateCampaign(baseWa({ steps: [] }), ports({}));
    expect(r.safe).toBe(false);
    expect(r.criticalIssues.some((m) => m.includes('Nenhum step'))).toBe(true);
  });

  it('template nao-APPROVED -> critical', async () => {
    const r = await validateCampaign(baseWa(), ports({ status: 'PENDING' }));
    expect(r.safe).toBe(false);
    expect(r.criticalIssues.some((m) => m.includes('nao esta APROVADO'))).toBe(true);
  });

  it('MARKETING + recipients sem opt-in -> critical', async () => {
    const r = await validateCampaign(
      baseWa({ recipientsWithoutOptIn: 3 }),
      ports({ category: 'MARKETING' }),
    );
    expect(r.safe).toBe(false);
    expect(r.criticalIssues.some((m) => m.includes('sem opt-in para MARKETING'))).toBe(true);
  });

  it('MARKETING com opt-in completo -> safe', async () => {
    const r = await validateCampaign(
      baseWa({ recipientsWithoutOptIn: 0 }),
      ports({ category: 'MARKETING' }),
    );
    expect(r.safe).toBe(true);
  });

  it('quality RED -> critical (bloqueia)', async () => {
    const r = await validateCampaign(baseWa(), ports({ quality: 'RED' }));
    expect(r.safe).toBe(false);
    expect(r.criticalIssues.some((m) => m.includes('RED'))).toBe(true);
  });

  it('quality YELLOW -> warning (nao bloqueia)', async () => {
    const r = await validateCampaign(baseWa(), ports({ quality: 'YELLOW' }));
    expect(r.safe).toBe(true);
    expect(r.warnings.some((m) => m.includes('YELLOW'))).toBe(true);
  });

  it('recipients > tierLimit -> critical', async () => {
    const r = await validateCampaign(baseWa({ recipientCount: 5000 }), ports({ tierLimit: 1000 }));
    expect(r.safe).toBe(false);
    expect(r.criticalIssues.some((m) => m.includes('tier limit'))).toBe(true);
  });

  it('send windows desabilitada -> warning', async () => {
    const r = await validateCampaign(baseWa({ sendWindowsEnabled: false }), ports({}));
    expect(r.warnings.some((m) => m.includes('Send windows'))).toBe(true);
  });

  it('rate alto (>60) -> warning', async () => {
    const r = await validateCampaign(baseWa({ rateLimitPerMinute: 120 }), ports({}));
    expect(r.warnings.some((m) => m.includes('Rate limit alto'))).toBe(true);
  });

  it('IG: step com template_name -> critical', async () => {
    const r = await validateCampaign(
      baseWa({ provider: 'meta_instagram' }),
      ports({}),
    );
    expect(r.safe).toBe(false);
    expect(r.criticalIssues.some((m) => m.includes('Instagram nao tem templates'))).toBe(true);
  });

  it('IG: recipients sem interacao previa -> critical', async () => {
    const r = await validateCampaign(
      baseWa({
        provider: 'meta_instagram',
        steps: [{ templateName: '', languageCode: 'pt_BR' }],
        recipientsWithoutPriorInteraction: 4,
      }),
      ports({}),
    );
    expect(r.safe).toBe(false);
    expect(r.criticalIssues.some((m) => m.includes('sem interacao previa'))).toBe(true);
  });
});
