/**
 * F73-S03 — view-as ponta a ponta pelo `createApp()` REAL (ADR-003 §5): sessão de
 * impersonation ativa no banco, cookie `hm_impersonation` e o middleware de view-as de
 * verdade (sem simular `req.impersonation`).
 *
 * Ordem real na aplicação: o view-as (F26-S05) roda ANTES das rotas de workspace e já
 * recusa toda escrita com `impersonation_read_only`; os GETs chegam à porta do Copiloto,
 * que recusa com `copilot_unavailable_impersonation`. Nos dois casos, nada do Copiloto roda.
 */
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, getDb, impersonationSessionsRepo, schema } from '@hm/db';
import type { Express } from 'express';
import { createApp } from '../../../app';
import { closeCache } from '../../../cache';
import { closeHealth } from '../../../health';
import { IMPERSONATION_COOKIE } from '../../../middlewares/impersonation';
import {
  seedCopilotWorkspace,
  type SeededWorkspace,
} from '../../../services/copilot/identity/test-fixtures';

let admin: SeededWorkspace;
let target: SeededWorkspace;
let app: Express;
let viewAsCookie = '';

beforeAll(async () => {
  admin = await seedCopilotWorkspace({ label: 'ViewAs admin' });
  target = await seedCopilotWorkspace({ label: 'ViewAs target' });
  await getDb()
    .update(schema.members)
    .set({ isPlatformAdmin: true })
    .where(eq(schema.members.id, admin.members.OWNER.id));
  const session = await impersonationSessionsRepo.create({
    adminMemberId: admin.members.OWNER.id,
    targetWorkspaceId: target.workspaceId,
    reason: 'suporte: teste do Copiloto sob view-as',
    expiresAt: new Date(Date.now() + 30 * 60 * 1000),
  });
  viewAsCookie = `${admin.members.OWNER.cookie}; ${IMPERSONATION_COOKIE}=${session.id}`;
  app = createApp();
});

afterAll(async () => {
  // Cascata: a sessão de impersonation cai com o membro/workspace.
  await admin?.cleanup();
  await target?.cleanup();
  await closeCache();
  await closeHealth();
  await closeDb();
});

describe('Copiloto sob view-as (createApp real)', () => {
  it('controle: o mesmo admin sem o cookie de view-as usa o Copiloto normalmente', async () => {
    const res = await request(app).get('/api/copilot/me').set('Cookie', admin.members.OWNER.cookie);
    expect(res.status).toBe(200);
  });

  it.each(['/api/copilot/me', '/api/copilot/settings', '/api/copilot/sessions'])(
    'GET %s → 403 copilot_unavailable_impersonation',
    async (path) => {
      const res = await request(app).get(path).set('Cookie', viewAsCookie);
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('copilot_unavailable_impersonation');
      expect(JSON.stringify(res.body)).not.toContain(target.workspaceId);
    },
  );

  it.each([
    ['post', '/api/copilot/sessions'],
    ['post', `/api/copilot/sessions/${randomUUID()}/messages`],
    ['patch', '/api/copilot/me/prefs'],
    ['put', '/api/copilot/settings'],
  ] as const)('%s %s → 403 sem chegar ao Copiloto', async (method, path) => {
    const agent = request(app);
    const res = await agent[method](path).set('Cookie', viewAsCookie).send({});
    expect(res.status).toBe(403);
    // A trava de escrita do view-as responde antes da porta do Copiloto.
    expect(res.body.error).toBe('impersonation_read_only');
  });

  it('nenhuma escrita no Copiloto do tenant-alvo nem do admin', async () => {
    for (const ws of [admin.workspaceId, target.workspaceId]) {
      const sessions = await getDb()
        .select({ id: schema.copilotSessions.id })
        .from(schema.copilotSessions)
        .where(eq(schema.copilotSessions.workspaceId, ws));
      expect(sessions).toHaveLength(0);
      const settings = await getDb()
        .select({ ws: schema.copilotSettings.workspaceId })
        .from(schema.copilotSettings)
        .where(eq(schema.copilotSettings.workspaceId, ws));
      expect(settings).toHaveLength(0);
    }
  });
});
