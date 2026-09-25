/**
 * F70-S21 — o envio de teste do criador de campanhas (`prepareTestSend`) grava o job de
 * envio na outbox, na transação da mensagem `pending` (Postgres dev, RLS real do
 * `withWorkspace`):
 *  - commit: conversa, mensagem `pending` e UM job `template` em `hm.q.outbound`;
 *  - replay (mesma chave de idempotência): nenhum job novo;
 *  - rollback forçado depois de todo o trabalho, antes do COMMIT: nem a mensagem nem
 *    o job ficam.
 *
 * A rota em volta (validação, contexto do modelo, render) é coberta por
 * `routes.test.ts`; aqui o alvo é a transação.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type * as Db from '@hm/db';
import type { BuilderTemplateContext } from './service';
import type { SafeTemplatePreview } from './render';

const rollback = vi.hoisted(() => ({ armed: false }));
vi.mock('@hm/db', async (importOriginal) => {
  const actual = await importOriginal<typeof Db>();
  const { armableWithWorkspace } = await import('../../deals/__tests__/forced-rollback');
  return { ...actual, withWorkspace: armableWithWorkspace(actual.withWorkspace, rollback) };
});

const { closeDb, getDb, schema, withWorkspace } = await import('@hm/db');
const { dropTenants, seedTenant } = await import('../../deals/__tests__/two-workspaces');
const { outboxJobsOf } = await import('../../conversations/__tests__/outbox-jobs');
type TenantFixture = Awaited<ReturnType<typeof seedTenant>>;
const { prepareTestSend } = await import('./index');

const CAMPAIGN = randomUUID();
const TEMPLATE = randomUUID();

let A: TenantFixture;

/**
 * Só o que `prepareTestSend` lê do contexto (canal da campanha, id e nome do modelo).
 * O resto do contexto é carregado e validado pela rota antes de chegar aqui.
 */
function context(): BuilderTemplateContext {
  return {
    campaign: { id: CAMPAIGN, channelId: A.channel },
    template: { id: TEMPLATE, name: 'oferta' },
  } as unknown as BuilderTemplateContext;
}

const PREVIEW: SafeTemplatePreview = {
  header: null,
  body: 'Olá cliente',
  footer: null,
  buttons: [],
  variables: [],
  outbound: { kind: 'template', templateName: 'oferta', languageCode: 'pt_BR', components: [] },
};

function prepare(to: string, idempotencyKey: string) {
  return withWorkspace(A.ws, (tx) =>
    prepareTestSend(tx, {
      workspaceId: A.ws,
      memberId: A.member,
      campaignId: CAMPAIGN,
      to,
      idempotencyKey,
      context: context(),
      preview: PREVIEW,
    }),
  );
}

/** Telefone E.164 único por teste (a conversa é chaveada por canal + número). */
function phone(): string {
  return `+55119${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
}

beforeAll(async () => {
  A = await seedTenant('A');
});

afterAll(async () => {
  rollback.armed = false;
  await dropTenants(A);
  await closeDb();
});

beforeEach(() => {
  rollback.armed = false;
});

describe('prepareTestSend → job de envio na outbox (F70-S21)', () => {
  it('commit: a mensagem pending e UM job template, no shape do worker', async () => {
    const to = phone();
    const before = (await outboxJobsOf(A.ws)).length;

    const prepared = await prepare(to, randomUUID());
    expect(prepared?.kind).toBe('created');
    if (prepared?.kind !== 'created') return;

    const jobs = await outboxJobsOf(A.ws);
    expect(jobs).toHaveLength(before + 1);
    const job = jobs.find((j) => j.payload['messageId'] === prepared.message.id);
    expect(job).toMatchObject({ exchange: '', routingKey: 'hm.q.outbound', type: 'outbound.job' });
    expect(job?.payload).toEqual({
      kind: 'template',
      templateName: 'oferta',
      languageCode: 'pt_BR',
      components: [],
      channelId: A.channel,
      conversationId: prepared.message.conversationId,
      messageId: prepared.message.id,
      chatId: to.slice(1),
    });
  });

  it('replay pela mesma chave: devolve a mensagem e não grava outro job', async () => {
    const to = phone();
    const key = randomUUID();
    const first = await prepare(to, key);
    expect(first?.kind).toBe('created');
    const count = (await outboxJobsOf(A.ws)).length;

    const again = await prepare(to, key);
    expect(again?.kind).toBe('replay');
    expect(await outboxJobsOf(A.ws)).toHaveLength(count);
  });

  it('rollback: nem a mensagem nem o job ficam', async () => {
    const to = phone();
    const before = (await outboxJobsOf(A.ws)).length;

    rollback.armed = true;
    await expect(prepare(to, randomUUID())).rejects.toThrow(/rollback forçado/);
    rollback.armed = false;

    const rows = await getDb()
      .select({ id: schema.conversations.id })
      .from(schema.conversations)
      .where(
        and(eq(schema.conversations.workspaceId, A.ws), eq(schema.conversations.remoteId, to.slice(1))),
      );
    expect(rows).toHaveLength(0);
    expect(await outboxJobsOf(A.ws)).toHaveLength(before);
  });
});
