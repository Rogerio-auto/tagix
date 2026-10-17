/**
 * F73-S03 — `/api/copilot/me`, `/me/prefs` e a porta comum `copilotAvailable`, com o router
 * REAL (`createCopilotRouter`) sobre o Postgres de dev e a sessão do MockAuthProvider.
 *
 * - US$ só com `copilot.view_costs` (AGENT, SUPERVISOR sem; OWNER com);
 * - view-as → 403 `copilot_unavailable_impersonation` em TODAS as rotas `/api/copilot/*`;
 * - Copiloto desligado → 403 `copilot_disabled`; desligado para o papel → `/me` informa e o
 *   resto recusa.
 */
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import express, { type Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, schema, withWorkspace } from '@hm/db';
import { CopilotMeSchema } from '@hm/shared';
import {
  seedCopilotWorkspace,
  type SeededWorkspace,
} from '../../../services/copilot/identity/test-fixtures';
import { createCopilotRouter } from '../index';

let seeded: SeededWorkspace;

function buildApp(options: { impersonate?: boolean } = {}): Express {
  const app = express();
  app.use(express.json());
  if (options.impersonate) {
    // Simula o middleware de view-as já resolvido (F26-S05) para isolar a porta do Copiloto.
    app.use((req, _res, next) => {
      req.impersonation = {
        sessionId: randomUUID(),
        targetWorkspaceId: seeded.workspaceId,
        adminMemberId: randomUUID(),
        mode: 'view',
      };
      next();
    });
  }
  app.use(createCopilotRouter());
  return app;
}

async function setSettings(values: {
  enabled?: boolean;
  capabilityMatrix?: Record<string, Record<string, boolean>>;
}) {
  await withWorkspace(seeded.workspaceId, (tx) =>
    tx
      .insert(schema.copilotSettings)
      .values({ workspaceId: seeded.workspaceId, ...values })
      .onConflictDoUpdate({ target: schema.copilotSettings.workspaceId, set: values }),
  );
}

async function resetSettings() {
  await withWorkspace(seeded.workspaceId, (tx) =>
    tx
      .delete(schema.copilotSettings)
      .where(eq(schema.copilotSettings.workspaceId, seeded.workspaceId)),
  );
}

beforeAll(async () => {
  seeded = await seedCopilotWorkspace({ label: 'Me' });
});

afterAll(async () => {
  await seeded?.cleanup();
  await closeDb();
});

describe('GET /api/copilot/me', () => {
  const app = () => buildApp();

  it('sem sessão → 401', async () => {
    expect((await request(app()).get('/api/copilot/me')).status).toBe(401);
  });

  it('AGENT: capacidades efetivas, preferências herdadas, sem valores em US$', async () => {
    const res = await request(app())
      .get('/api/copilot/me')
      .set('Cookie', seeded.members.AGENT.cookie);
    expect(res.status).toBe(200);
    const me = CopilotMeSchema.parse(res.body);
    expect(me).toMatchObject({
      available: true,
      unavailable_reason: null,
      role: 'AGENT',
      role_label: 'Atendente',
      read_only: false,
      prefs: {
        auto_open: 'daily',
        auto_open_source: 'workspace',
        surface: 'bubble',
        first_use_hint_seen: false,
      },
      permissions: { manage: false, view_costs: false },
    });
    expect(me.capabilities['deal.move']).toEqual({ allowed: true });
    expect(me.capabilities['campaign.cancel']).toEqual({ allowed: false, reason: 'role' });
    expect(me.budget.state).toBe('ok');
    expect(me.budget.resets_on).toMatch(/^\d{4}-\d{2}-01$/);
    expect(me.budget).not.toHaveProperty('spent_usd');
    expect(me.budget).not.toHaveProperty('cap_usd');
  });

  it('SUPERVISOR: também sem US$', async () => {
    const res = await request(app())
      .get('/api/copilot/me')
      .set('Cookie', seeded.members.SUPERVISOR.cookie);
    expect(res.status).toBe(200);
    expect(res.body.budget).not.toHaveProperty('spent_usd');
    expect(res.body.budget).not.toHaveProperty('cap_usd');
    expect(res.body.permissions).toMatchObject({ memory_edit: true, view_costs: false });
  });

  it('OWNER: com copilot.view_costs recebe gasto e teto', async () => {
    const res = await request(app())
      .get('/api/copilot/me')
      .set('Cookie', seeded.members.OWNER.cookie);
    expect(res.status).toBe(200);
    expect(res.body.budget).toMatchObject({ spent_usd: 0, cap_usd: 30, state: 'ok' });
    expect(res.body.permissions).toMatchObject({ manage: true, view_costs: true });
  });

  it('assinatura inativa → read_only: true (GET passa no guard)', async () => {
    const { getDb } = await import('@hm/db');
    await getDb()
      .update(schema.workspaces)
      .set({ subscriptionStatus: 'expired' })
      .where(eq(schema.workspaces.id, seeded.workspaceId));
    try {
      const res = await request(app())
        .get('/api/copilot/me')
        .set('Cookie', seeded.members.OWNER.cookie);
      expect(res.status).toBe(200);
      expect(res.body.read_only).toBe(true);
    } finally {
      await getDb()
        .update(schema.workspaces)
        .set({ subscriptionStatus: 'active' })
        .where(eq(schema.workspaces.id, seeded.workspaceId));
    }
  });
});

describe('PATCH /api/copilot/me/prefs', () => {
  const app = () => buildApp();

  it('grava, resolve e volta a herdar com auto_open: null', async () => {
    const cookie = seeded.members.AGENT.cookie;
    const set = await request(app())
      .patch('/api/copilot/me/prefs')
      .set('Cookie', cookie)
      .send({ auto_open: 'never', surface: 'docked', first_use_hint_seen: true });
    expect(set.status).toBe(200);
    expect(set.body.prefs).toMatchObject({
      auto_open: 'never',
      auto_open_source: 'member',
      surface: 'docked',
      first_use_hint_seen: true,
    });
    const me = await request(app()).get('/api/copilot/me').set('Cookie', cookie);
    expect(me.body.prefs).toMatchObject({ auto_open: 'never', surface: 'docked' });

    const back = await request(app())
      .patch('/api/copilot/me/prefs')
      .set('Cookie', cookie)
      .send({ auto_open: null });
    expect(back.body.prefs).toMatchObject({ auto_open: 'daily', auto_open_source: 'workspace' });
  });

  it('corpo inválido, vazio ou com campo de animação (F76) → 400', async () => {
    const cookie = seeded.members.AGENT.cookie;
    for (const body of [
      {},
      { surface: 'fullscreen' },
      { animation: 'off' },
      { first_use_hint_seen: false },
    ]) {
      const res = await request(app())
        .patch('/api/copilot/me/prefs')
        .set('Cookie', cookie)
        .send(body);
      expect(res.status).toBe(400);
    }
  });
});

describe('copilotAvailable — view-as', () => {
  const routes: readonly [method: 'get' | 'post' | 'patch' | 'put', path: string][] = [
    ['get', '/api/copilot/me'],
    ['patch', '/api/copilot/me/prefs'],
    ['get', '/api/copilot/settings'],
    ['put', '/api/copilot/settings'],
    ['post', '/api/copilot/sessions'],
    ['get', '/api/copilot/sessions'],
    ['post', `/api/copilot/sessions/${randomUUID()}/messages`],
    ['post', `/api/copilot/proposals/${randomUUID()}/confirm`],
    ['get', '/api/copilot/activity'],
    ['get', '/api/copilot/memory/facts'],
    ['get', '/api/copilot/briefing/today'],
    ['get', '/api/copilot/autopilot/rules'],
    ['get', '/api/copilot/usage'],
  ];

  it.each(routes)('%s %s → 403 copilot_unavailable_impersonation', async (method, path) => {
    const agent = request(buildApp({ impersonate: true }));
    const send = agent[method].bind(agent);
    const res = await send(path).set('Cookie', seeded.members.OWNER.cookie).send({});
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('copilot_unavailable_impersonation');
  });
});

describe('copilotAvailable — desligado', () => {
  it('Copiloto desligado → 403 copilot_disabled (inclusive /me)', async () => {
    await setSettings({ enabled: false });
    try {
      const app = buildApp();
      for (const path of ['/api/copilot/me', '/api/copilot/sessions']) {
        const res = await request(app).get(path).set('Cookie', seeded.members.AGENT.cookie);
        expect(res.status).toBe(403);
        expect(res.body.error).toBe('copilot_disabled');
      }
      // A tela de configurações continua acessível para quem pode religar.
      const settings = await request(app)
        .get('/api/copilot/settings')
        .set('Cookie', seeded.members.OWNER.cookie);
      expect(settings.status).toBe(200);
      expect(settings.body.enabled).toBe(false);
    } finally {
      await resetSettings();
    }
  });

  it('desligado para o papel: /me informa (available: false), o resto recusa', async () => {
    await setSettings({ capabilityMatrix: { AGENT: { use: false } } });
    try {
      const app = buildApp();
      const me = await request(app)
        .get('/api/copilot/me')
        .set('Cookie', seeded.members.AGENT.cookie);
      expect(me.status).toBe(200);
      expect(me.body).toMatchObject({ available: false, unavailable_reason: 'disabled_for_role' });
      expect(me.body.capabilities.query).toEqual({ allowed: false, reason: 'disabled_by_owner' });
      const prefs = await request(app)
        .patch('/api/copilot/me/prefs')
        .set('Cookie', seeded.members.AGENT.cookie)
        .send({ surface: 'docked' });
      expect(prefs.status).toBe(403);
      expect(prefs.body.error).toBe('copilot_disabled_for_role');
      // Outro papel segue normal.
      const sup = await request(app)
        .get('/api/copilot/me')
        .set('Cookie', seeded.members.SUPERVISOR.cookie);
      expect(sup.body.available).toBe(true);
    } finally {
      await resetSettings();
    }
  });
});
