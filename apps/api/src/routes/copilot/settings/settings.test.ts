/**
 * F73-S03 — `GET`/`PUT /api/copilot/settings` (`copilot.manage`) com auditoria, pelo router
 * REAL sobre o Postgres de dev.
 */
import { and, desc, eq } from 'drizzle-orm';
import express, { type Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, schema, withWorkspace } from '@hm/db';
import { CopilotSettingsSchema } from '@hm/shared';
import {
  seedCopilotWorkspace,
  type SeededWorkspace,
} from '../../../services/copilot/identity/test-fixtures';
import { createCopilotRouter } from '../index';
import { COPILOT_SETTINGS_AUDIT_ACTION } from './index';

let seeded: SeededWorkspace;
let app: Express;

async function audits() {
  return withWorkspace(seeded.workspaceId, (tx) =>
    tx
      .select()
      .from(schema.auditLogs)
      .where(
        and(
          eq(schema.auditLogs.workspaceId, seeded.workspaceId),
          eq(schema.auditLogs.action, COPILOT_SETTINGS_AUDIT_ACTION),
        ),
      )
      .orderBy(desc(schema.auditLogs.createdAt)),
  );
}

beforeAll(async () => {
  seeded = await seedCopilotWorkspace({ label: 'Settings' });
  app = express();
  app.use(express.json());
  app.use(createCopilotRouter());
});

afterAll(async () => {
  await seeded?.cleanup();
  await closeDb();
});

describe('/api/copilot/settings', () => {
  it('sem copilot.manage (SUPERVISOR, AGENT, READONLY) → 403', async () => {
    for (const role of ['SUPERVISOR', 'AGENT', 'READONLY'] as const) {
      const cookie = seeded.members[role].cookie;
      expect((await request(app).get('/api/copilot/settings').set('Cookie', cookie)).status).toBe(
        403,
      );
      expect(
        (
          await request(app)
            .put('/api/copilot/settings')
            .set('Cookie', cookie)
            .send({ enabled: false })
        ).status,
      ).toBe(403);
    }
  });

  it('GET sem linha gravada → defaults do contrato', async () => {
    const res = await request(app)
      .get('/api/copilot/settings')
      .set('Cookie', seeded.members.ADMIN.cookie);
    expect(res.status).toBe(200);
    expect(CopilotSettingsSchema.parse(res.body)).toMatchObject({
      enabled: true,
      capability_matrix: {},
      monthly_budget_usd: 30,
      budget_mode: 'queries_only',
      budget_alert_pct: 80,
      history_retention_months: 12,
      default_auto_open: 'daily',
      partner_access: false,
      model: null,
      updated_by: null,
      updated_at: null,
    });
  });

  it('PUT parcial grava, devolve o contrato e audita só o que mudou', async () => {
    const owner = seeded.members.OWNER;
    const res = await request(app)
      .put('/api/copilot/settings')
      .set('Cookie', owner.cookie)
      .send({
        monthly_budget_usd: 50,
        budget_mode: 'pause',
        capability_matrix: { AGENT: { 'deal.move': false } },
      });
    expect(res.status).toBe(200);
    const dto = CopilotSettingsSchema.parse(res.body);
    expect(dto).toMatchObject({
      monthly_budget_usd: 50,
      budget_mode: 'pause',
      capability_matrix: { AGENT: { 'deal.move': false } },
      updated_by: { member_id: owner.id },
    });
    expect(dto.updated_at).not.toBeNull();
    expect(JSON.stringify(dto)).not.toContain(owner.email);

    const [audit] = await audits();
    expect(audit).toMatchObject({
      actorMemberId: owner.id,
      actorType: 'member',
      resourceType: 'copilot_settings',
    });
    expect(audit?.metadata).toEqual({
      changes: {
        monthly_budget_usd: { from: 30, to: 50 },
        budget_mode: { from: 'queries_only', to: 'pause' },
        capability_matrix: { 'AGENT.deal.move': { from: null, to: false } },
      },
    });
  });

  it('PUT que não muda nada não grava auditoria', async () => {
    const before = (await audits()).length;
    const res = await request(app)
      .put('/api/copilot/settings')
      .set('Cookie', seeded.members.OWNER.cookie)
      .send({ budget_mode: 'pause' });
    expect(res.status).toBe(200);
    expect((await audits()).length).toBe(before);
  });

  it('contrato: dono não desliga o próprio acesso; model e partner_access: true ficam fora', async () => {
    const cookie = seeded.members.OWNER.cookie;
    for (const body of [
      {},
      { capability_matrix: { OWNER: { use: false } } },
      { model: 'openai/gpt-x' },
      { partner_access: true },
      { enabled: 'sim' },
      { workspace_id: seeded.workspaceId },
    ]) {
      const res = await request(app).put('/api/copilot/settings').set('Cookie', cookie).send(body);
      expect(res.status).toBe(400);
    }
  });

  it('desligar e religar pela própria tela (a porta deixa /settings passar)', async () => {
    const cookie = seeded.members.ADMIN.cookie;
    expect(
      (
        await request(app)
          .put('/api/copilot/settings')
          .set('Cookie', cookie)
          .send({ enabled: false })
      ).status,
    ).toBe(200);
    expect((await request(app).get('/api/copilot/me').set('Cookie', cookie)).body.error).toBe(
      'copilot_disabled',
    );
    const back = await request(app)
      .put('/api/copilot/settings')
      .set('Cookie', cookie)
      .send({ enabled: true });
    expect(back.status).toBe(200);
    expect(back.body.enabled).toBe(true);
    expect((await request(app).get('/api/copilot/me').set('Cookie', cookie)).status).toBe(200);
  });

  it('a exceção vale só para /settings exato: sub-rota com o Copiloto desligado → 403', async () => {
    const cookie = seeded.members.ADMIN.cookie;
    await request(app).put('/api/copilot/settings').set('Cookie', cookie).send({ enabled: false });
    try {
      const exact = ['/api/copilot/settings', '/api/copilot/settings/', '/api/copilot/Settings'];
      for (const path of exact) {
        expect((await request(app).get(path).set('Cookie', cookie)).status).toBe(200);
      }
      for (const path of ['/api/copilot/settings/x', '/api/copilot/settings/x/y']) {
        const res = await request(app).get(path).set('Cookie', cookie);
        expect(res.status).toBe(403);
        expect(res.body.error).toBe('copilot_disabled');
      }
    } finally {
      await request(app).put('/api/copilot/settings').set('Cookie', cookie).send({ enabled: true });
    }
    expect((await request(app).get('/api/copilot/me').set('Cookie', cookie)).status).toBe(200);
  });
});
