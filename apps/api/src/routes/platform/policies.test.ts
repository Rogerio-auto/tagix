/**
 * F25-S03 — editor de workspace_agent_policies por workspace (infra dev real).
 *
 * - Gate (sem sessão → 401; não-admin → 403).
 * - GET cria policy default se ausente.
 * - PUT atualiza, registra updated_by + audit_logs, valida allowed_models ⊆
 *   whitelist ativa e default ∈ allowed.
 */
import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, getDb, schema } from '@hm/db';
import { SESSION_COOKIE } from '../../auth/session';
import { createPlatformPoliciesRouter } from './policies';

const { workspaces, members, workspaceAgentPolicies, llmModelsWhitelist, auditLogs } = schema;

let ws = '';
let adminId = '';
let adminCookie = '';
let userCookie = '';
const SLUG_OK = `pol-vendor/ok-${randomUUID().slice(0, 6)}`;
const SLUG_INACTIVE = `pol-vendor/off-${randomUUID().slice(0, 6)}`;

const app = express();
app.use(express.json());
app.use(createPlatformPoliciesRouter());

const cookieFor = (a: string, e: string) =>
  `${SESSION_COOKIE}=${encodeURIComponent(
    Buffer.from(JSON.stringify({ authUserId: a, email: e, iat: Date.now() })).toString('base64url'),
  )}`;
const adminReq = (m: 'get' | 'put', p: string) => request(app)[m](p).set('Cookie', adminCookie);

beforeAll(async () => {
  const db = getDb();
  const sfx = randomUUID().slice(0, 8);
  const [w] = await db.insert(workspaces).values({ name: `Pol ${sfx}`, slug: `pol-${sfx}` }).returning();
  ws = w!.id;

  const aAuth = randomUUID();
  const aEmail = `padmin-${sfx}@t.local`;
  const [a] = await db
    .insert(members)
    .values({ workspaceId: ws, authUserId: aAuth, email: aEmail, role: 'OWNER', status: 'active', isPlatformAdmin: true })
    .returning();
  adminId = a!.id;
  adminCookie = cookieFor(aAuth, aEmail);

  const uAuth = randomUUID();
  const uEmail = `puser-${sfx}@t.local`;
  await db.insert(members).values({ workspaceId: ws, authUserId: uAuth, email: uEmail, role: 'OWNER', status: 'active' });
  userCookie = cookieFor(uAuth, uEmail);

  await db.insert(llmModelsWhitelist).values([
    { slug: SLUG_OK, displayName: 'OK', upstreamProvider: 'pol-vendor', isActive: true },
    { slug: SLUG_INACTIVE, displayName: 'Off', upstreamProvider: 'pol-vendor', isActive: false },
  ]);
});

afterAll(async () => {
  const db = getDb();
  await db.delete(llmModelsWhitelist).where(eq(llmModelsWhitelist.slug, SLUG_OK));
  await db.delete(llmModelsWhitelist).where(eq(llmModelsWhitelist.slug, SLUG_INACTIVE));
  if (ws) await db.delete(workspaces).where(eq(workspaces.id, ws));
  await closeDb();
});

describe('gate', () => {
  it('sem sessão → 401', async () => {
    expect((await request(app).get('/api/platform/workspaces')).status).toBe(401);
  });
  it('não-admin → 403', async () => {
    expect((await request(app).get('/api/platform/workspaces').set('Cookie', userCookie)).status).toBe(403);
  });
});

describe('GET policy', () => {
  it('cria default no GET se ausente', async () => {
    const res = await adminReq('get', `/api/platform/workspaces/${ws}/agent-policy`);
    expect(res.status).toBe(200);
    expect(res.body.policy.workspaceId).toBe(ws);
    expect(res.body.policy.maxIterations).toBeGreaterThan(0);
    const [row] = await getDb()
      .select()
      .from(workspaceAgentPolicies)
      .where(eq(workspaceAgentPolicies.workspaceId, ws));
    expect(row).toBeDefined();
  });
  it('workspace inexistente → 404', async () => {
    expect((await adminReq('get', `/api/platform/workspaces/${randomUUID()}/agent-policy`)).status).toBe(404);
  });
});

describe('PUT policy', () => {
  it('atualiza, grava updated_by + audit', async () => {
    const res = await adminReq('put', `/api/platform/workspaces/${ws}/agent-policy`).send({
      allowedModels: [SLUG_OK],
      defaultChatModel: SLUG_OK,
      allowVision: true,
      maxTokensPerCall: 4000,
      maxMonthlyCostUsd: 250.5,
      allowedToolCategories: ['database', 'knowledge'],
    });
    expect(res.status).toBe(200);
    expect(res.body.policy.allowedModels).toEqual([SLUG_OK]);
    expect(res.body.policy.allowVision).toBe(true);
    expect(res.body.policy.maxMonthlyCostUsd).toBe(250.5);
    expect(res.body.policy.updatedBy).toBe(adminId);

    const audit = await getDb()
      .select()
      .from(auditLogs)
      .where(
        and(eq(auditLogs.resourceId, ws), eq(auditLogs.action, 'platform.agent_policy_updated')),
      );
    expect(audit.length).toBeGreaterThanOrEqual(1);
    expect(audit[0]!.actorType).toBe('platform_admin');
  });

  it('rejeita allowed_models fora da whitelist ativa (400)', async () => {
    const res = await adminReq('put', `/api/platform/workspaces/${ws}/agent-policy`).send({
      allowedModels: [SLUG_INACTIVE],
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('models_not_in_active_whitelist');
  });

  it('rejeita default_chat_model fora de allowed_models (400)', async () => {
    const res = await adminReq('put', `/api/platform/workspaces/${ws}/agent-policy`).send({
      allowedModels: [SLUG_OK],
      defaultChatModel: 'nao/existe',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('default_model_not_allowed');
  });

  it('rejeita cap negativo (400)', async () => {
    const res = await adminReq('put', `/api/platform/workspaces/${ws}/agent-policy`).send({
      maxIterations: -1,
    });
    expect(res.status).toBe(400);
  });
});
