/**
 * F38-S03 — leitor da Central de Ajuda. Integração real contra Postgres dev.
 * Cobre: só artigos publicados retornam, busca FTS pt, by-anchor, e feedback
 * upsert workspace-scoped (RLS). Catálogo é platform-level (seed via getDb owner).
 */
import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import { eq, like } from 'drizzle-orm';
import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, getDb, schema } from '@hm/db';
import { SESSION_COOKIE } from '../auth/session';
import { createHelpRouter } from './help';

const { workspaces, members, helpCategories, helpArticles } = schema;

let ws = '';
let memberCookie = '';
let publishedId = '';
let publishedSlug = '';
let draftSlug = '';
let anchorKey = '';
const sfx = randomUUID().slice(0, 8);

const app = express();
app.use(express.json());
app.use(createHelpRouter());

const cookieFor = (a: string, e: string) =>
  `${SESSION_COOKIE}=${encodeURIComponent(
    Buffer.from(JSON.stringify({ authUserId: a, email: e, iat: Date.now() })).toString('base64url'),
  )}`;
const auth = (m: 'get' | 'post', p: string) => request(app)[m](p).set('Cookie', memberCookie);

beforeAll(async () => {
  const db = getDb();
  const [w] = await db.insert(workspaces).values({ name: 'Help Read', slug: `helpread-${sfx}` }).returning();
  ws = w!.id;
  const mAuth = randomUUID();
  const mEmail = `hread-${sfx}@t.local`;
  await db.insert(members).values({ workspaceId: ws, authUserId: mAuth, email: mEmail, role: 'AGENT', status: 'active' });
  memberCookie = cookieFor(mAuth, mEmail);

  const [cat] = await db
    .insert(helpCategories)
    .values({ slug: `read-${sfx}-cat`, title: 'Leitura', order: 0 })
    .returning();
  anchorKey = `read.${sfx}.agents.create`;
  publishedSlug = `read-${sfx}-publicado`;
  draftSlug = `read-${sfx}-rascunho`;
  const [pub] = await db
    .insert(helpArticles)
    .values({
      categoryId: cat!.id,
      slug: publishedSlug,
      title: 'Como criar um agente de inteligencia',
      excerpt: 'guia de agentes',
      bodyMd: '# Agente\n\nConfigure o prompt e o modelo.',
      status: 'published',
      publishedAt: new Date(),
      anchorKey,
    })
    .returning();
  publishedId = pub!.id;
  await db
    .insert(helpArticles)
    .values({ categoryId: cat!.id, slug: draftSlug, title: 'Rascunho', bodyMd: '# rascunho', status: 'draft' });
});

afterAll(async () => {
  const db = getDb();
  await db.delete(helpCategories).where(like(helpCategories.slug, `read-${sfx}%`));
  if (ws) await db.delete(workspaces).where(eq(workspaces.id, ws));
  await closeDb();
});

describe('gate', () => {
  it('sem sessão → 401', async () => {
    expect((await request(app).get('/api/help/categories')).status).toBe(401);
  });
});

describe('leitor (só published)', () => {
  it('lista categorias com contagem de publicados', async () => {
    const res = await auth('get', '/api/help/categories');
    expect(res.status).toBe(200);
    const cat = res.body.categories.find((c: { slug: string }) => c.slug === `read-${sfx}-cat`);
    expect(cat?.publishedCount).toBe(1);
  });

  it('lista artigos publicados; rascunho não aparece', async () => {
    const res = await auth('get', '/api/help/articles');
    expect(res.status).toBe(200);
    const slugs = res.body.articles.map((a: { slug: string }) => a.slug);
    expect(slugs).toContain(publishedSlug);
    expect(slugs).not.toContain(draftSlug);
  });

  it('busca FTS pt encontra o publicado', async () => {
    const res = await auth('get', '/api/help/articles?q=agente');
    expect(res.status).toBe(200);
    expect(res.body.articles.some((a: { id: string }) => a.id === publishedId)).toBe(true);
  });

  it('by-anchor resolve publicado; ancora inexistente → 404', async () => {
    const ok = await auth('get', `/api/help/articles/by-anchor/${anchorKey}`);
    expect(ok.status).toBe(200);
    expect(ok.body.article.id).toBe(publishedId);
    const miss = await auth('get', `/api/help/articles/by-anchor/nao.existe.${sfx}`);
    expect(miss.status).toBe(404);
  });

  it('por slug: publicado retorna; rascunho → 404', async () => {
    const ok = await auth('get', `/api/help/articles/${publishedSlug}`);
    expect(ok.status).toBe(200);
    expect(ok.body.article.slug).toBe(publishedSlug);
    const draft = await auth('get', `/api/help/articles/${draftSlug}`);
    expect(draft.status).toBe(404);
  });
});

describe('feedback (workspace-scoped, upsert)', () => {
  it('grava e sobrescreve o voto por (article, member)', async () => {
    const first = await auth('post', `/api/help/articles/${publishedId}/feedback`).send({ helpful: false });
    expect(first.status).toBe(200);
    expect(first.body.feedback.helpful).toBe(false);
    const firstId = first.body.feedback.id;

    const second = await auth('post', `/api/help/articles/${publishedId}/feedback`).send({ helpful: true, comment: 'ajudou' });
    expect(second.status).toBe(200);
    expect(second.body.feedback.id).toBe(firstId);
    expect(second.body.feedback.helpful).toBe(true);
    expect(second.body.feedback.comment).toBe('ajudou');

    // O feedback gravado pertence ao workspace do membro (RLS).
    const rows = await getDb()
      .select()
      .from(schema.helpArticleFeedback)
      .where(eq(schema.helpArticleFeedback.id, firstId));
    expect(rows[0]?.workspaceId).toBe(ws);
  });

  it('feedback de artigo inexistente/rascunho → 404', async () => {
    const miss = await auth('post', `/api/help/articles/${randomUUID()}/feedback`).send({ helpful: true });
    expect(miss.status).toBe(404);
  });
});
