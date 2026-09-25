/**
 * Fixture de teste F70-S11: dois workspaces REAIS (A e B) no Postgres dev, cada um com
 * o conjunto completo de alvos de referência, e a auth mockada fiel (mesma estratégia
 * de `pipeline/deal-attribution.test.ts`): `requireRole` usa o `can()` REAL e `withRLS`
 * injeta `req.scoped = withWorkspace`.
 *
 * Uso num arquivo de teste:
 *   vi.mock('../../middlewares/auth', async () =>
 *     (await import('../deals/__tests__/two-workspaces')).authMiddlewareMock());
 *
 * Não é um arquivo de teste (sem `.test.ts`): só é importado por eles.
 */
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { eq, inArray } from 'drizzle-orm';
import { can, type Permission, type Role } from '@hm/shared';
import { getDb, schema, withWorkspace } from '@hm/db';

export interface TenantFixture {
  readonly ws: string;
  readonly member: string;
  readonly otherMember: string;
  readonly contact: string;
  readonly channel: string;
  readonly conversation: string;
  /** Segunda conversa, sem card: usada para provar que o dono cria o próprio card. */
  readonly freeConversation: string;
  readonly pipeline: string;
  readonly stage: string;
  readonly otherPipeline: string;
  readonly otherStage: string;
  readonly deal: string;
  readonly team: string;
  readonly agent: string;
  readonly flow: string;
  readonly conversionType: string;
  readonly conversionTypeKey: string;
  readonly kbDocument: string;
  readonly kbChunk: string;
  readonly calendar: string;
}

interface Session {
  workspaceId: string;
  memberId: string;
  role: Role;
}

let session: Session | null = null;

/** Autentica as próximas requisições como o OWNER do workspace dado. */
export function actAs(t: TenantFixture, role: Role = 'OWNER'): void {
  session = { workspaceId: t.ws, memberId: t.member, role };
}

/** Módulo substituto de `middlewares/auth` (para `vi.mock`). */
export function authMiddlewareMock(): Record<string, unknown> {
  return {
    requireAuth: (req: Request, res: Response, next: NextFunction) => {
      if (!session) {
        res.status(401).json({ message: 'Não autenticado.' });
        return;
      }
      req.auth = {
        workspace: { id: session.workspaceId, timezone: 'America/Sao_Paulo' },
        member: { id: session.memberId, role: session.role },
      } as Request['auth'];
      next();
    },
    withRLS: (req: Request, res: Response, next: NextFunction) => {
      if (!req.auth) {
        res.status(401).json({ message: 'Não autenticado.' });
        return;
      }
      const wsId = req.auth.workspace.id;
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
}

function one<T>(rows: readonly T[], what: string): T {
  const row = rows[0];
  if (!row) throw new Error(`fixture: falha ao criar ${what}`);
  return row;
}

/** Semeia um workspace completo (como dono do banco, fora da RLS). */
export async function seedTenant(label: string): Promise<TenantFixture> {
  const db = getDb();
  const sfx = randomUUID().slice(0, 8);
  const ws = one(
    await db
      .insert(schema.workspaces)
      .values({ name: `F70S11 ${label}`, slug: `f70s11-${label.toLowerCase()}-${sfx}` })
      .returning(),
    'workspace',
  );
  const member = one(
    await db
      .insert(schema.members)
      .values({
        workspaceId: ws.id,
        authUserId: randomUUID(),
        email: `owner-${sfx}@f70s11.test`,
        role: 'OWNER',
        status: 'active',
      })
      .returning(),
    'member',
  );
  const otherMember = one(
    await db
      .insert(schema.members)
      .values({
        workspaceId: ws.id,
        authUserId: randomUUID(),
        email: `agent-${sfx}@f70s11.test`,
        role: 'AGENT',
        status: 'active',
      })
      .returning(),
    'member 2',
  );
  const contact = one(
    await db
      .insert(schema.contacts)
      .values({ workspaceId: ws.id, displayName: `Contato ${label}` })
      .returning(),
    'contact',
  );
  const channel = one(
    await db
      .insert(schema.channels)
      .values({
        workspaceId: ws.id,
        provider: 'meta_whatsapp',
        name: `WA ${label} ${sfx}`,
        phoneNumberId: `pn-f70s11-${sfx}`,
        wabaId: `waba-f70s11-${sfx}`,
      })
      .returning(),
    'channel',
  );
  const conversation = one(
    await db
      .insert(schema.conversations)
      .values({
        workspaceId: ws.id,
        channelId: channel.id,
        contactId: contact.id,
        remoteId: `c1-${sfx}`,
      })
      .returning(),
    'conversation',
  );
  const freeConversation = one(
    await db
      .insert(schema.conversations)
      .values({
        workspaceId: ws.id,
        channelId: channel.id,
        contactId: contact.id,
        remoteId: `c2-${sfx}`,
      })
      .returning(),
    'conversation 2',
  );
  const pipeline = one(
    await db
      .insert(schema.pipelines)
      .values({ workspaceId: ws.id, name: 'Vendas', isDefault: true })
      .returning(),
    'pipeline',
  );
  const otherPipeline = one(
    await db.insert(schema.pipelines).values({ workspaceId: ws.id, name: 'Pós-venda' }).returning(),
    'pipeline 2',
  );
  const stage = one(
    await db
      .insert(schema.stages)
      .values({ workspaceId: ws.id, pipelineId: pipeline.id, name: 'Novo', position: 0 })
      .returning(),
    'stage',
  );
  const otherStage = one(
    await db
      .insert(schema.stages)
      .values({ workspaceId: ws.id, pipelineId: otherPipeline.id, name: 'Onboarding', position: 0 })
      .returning(),
    'stage 2',
  );
  const deal = one(
    await db
      .insert(schema.deals)
      .values({
        workspaceId: ws.id,
        pipelineId: pipeline.id,
        stageId: stage.id,
        contactId: contact.id,
        title: `Deal ${label}`,
      })
      .returning(),
    'deal',
  );
  const team = one(
    await db
      .insert(schema.teams)
      .values({ workspaceId: ws.id, name: `Time ${label}` })
      .returning(),
    'team',
  );
  const agent = one(
    await db
      .insert(schema.agents)
      .values({ workspaceId: ws.id, name: `Agente ${label}`, systemPrompt: 'x' })
      .returning(),
    'agent',
  );
  const flow = one(
    await db
      .insert(schema.flows)
      .values({
        workspaceId: ws.id,
        name: `Flow ${label}`,
        triggerType: 'manual',
        status: 'active',
      })
      .returning(),
    'flow',
  );
  const conversionType = one(
    await db
      .insert(schema.conversionTypes)
      .values({ workspaceId: ws.id, key: `venda_${sfx}`, label: 'Venda' })
      .returning(),
    'conversion type',
  );
  const kbDocument = one(
    await db
      .insert(schema.kbDocuments)
      .values({
        workspaceId: ws.id,
        title: `Doc ${label}`,
        source: 'manual',
        rawContent: '# doc',
        contentSha256: sfx.padEnd(64, '0'),
      })
      .returning(),
    'kb document',
  );
  const kbChunk = one(
    await db
      .insert(schema.kbChunks)
      .values({
        workspaceId: ws.id,
        documentId: kbDocument.id,
        chunkIndex: 0,
        content: 'x',
        contentTokens: 1,
      })
      .returning(),
    'kb chunk',
  );
  const calendar = one(
    await db
      .insert(schema.calendars)
      .values({
        workspaceId: ws.id,
        name: `Agenda ${label}`,
        type: 'workspace',
        ownerId: member.id,
      })
      .returning(),
    'calendar',
  );
  return {
    ws: ws.id,
    member: member.id,
    otherMember: otherMember.id,
    contact: contact.id,
    channel: channel.id,
    conversation: conversation.id,
    freeConversation: freeConversation.id,
    pipeline: pipeline.id,
    stage: stage.id,
    otherPipeline: otherPipeline.id,
    otherStage: otherStage.id,
    deal: deal.id,
    team: team.id,
    agent: agent.id,
    flow: flow.id,
    conversionType: conversionType.id,
    conversionTypeKey: conversionType.key,
    kbDocument: kbDocument.id,
    kbChunk: kbChunk.id,
    calendar: calendar.id,
  };
}

/**
 * Apaga os workspaces semeados. Tabelas com FK `restrict` (histórico de deal, eventos de
 * conversão) saem antes; o resto cascateia a partir do workspace.
 */
export async function dropTenants(
  ...tenants: readonly (TenantFixture | undefined)[]
): Promise<void> {
  const ids = tenants.filter((t): t is TenantFixture => t !== undefined).map((t) => t.ws);
  if (ids.length === 0) return;
  const db = getDb();
  await db.delete(schema.conversionEvents).where(inArray(schema.conversionEvents.workspaceId, ids));
  await db.delete(schema.dealHistory).where(inArray(schema.dealHistory.workspaceId, ids));
  await db.delete(schema.events).where(inArray(schema.events.workspaceId, ids));
  await db.delete(schema.deals).where(inArray(schema.deals.workspaceId, ids));
  for (const id of ids) await db.delete(schema.workspaces).where(eq(schema.workspaces.id, id));
}

/** UUID que não existe em lugar nenhum (o "controle" do teste de oráculo). */
export function ghostId(): string {
  return randomUUID();
}
