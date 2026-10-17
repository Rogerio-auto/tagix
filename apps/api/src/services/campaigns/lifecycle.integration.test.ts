/**
 * F73-S09 — ciclo de vida da campanha como serviço (Postgres dev, RLS real).
 *
 * - `pauseCampaign`/`resumeCampaign`: as transições da rota, agora no serviço; a rota
 *   (`POST /api/campaigns/:id/pause|resume`) delega e responde igual (200/404/409).
 * - `cancelCampaign` (novo, estrito, spec §8 R6): recusa sem `campaign.cancel`, recusa
 *   `completed|cancelled|draft`, descarta o que ainda estava na outbox (trigger da 0095),
 *   cancela os follow-ups agendados e devolve os números (já enviadas, que deixaram de sair,
 *   custo `null` porque não há custo por campanha no banco).
 */
import { randomUUID } from 'node:crypto';
import express, { type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { can, type Permission, type Role } from '@hm/shared';

interface Session {
  workspaceId: string;
  memberId: string;
  role: Role;
}
const auth = vi.hoisted(() => ({ session: null as Session | null }));

vi.mock('../../middlewares/auth', async () => {
  const { withWorkspace } = await import('@hm/db');
  return {
    requireAuth: (req: Request, res: Response, next: NextFunction) => {
      const s = auth.session;
      if (!s) {
        res.status(401).json({ message: 'Não autenticado.' });
        return;
      }
      req.auth = {
        workspace: { id: s.workspaceId, timezone: 'America/Sao_Paulo' },
        member: { id: s.memberId, role: s.role },
      } as Request['auth'];
      next();
    },
    withRLS: (req: Request, _res: Response, next: NextFunction) => {
      const wsId = req.auth!.workspace.id;
      (req as unknown as { scoped: <T>(fn: (tx: unknown) => Promise<T>) => Promise<T> }).scoped = (
        fn,
      ) => withWorkspace(wsId, fn as never);
      next();
    },
    requireRole: (perm: Permission) => (req: Request, res: Response, next: NextFunction) => {
      const role = req.auth?.member.role as Role | undefined;
      if (!role || !can(role, perm)) {
        res.status(403).json({ message: 'Sem permissão para esta ação.' });
        return;
      }
      next();
    },
  };
});

const { closeDb, enqueueOutbox, getDb, schema, withWorkspace } = await import('@hm/db');
const { outboundJobOutbox } = await import('../../mq/outbound-publisher');
const { createCampaignsLifecycleRouter } = await import('../../routes/campaigns/lifecycle');
const { cancelCampaign, loadCampaignProgress, pauseCampaign, resumeCampaign } =
  await import('./lifecycle');
const { addCampaign, addRecipient, campaignStatus, seedExternalWorkspace } =
  await import('../../internal/copilot/act-external/test-seed');
type Seed = Awaited<ReturnType<typeof seedExternalWorkspace>>;

const app = express();
app.use(express.json());
app.use(createCampaignsLifecycleRouter());

let seed: Seed;
let other: Seed;

beforeAll(async () => {
  seed = await seedExternalWorkspace({ label: 'S09Life' });
  other = await seedExternalWorkspace({ label: 'S09LifeB' });
});

afterAll(async () => {
  await seed?.cleanup();
  await other?.cleanup();
  await closeDb();
});

function actor(role: Role, s: Seed = seed) {
  return { workspaceId: s.workspaceId, memberId: s.ws.members[role].id, role };
}

function as(role: Role, s: Seed = seed): void {
  auth.session = { workspaceId: s.workspaceId, memberId: s.ws.members[role].id, role };
}

async function lastAudit(campaignId: string, action: string) {
  const rows = await getDb()
    .select()
    .from(schema.auditLogs)
    .where(and(eq(schema.auditLogs.resourceId, campaignId), eq(schema.auditLogs.action, action)));
  return rows.at(-1);
}

describe('pauseCampaign / resumeCampaign (as transições da rota)', () => {
  it('pausa o que está enviando, grava a trilha do membro e recusa o que não pode pausar', async () => {
    const { campaignId } = await addCampaign(seed, { status: 'running' });
    const out = await withWorkspace(seed.workspaceId, (tx) =>
      pauseCampaign(tx, actor('SUPERVISOR'), campaignId, { via: 'copilot', proposalId: null }),
    );
    expect(out.kind).toBe('paused');
    expect(await campaignStatus(campaignId)).toBe('paused');
    const audit = await lastAudit(campaignId, 'campaign.paused');
    expect(audit).toMatchObject({
      actorType: 'member',
      actorMemberId: seed.ws.members.SUPERVISOR.id,
      metadata: { reason: 'manual', message: 'Pausada manualmente.', via: 'copilot' },
    });

    const again = await withWorkspace(seed.workspaceId, (tx) =>
      pauseCampaign(tx, actor('SUPERVISOR'), campaignId),
    );
    expect(again).toEqual({ kind: 'bad_state', status: 'paused' });
    const ghost = await withWorkspace(seed.workspaceId, (tx) =>
      pauseCampaign(tx, actor('SUPERVISOR'), randomUUID()),
    );
    expect(ghost).toEqual({ kind: 'not_found' });
  });

  it('retoma: destinatários "sending" voltam a pending; prazo vencido recusa', async () => {
    const { campaignId, recipientIds } = await addCampaign(seed, { status: 'paused', pending: 1 });
    await getDb()
      .update(schema.campaignRecipients)
      .set({ status: 'sending' })
      .where(eq(schema.campaignRecipients.id, recipientIds[0]!));
    const out = await withWorkspace(seed.workspaceId, (tx) =>
      resumeCampaign(tx, actor('ADMIN'), campaignId),
    );
    expect(out.kind).toBe('resumed');
    expect(await campaignStatus(campaignId)).toBe('running');
    const [rec] = await getDb()
      .select({ status: schema.campaignRecipients.status })
      .from(schema.campaignRecipients)
      .where(eq(schema.campaignRecipients.id, recipientIds[0]!));
    expect(rec?.status).toBe('pending');
    // Trilha da rota preservada (sem `via` quando não veio do Copiloto).
    const audit = await lastAudit(campaignId, 'campaign.resumed');
    expect(audit?.metadata).toEqual({ reason: 'resumed', message: 'Envio retomado.' });

    const ended = await addCampaign(seed, { status: 'paused' });
    await getDb()
      .update(schema.campaigns)
      .set({ endAt: new Date(Date.now() - 60_000) })
      .where(eq(schema.campaigns.id, ended.campaignId));
    const refused = await withWorkspace(seed.workspaceId, (tx) =>
      resumeCampaign(tx, actor('ADMIN'), ended.campaignId),
    );
    expect(refused).toEqual({ kind: 'ended' });
  });
});

describe('rota delega ao serviço sem mudar o comportamento', () => {
  it('POST pause: 200 com a campanha; 409 bad_state; 404 de outro workspace; 403 AGENT', async () => {
    const { campaignId } = await addCampaign(seed, { status: 'scheduled' });
    as('SUPERVISOR');
    const ok = await request(app).post(`/api/campaigns/${campaignId}/pause`);
    expect(ok.status).toBe(200);
    expect(ok.body.campaign).toMatchObject({ id: campaignId, status: 'paused', nextTickAt: null });
    const twice = await request(app).post(`/api/campaigns/${campaignId}/pause`);
    expect(twice.status).toBe(409);
    expect(twice.body).toEqual({
      error: 'bad_state',
      message: 'So campanhas enviando ou agendadas podem ser pausadas.',
      status: 'paused',
    });
    as('SUPERVISOR', other);
    expect((await request(app).post(`/api/campaigns/${campaignId}/pause`)).status).toBe(404);
    as('AGENT');
    expect((await request(app).post(`/api/campaigns/${campaignId}/pause`)).status).toBe(403);
  });

  it('POST resume: 200 de paused; 409 de running; 409 campaign_ended com prazo vencido', async () => {
    const { campaignId } = await addCampaign(seed, { status: 'paused' });
    as('ADMIN');
    const ok = await request(app).post(`/api/campaigns/${campaignId}/resume`);
    expect(ok.status).toBe(200);
    expect(ok.body.campaign.status).toBe('running');
    const bad = await request(app).post(`/api/campaigns/${campaignId}/resume`);
    expect(bad.status).toBe(409);
    expect(bad.body.error).toBe('bad_state');

    const ended = await addCampaign(seed, { status: 'paused' });
    await getDb()
      .update(schema.campaigns)
      .set({ endAt: new Date(Date.now() - 60_000) })
      .where(eq(schema.campaigns.id, ended.campaignId));
    const late = await request(app).post(`/api/campaigns/${ended.campaignId}/resume`);
    expect(late.status).toBe(409);
    expect(late.body.error).toBe('campaign_ended');
  });
});

describe('cancelCampaign (estrito)', () => {
  it('recusa sem campaign.cancel (SUPERVISOR, AGENT) e não toca a campanha', async () => {
    const { campaignId } = await addCampaign(seed, { status: 'running' });
    for (const role of ['SUPERVISOR', 'AGENT', 'READONLY'] as const) {
      const out = await withWorkspace(seed.workspaceId, (tx) =>
        cancelCampaign(tx, actor(role), campaignId),
      );
      expect(out).toEqual({ kind: 'forbidden' });
    }
    expect(await campaignStatus(campaignId)).toBe('running');
  });

  it('recusa completed, cancelled e draft (bad_state com o status)', async () => {
    for (const status of ['completed', 'cancelled', 'draft']) {
      const { campaignId } = await addCampaign(seed, { status });
      const out = await withWorkspace(seed.workspaceId, (tx) =>
        cancelCampaign(tx, actor('ADMIN'), campaignId),
      );
      expect(out).toEqual({ kind: 'bad_state', status });
      expect(await campaignStatus(campaignId)).toBe(status);
    }
  });

  it('cancela: descarta o job ainda na outbox, cancela follow-ups e informa os números', async () => {
    const { campaignId, recipientIds } = await addCampaign(seed, {
      status: 'running',
      sent: 2,
      pending: 3,
    });
    // Um envio "em fila": delivery queued + mensagem pending + job na outbox (não publicado).
    const target = await addRecipient(seed, { name: 'Na fila' });
    const db = getDb();
    const [recipient] = await db
      .insert(schema.campaignRecipients)
      .values({
        workspaceId: seed.workspaceId,
        campaignId,
        contactId: target.contactId,
        status: 'completed',
      })
      .returning();
    const [step] = await db
      .select({ id: schema.campaignSteps.id })
      .from(schema.campaignSteps)
      .where(eq(schema.campaignSteps.campaignId, campaignId));
    const [message] = await db
      .insert(schema.messages)
      .values({
        workspaceId: seed.workspaceId,
        conversationId: target.conversationId,
        direction: 'outbound',
        senderType: 'system',
        type: 'template',
        content: 'promo',
        viewStatus: 'pending',
      })
      .returning();
    await db.insert(schema.campaignDeliveries).values({
      workspaceId: seed.workspaceId,
      campaignId,
      recipientId: recipient!.id,
      stepId: step!.id,
      messageId: message!.id,
      status: 'queued',
      idempotencyKey: `s09-q-${randomUUID()}`,
    });
    await db.transaction((tx) =>
      enqueueOutbox(
        tx,
        outboundJobOutbox(seed.workspaceId, {
          kind: 'template',
          channelId: seed.channelId,
          conversationId: target.conversationId,
          messageId: message!.id,
          chatId: 'x',
          templateName: 'promo',
          languageCode: 'pt_BR',
          components: [],
        }),
      ),
    );
    // Um follow-up agendado.
    const [followup] = await db
      .insert(schema.campaignFollowups)
      .values({ campaignId, triggerEvent: 'on_no_reply', templateName: 'lembrete' })
      .returning();
    const [scheduled] = await db
      .insert(schema.scheduledFollowups)
      .values({
        workspaceId: seed.workspaceId,
        campaignId,
        recipientId: recipientIds[0]!,
        followupId: followup!.id,
        scheduledAt: new Date(Date.now() + 3600_000),
      })
      .returning();

    const progress = await withWorkspace(seed.workspaceId, (tx) =>
      loadCampaignProgress(tx, campaignId),
    );
    expect(progress).toMatchObject({ alreadySent: 2, scheduled: 3, costUsed: null });

    const out = await withWorkspace(seed.workspaceId, (tx) =>
      cancelCampaign(tx, actor('ADMIN'), campaignId, { via: 'copilot', proposalId: null }),
    );
    if (out.kind !== 'cancelled') throw new Error(`cancel: ${out.kind}`);
    // 3 pendentes + 1 job descartado + 1 follow-up.
    expect(out).toMatchObject({ already_sent: 2, cancelled_scheduled: 5, cost_used: null });
    expect(await campaignStatus(campaignId)).toBe('cancelled');

    const [delivery] = await db
      .select()
      .from(schema.campaignDeliveries)
      .where(eq(schema.campaignDeliveries.messageId, message!.id));
    expect(delivery).toMatchObject({ status: 'failed', errorCode: 'campaign_cancelled' });
    const [fu] = await db
      .select({ status: schema.scheduledFollowups.status })
      .from(schema.scheduledFollowups)
      .where(eq(schema.scheduledFollowups.id, scheduled!.id));
    expect(fu?.status).toBe('cancelled');
    const audit = await lastAudit(campaignId, 'campaign.cancelled');
    expect(audit).toMatchObject({
      actorType: 'member',
      actorMemberId: seed.ws.members.ADMIN.id,
      metadata: { from: 'running', already_sent: 2, cancelled_scheduled: 5, via: 'copilot' },
    });

    // Segunda tentativa: já cancelada.
    const again = await withWorkspace(seed.workspaceId, (tx) =>
      cancelCampaign(tx, actor('ADMIN'), campaignId),
    );
    expect(again).toEqual({ kind: 'bad_state', status: 'cancelled' });
  });

  it('cross-tenant: campanha de outro workspace é not_found', async () => {
    const { campaignId } = await addCampaign(other, { status: 'running' });
    const out = await withWorkspace(seed.workspaceId, (tx) =>
      cancelCampaign(tx, actor('OWNER'), campaignId),
    );
    expect(out).toEqual({ kind: 'not_found' });
    expect(await campaignStatus(campaignId)).toBe('running');
  });
});
