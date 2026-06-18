/**
 * F38-S02 — CMS da Central de Ajuda (platform-admin). Integração real contra
 * Postgres dev. Cobre: gate 401/403, CRUD de categoria/artigo, publish/unpublish,
 * reorder, e auditoria da negação de não-admin + das mutações.
 */
import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import { and, eq, like } from 'drizzle-orm';
import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, getDb, schema } from '@hm/db';
import { SESSION_COOKIE } from '../../auth/session';
import { createPlatformHelpRouter } from './help';

const { workspaces, members, helpCategories } = schema;

let ws = '';
let adminCookie = '';
let userCookie = '';
const slugSfx = randomUUID().slice(0, 8);

const app = express();
app.use(express.json());
app.use(createPlatformHelpRouter());

const cookieFor = (a: string, e: string) =>
  `${SESSION_COOKIE}=${encodeURIComponent(
    Buffer.from(JSON.stringify({ authUserId: a, email: e, iat: Date.now() })).toString('base64url'),
  )}`;
const admin = (m: 'get' | 'post' | 'patch' | 'delete', p: string) =>
  request(app)[m](p).set('Cookie', adminCookie);

beforeAll(async () => {
  const db = getDb();
  const sfx = randomUUID().slice(0, 8);
  const [w] = await db.insert(workspaces).values({ name: 'Help CMS', slug: `helpcms-${sfx}` }).returning();
  ws = w!.id;

  const aAuth = randomUUID();
  const aEmail = `hadmin-${sfx}@t.local`;
  await db.insert(members).values({ workspaceId: ws, authUserId: aAuth, email: aEmail, role: 'OWNER', status: 'active', isPlatformAdmin: true });
  adminCookie = cookieFor(aAuth, aEmail);

  const uAuth = randomUUID();
  const uEmail = `huser-${sfx}@t.local`;
  await db.insert(members).values({ workspaceId: ws, authUserId: uAuth, email: uEmail, role: 'OWNER', status: 'active' });
  userCookie = cookieFor(uAuth, uEmail);
});

afterAll(async () => {
  const db = getDb();
  await db.delete(helpCategories).where(like(helpCategories.slug, `cms-${slugSfx}%`));
  if (ws) await db.delete(workspaces).where(eq(workspaces.id, ws));
  await closeDb();
});

describe('gate', () => {
  it('sem sessão → 401', async () => {
    expect((await request(app).get('/api/platform/help/categories')).status).toBe(401);
  });
  it('não-admin → 403 e auditado', async () => {
    const res = await request(app).get('/api/platform/help/categories').set('Cookie', userCookie);
    expect(res.status).toBe(403);
    // O middleware requirePlatformAdmin audita a tentativa negada.
    const denied = await getDb()
      .select()
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.action, 'platform.access_denied'));
    expect(denied.length).toBeGreaterThanOrEqual(1);
  });
});

describe('CRUD + publish + reorder', () => {
  it('cria categoria + artigo draft, publica, lista e reordena', async () => {
    // Categoria.
    const catRes = await admin('post', '/api/platform/help/categories').send({
      slug: `cms-${slugSfx}-getting-started`,
      title: 'Primeiros passos',
      icon: 'rocket',
    });
    expect(catRes.status).toBe(201);
    const categoryId = catRes.body.category.id;

    // Slug inválido → 400.
    const bad = await admin('post', '/api/platform/help/categories').send({ slug: 'INVALIDO MAIUSC', title: 'x' });
    expect(bad.status).toBe(400);

    // Artigo (nasce draft).
    const artRes = await admin('post', '/api/platform/help/articles').send({
      categoryId,
      slug: `cms-${slugSfx}-art-1`,
      title: 'Como criar um agente',
      excerpt: 'guia',
      bodyMd: '# Agente\n\nConfigure o prompt.',
      anchorKey: `cms.${slugSfx}.agents.create`,
    });
    expect(artRes.status).toBe(201);
    expect(artRes.body.article.status).toBe('draft');
    const articleId = artRes.body.article.id;

    // Categoria inexistente → 400.
    const orphan = await admin('post', '/api/platform/help/articles').send({
      categoryId: randomUUID(),
      slug: `cms-${slugSfx}-orphan`,
      title: 'x',
      bodyMd: '# x',
    });
    expect(orphan.status).toBe(400);

    // Publica.
    const pub = await admin('post', `/api/platform/help/articles/${articleId}/publish`).send({});
    expect(pub.status).toBe(200);
    expect(pub.body.article.status).toBe('published');
    expect(pub.body.article.publishedAt).not.toBeNull();

    // Lista (admin vê todos os status).
    const list = await admin('get', `/api/platform/help/articles?category=${categoryId}`);
    expect(list.status).toBe(200);
    expect(list.body.articles.some((a: { id: string }) => a.id === articleId)).toBe(true);

    // Reorder.
    const reorder = await admin('post', '/api/platform/help/articles/reorder').send({
      items: [{ id: articleId, order: 5 }],
    });
    expect(reorder.status).toBe(200);
    const after = await admin('get', `/api/platform/help/articles/${articleId}`);
    expect(after.body.article.order).toBe(5);

    // Unpublish.
    const unpub = await admin('post', `/api/platform/help/articles/${articleId}/unpublish`).send({});
    expect(unpub.body.article.status).toBe('draft');

    // Auditoria das mutações registrada.
    const created = await getDb()
      .select()
      .from(schema.auditLogs)
      .where(and(eq(schema.auditLogs.action, 'help.article_created'), eq(schema.auditLogs.resourceId, articleId)));
    expect(created.length).toBeGreaterThanOrEqual(1);

    // Delete.
    const del = await admin('delete', `/api/platform/help/articles/${articleId}`);
    expect(del.status).toBe(204);
    const gone = await admin('get', `/api/platform/help/articles/${articleId}`);
    expect(gone.status).toBe(404);
  });

  it('404 ao atualizar categoria inexistente', async () => {
    const res = await admin('patch', `/api/platform/help/categories/${randomUUID()}`).send({ title: 'x' });
    expect(res.status).toBe(404);
  });
});
