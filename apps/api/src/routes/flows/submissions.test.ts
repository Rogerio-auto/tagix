/**
 * Teste de integracao do handler de Meta Flow submission (F4-S14). Semeia workspace+channel
 * +flow no Postgres dev (owner bypassa RLS) e exercita o caminho: resolve -> persiste ->
 * dispara. A engine e injetada (fake) para nao acoplar ao runtime real.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { closeDb, getDb, schema } from '@hm/db';
import { createLogger } from '@hm/logger';
import {
  processMetaFlowSubmission,
  type MetaFlowSubmissionInput,
  type SubmissionDeps,
} from './submissions';

const { workspaces, channels, flows, flowSubmissions } = schema;
const logger = createLogger('error');

let wsId = '';
const phoneNumberId = `pnid-${randomUUID().slice(0, 8)}`;
const META_FLOW_ID = `mf-${randomUUID().slice(0, 8)}`;

beforeAll(async () => {
  const db = getDb();
  const suffix = randomUUID().slice(0, 8);
  const [ws] = await db
    .insert(workspaces)
    .values({ name: 'S14', slug: `s14-${suffix}` })
    .returning();
  if (!ws) throw new Error('falha ws');
  wsId = ws.id;

  const [ch] = await db
    .insert(channels)
    .values({
      workspaceId: wsId,
      provider: 'meta_whatsapp',
      name: 'WA',
      phoneNumberId,
      wabaId: `waba-${suffix}`,
    })
    .returning();
  if (!ch) throw new Error('falha channel');

  // Flow ativo com trigger flow_submission casando o meta_flow_id.
  await db.insert(flows).values({
    workspaceId: wsId,
    name: 'Pos-flow',
    status: 'active',
    triggerType: 'flow_submission',
    triggerConfig: { meta_flow_id: META_FLOW_ID },
  });
});

afterAll(async () => {
  const db = getDb();
  if (wsId) await db.delete(workspaces).where(eq(workspaces.id, wsId));
  await closeDb();
});

function deps(triggerFlow = vi.fn(async () => ({ executionId: 'e1' }))): SubmissionDeps & {
  triggerFlow: ReturnType<typeof vi.fn>;
} {
  return { engine: { triggerFlow }, logger, triggerFlow };
}

const baseInput = (): MetaFlowSubmissionInput => ({
  phoneNumberId,
  metaFlowId: META_FLOW_ID,
  externalId: `wamid-${randomUUID().slice(0, 8)}`,
  response: { rating: 5 },
});

describe('processMetaFlowSubmission', () => {
  it('resolve canal, persiste e dispara o flow correspondente', async () => {
    const d = deps();
    const input = baseInput();
    const r = await processMetaFlowSubmission(input, d);
    expect(r).toMatchObject({ resolved: true, persisted: true, deduped: false, triggered: 1 });
    expect(d.triggerFlow).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: wsId, triggeredBy: 'automatic' }),
    );
    const rows = await getDb()
      .select()
      .from(flowSubmissions)
      .where(eq(flowSubmissions.externalId, input.externalId as string));
    expect(rows).toHaveLength(1);
  });

  it('dedup: mesma external_id nao re-persiste nem re-dispara', async () => {
    const d = deps();
    const input = baseInput();
    await processMetaFlowSubmission(input, d);
    const second = await processMetaFlowSubmission(input, deps());
    expect(second).toMatchObject({ deduped: true, persisted: false, triggered: 0 });
  });

  it('sem flow correspondente: persiste e no-op (sem erro)', async () => {
    const d = deps();
    const r = await processMetaFlowSubmission({ ...baseInput(), metaFlowId: 'nao-existe' }, d);
    expect(r).toMatchObject({ resolved: true, persisted: true, triggered: 0 });
    expect(d.triggerFlow).not.toHaveBeenCalled();
  });

  it('canal nao resolvido: resolved=false, nada persistido', async () => {
    const d = deps();
    const r = await processMetaFlowSubmission({ ...baseInput(), phoneNumberId: 'inexistente' }, d);
    expect(r).toMatchObject({ resolved: false, persisted: false, triggered: 0 });
  });
});
