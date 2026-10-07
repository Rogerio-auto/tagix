/**
 * F69-S10 — workspace de demonstração do App Review.
 *  - puro: nenhum dado do seed pode ser de pessoa real (DDD 00, `example.com`);
 *  - guarda de alvo com o prefixo `APP_REVIEW` (a regra em si é testada pela Arcada);
 *  - Postgres dev, sob RLS: 1ª rodada cria tudo, 2ª não cria nada, e o que existe bate.
 */
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, getDb } from '../client';
import { withWorkspace } from '../rls';
import { contactTags, contacts, deals, pipelines, stages, workspaces } from '../schema';
import {
  APP_REVIEW_DEMO_SOURCE,
  DEMO_CONTACTS,
  DEMO_DEALS,
  DEMO_PIPELINE_NAME,
  seedAppReviewDemo,
} from './app_review_demo';
import { parseWorkspaceSlug } from './app_review_demo.run';
import { assertSeedTarget } from './target-guard';

describe('App Review demo — nenhum dado real', () => {
  it('todo telefone usa o DDD 00, que não existe no Brasil', () => {
    for (const c of DEMO_CONTACTS) expect(c.phone).toMatch(/^\+5500\d{9}$/);
  });

  it('todo e-mail é do domínio reservado example.com', () => {
    for (const c of DEMO_CONTACTS) expect(c.email).toMatch(/@example\.com$/);
  });

  it('todo negócio aponta para um contato da demonstração', () => {
    const keys = new Set(DEMO_CONTACTS.map((c) => c.key));
    for (const d of DEMO_DEALS) expect(keys.has(d.contactKey)).toBe(true);
  });
});

describe('App Review demo — CLI', () => {
  it('exige --workspace com slug válido', () => {
    expect(parseWorkspaceSlug(['--workspace', 'revisor-meta'])).toBe('revisor-meta');
    expect(() => parseWorkspaceSlug([])).toThrow(/Uso:/);
    expect(() => parseWorkspaceSlug(['--workspace', 'DROP TABLE'])).toThrow(/Uso:/);
  });

  it('banco de produção exige as duas confirmações APP_REVIEW_*', () => {
    const opts = { envPrefix: 'APP_REVIEW', label: 'o seed de demonstração' };
    const DATABASE_URL = 'postgres://u:p@10.0.0.5:5432/leadium';
    expect(() => assertSeedTarget({ DATABASE_URL }, opts)).toThrow(
      /APP_REVIEW_SEED_ALLOW_REMOTE=1 e APP_REVIEW_SEED_CONFIRM_DATABASE/,
    );
    expect(
      assertSeedTarget(
        {
          DATABASE_URL,
          APP_REVIEW_SEED_ALLOW_REMOTE: '1',
          APP_REVIEW_SEED_CONFIRM_DATABASE: 'leadium',
        },
        opts,
      ),
    ).toEqual({ host: '10.0.0.5', database: 'leadium' });
  });
});

describe.skipIf(!process.env['DATABASE_URL'])('App Review demo — seed no banco (dev)', () => {
  const sfx = randomUUID().slice(0, 8);
  let ws = '';

  beforeAll(async () => {
    const [w] = await getDb()
      .insert(workspaces)
      .values({ name: `Revisor ${sfx}`, slug: `revisor-${sfx}` })
      .returning({ id: workspaces.id });
    if (!w) throw new Error('Falha ao criar workspace de teste.');
    ws = w.id;
  });

  afterAll(async () => {
    if (ws) await getDb().delete(workspaces).where(eq(workspaces.id, ws));
    await closeDb();
  });

  it('1ª rodada cria tudo; 2ª não cria nada', async () => {
    const first = await withWorkspace(ws, (tx) => seedAppReviewDemo(tx, ws));
    expect(first.inserted).toEqual({
      contacts: DEMO_CONTACTS.length,
      tags: 4,
      contactTags: DEMO_CONTACTS.reduce((n, c) => n + c.tags.length, 0),
      stages: 5,
      deals: DEMO_DEALS.length,
    });

    const second = await withWorkspace(ws, (tx) => seedAppReviewDemo(tx, ws));
    expect(second.inserted).toEqual({ contacts: 0, tags: 0, contactTags: 0, stages: 0, deals: 0 });
    expect(second.pipelineId).toBe(first.pipelineId);
  });

  it('o que ficou no banco é só a demonstração, marcada pela origem', async () => {
    const db = getDb();
    const [cs, ds, ps, ss, ls] = await Promise.all([
      db.select().from(contacts).where(eq(contacts.workspaceId, ws)),
      db.select().from(deals).where(eq(deals.workspaceId, ws)),
      db.select().from(pipelines).where(eq(pipelines.workspaceId, ws)),
      db.select().from(stages).where(eq(stages.workspaceId, ws)),
      db.select().from(contactTags).where(eq(contactTags.workspaceId, ws)),
    ]);
    expect(cs).toHaveLength(DEMO_CONTACTS.length);
    expect(cs.every((c) => c.source === APP_REVIEW_DEMO_SOURCE)).toBe(true);
    expect(ds).toHaveLength(DEMO_DEALS.length);
    expect(ds.every((d) => d.source === APP_REVIEW_DEMO_SOURCE)).toBe(true);
    expect(ps.map((p) => p.name)).toEqual([DEMO_PIPELINE_NAME]);
    expect(ss).toHaveLength(5);
    expect(ls.length).toBeGreaterThan(0);
  });
});
