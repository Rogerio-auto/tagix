/**
 * F9-S03 — API pública v1. Integração real contra Postgres dev (RLS por chave) e o
 * publisher outbound (RabbitMQ dev). Cobre: gating por api-key/scope, isolamento de
 * tenant, send_message/template persistindo `pending`, upsert_contact (create+update),
 * trigger_flow e conversations list/get. A spec OpenAPI é validada (3.1 + 6 paths).
 *
 * O envio real ao provider é do worker outbound (fora deste slot) — aqui validamos a
 * borda: a mensagem vira `pending` e o job é publicado (broker UP).
 */
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, getDb, schema } from '@hm/db';
import { assertTopology, connectMq } from '@hm/shared/mq';
import { closeOutboundPublisher } from '../../mq/outbound-publisher';
import { closeApiKeyRateLimiter } from '../../middlewares/api-key';
import { generateApiKey } from '../../services/api-keys';
import { buildOpenApiDocument } from './openapi';
import { createV1Router } from './index';
import express from 'express';
import request from 'supertest';

const { workspaces, channels, contacts, conversations, messages, flows, flowVersions, apiKeys, pipelines, stages, deals, conversionTypes, calendars } =
  schema;

const ALL_SCOPES = [
  'write:messages',
  'write:templates',
  'write:contacts',
  'write:flows',
  'read:conversations',
  'read:contacts',
  'read:deals',
  'write:deals',
  'read:conversions',
  'write:conversions',
  'read:flows',
  'read:calendar',
  'write:calendar',
];

let app: express.Express;
let wsA = '';
let wsB = '';
let convA = '';
let convB = '';
let flowA = '';
let contactA = '';
let dealA = '';
let stageOpenA = '';
let stageWonA = '';
let calendarA = '';
let tokenA = ''; // chave de A com todos os scopes
let tokenNoScope = ''; // chave de A sem scopes

async function seedKey(workspaceId: string, scopes: string[]): Promise<string> {
  const gen = generateApiKey();
  await getDb().insert(apiKeys).values({
    workspaceId,
    name: `k-${randomUUID().slice(0, 6)}`,
    keyHash: gen.keyHash,
    keyPrefix: gen.keyPrefix,
    scopes,
    rateLimitPerMinute: 1000,
  });
  return gen.token;
}

beforeAll(async () => {
  // Garante o exchange/queues `hm.events`/`hm.q.outbound` (o worker outbound também
  // asserta na produção) para que o publisher da borda tenha onde publicar.
  const mq = await connectMq();
  await assertTopology(mq.channel);
  await mq.connection.close();

  const db = getDb();
  const sfx = randomUUID().slice(0, 8);
  const [a] = await db.insert(workspaces).values({ name: 'V1 A', slug: `v1a-${sfx}` }).returning();
  const [b] = await db.insert(workspaces).values({ name: 'V1 B', slug: `v1b-${sfx}` }).returning();
  if (!a || !b) throw new Error('ws');
  wsA = a.id;
  wsB = b.id;

  const mkConv = async (ws: string, n: string): Promise<string> => {
    const [ch] = await db
      .insert(channels)
      .values({
        workspaceId: ws,
        provider: 'meta_whatsapp',
        name: `WA ${n} ${sfx}`,
        phoneNumberId: `pnid-${n}-${sfx}`,
        wabaId: `waba-${n}-${sfx}`,
      })
      .returning();
    if (!ch) throw new Error('channel');
    const [c] = await db
      .insert(conversations)
      .values({ workspaceId: ws, channelId: ch.id, remoteId: `+55119${n}${sfx.slice(0, 4)}`, status: 'open' })
      .returning();
    if (!c) throw new Error('conv');
    return c.id;
  };
  convA = await mkConv(wsA, 'a');
  convB = await mkConv(wsB, 'b');

  const [f] = await db.insert(flows).values({ workspaceId: wsA, name: 'Flow A', triggerType: 'manual' }).returning();
  if (!f) throw new Error('flow');
  flowA = f.id;
  // trigger_flow exige uma flow_version publicada (createExecution resolve a corrente).
  await db.insert(flowVersions).values({
    flowId: flowA,
    version: 1,
    nodes: [{ id: 'start', type: 'trigger', position: { x: 0, y: 0 }, data: {} }],
    edges: [],
    triggerConfig: {},
  });

  // Contato de A (para deals/conversões/contacts).
  const [ct] = await db
    .insert(contacts)
    .values({ workspaceId: wsA, displayName: 'Contato API', phone: `+5511944${sfx.slice(0, 4)}`, source: 'seed' })
    .returning();
  if (!ct) throw new Error('contact');
  contactA = ct.id;

  // Pipeline + 2 stages (open -> won) em A.
  const [pl] = await db.insert(pipelines).values({ workspaceId: wsA, name: 'Funil A', isDefault: true }).returning();
  if (!pl) throw new Error('pipeline');
  const [stOpen] = await db
    .insert(stages)
    .values({ workspaceId: wsA, pipelineId: pl.id, name: 'Aberto', position: 0 })
    .returning();
  const [stWon] = await db
    .insert(stages)
    .values({ workspaceId: wsA, pipelineId: pl.id, name: 'Ganho', position: 1, isWon: true })
    .returning();
  if (!stOpen || !stWon) throw new Error('stages');
  stageOpenA = stOpen.id;
  stageWonA = stWon.id;

  const [dl] = await db
    .insert(deals)
    .values({ workspaceId: wsA, pipelineId: pl.id, stageId: stOpen.id, contactId: ct.id, title: 'Deal API', valueCents: 10000 })
    .returning();
  if (!dl) throw new Error('deal');
  dealA = dl.id;

  // Tipo de conversão "venda" em A.
  await db
    .insert(conversionTypes)
    .values({ workspaceId: wsA, key: 'venda', label: 'Venda', valueRequired: false })
    .returning();

  // Calendar de A (workspace) para create_event.
  const [cal] = await db
    .insert(calendars)
    .values({ workspaceId: wsA, name: 'Empresa A', type: 'workspace', isDefault: true })
    .returning();
  if (!cal) throw new Error('calendar');
  calendarA = cal.id;

  tokenA = await seedKey(wsA, ALL_SCOPES);
  tokenNoScope = await seedKey(wsA, []);

  app = express();
  app.use(express.json());
  app.use(createV1Router());
});

afterAll(async () => {
  const db = getDb();
  if (wsA) await db.delete(workspaces).where(eq(workspaces.id, wsA));
  if (wsB) await db.delete(workspaces).where(eq(workspaces.id, wsB));
  await closeOutboundPublisher();
  await closeApiKeyRateLimiter();
  await closeDb();
});

const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

describe('OpenAPI spec', () => {
  it('gera documento 3.1 com os 6 paths e o security scheme', () => {
    const doc = buildOpenApiDocument();
    expect(doc.openapi).toBe('3.1.0');
    const paths = Object.keys(doc.paths ?? {});
    expect(paths).toContain('/api/v1/send_message');
    expect(paths).toContain('/api/v1/send_template');
    expect(paths).toContain('/api/v1/upsert_contact');
    expect(paths).toContain('/api/v1/trigger_flow');
    expect(paths).toContain('/api/v1/conversations');
    expect(paths).toContain('/api/v1/conversations/{id}');
    expect(paths).toContain('/api/v1/contacts');
    expect(paths).toContain('/api/v1/contacts/{id}');
    expect(paths).toContain('/api/v1/messages/media');
    expect(paths).toContain('/api/v1/deals');
    expect(paths).toContain('/api/v1/deals/{id}');
    expect(paths).toContain('/api/v1/deals/{id}/move');
    expect(paths).toContain('/api/v1/conversions');
    expect(paths).toContain('/api/v1/flows');
    expect(paths).toContain('/api/v1/events');
    expect(doc.components?.securitySchemes?.['ApiKeyAuth']).toBeDefined();
  });

  it('serve a spec em /api/v1/openapi.json sem exigir chave', async () => {
    const res = await request(app).get('/api/v1/openapi.json');
    expect(res.status).toBe(200);
    expect(res.body.info.title).toBe('Leadium API');
  });
});

describe('gating', () => {
  it('401 sem chave', async () => {
    const res = await request(app).post('/api/v1/send_message').send({ conversationId: convA, text: 'hi' });
    expect(res.status).toBe(401);
  });

  it('403 com chave sem o scope', async () => {
    const res = await request(app)
      .post('/api/v1/send_message')
      .set(bearer(tokenNoScope))
      .send({ conversationId: convA, text: 'hi' });
    expect(res.status).toBe(403);
  });
});

describe('send_message', () => {
  it('201 + persiste mensagem pending outbound', async () => {
    const res = await request(app)
      .post('/api/v1/send_message')
      .set(bearer(tokenA))
      .send({ conversationId: convA, text: 'olá via api' });
    expect(res.status).toBe(201);
    expect(res.body.message.viewStatus).toBe('pending');
    expect(res.body.message.direction).toBe('outbound');
    const [row] = await getDb()
      .select()
      .from(messages)
      .where(eq(messages.id, res.body.message.id));
    expect(row?.content).toBe('olá via api');
    expect(row?.senderType).toBe('system');
  });

  it('404 ao mirar conversa de outro workspace (RLS isola)', async () => {
    const res = await request(app)
      .post('/api/v1/send_message')
      .set(bearer(tokenA))
      .send({ conversationId: convB, text: 'cross-tenant' });
    expect(res.status).toBe(404);
  });

  it('400 com body inválido', async () => {
    const res = await request(app).post('/api/v1/send_message').set(bearer(tokenA)).send({ text: '' });
    expect(res.status).toBe(400);
  });
});

describe('send_template', () => {
  it('201 + persiste mensagem template pending', async () => {
    const res = await request(app)
      .post('/api/v1/send_template')
      .set(bearer(tokenA))
      .send({ conversationId: convA, templateName: 'order_confirmation', languageCode: 'pt_BR', components: [] });
    expect(res.status).toBe(201);
    expect(res.body.message.type).toBe('template');
    expect(res.body.message.content).toBe('order_confirmation');
  });
});

describe('upsert_contact', () => {
  it('cria contato novo (created=true) e depois atualiza pelo phone (created=false)', async () => {
    const phone = `+5511955${randomUUID().slice(0, 4)}`;
    const create = await request(app)
      .post('/api/v1/upsert_contact')
      .set(bearer(tokenA))
      .send({ phone, displayName: 'Cliente API' });
    expect(create.status).toBe(200);
    expect(create.body.created).toBe(true);
    const id = create.body.contact.id;

    const update = await request(app)
      .post('/api/v1/upsert_contact')
      .set(bearer(tokenA))
      .send({ phone, displayName: 'Cliente API Renomeado' });
    expect(update.status).toBe(200);
    expect(update.body.created).toBe(false);
    expect(update.body.contact.id).toBe(id);
    expect(update.body.contact.displayName).toBe('Cliente API Renomeado');

    const [row] = await getDb().select().from(contacts).where(eq(contacts.id, id));
    expect(row?.workspaceId).toBe(wsA);
  });

  it('400 sem identificador (id/phone/email)', async () => {
    const res = await request(app)
      .post('/api/v1/upsert_contact')
      .set(bearer(tokenA))
      .send({ displayName: 'sem id' });
    expect(res.status).toBe(400);
  });
});

describe('trigger_flow', () => {
  it('202 + executionId para flow do workspace', async () => {
    const res = await request(app).post('/api/v1/trigger_flow').set(bearer(tokenA)).send({ flowId: flowA });
    expect(res.status).toBe(202);
    expect(res.body.executionId).toMatch(/[0-9a-f-]{36}/);
  });

  it('404 para flow inexistente / de outro workspace', async () => {
    const res = await request(app).post('/api/v1/trigger_flow').set(bearer(tokenA)).send({ flowId: randomUUID() });
    expect(res.status).toBe(404);
  });
});

describe('conversations', () => {
  it('lista só conversas do workspace da chave', async () => {
    const res = await request(app).get('/api/v1/conversations').set(bearer(tokenA));
    expect(res.status).toBe(200);
    const ids = res.body.conversations.map((c: { id: string }) => c.id);
    expect(ids).toContain(convA);
    expect(ids).not.toContain(convB);
  });

  it('GET :id retorna a conversa do tenant; 404 para a de outro', async () => {
    const ok = await request(app).get(`/api/v1/conversations/${convA}`).set(bearer(tokenA));
    expect(ok.status).toBe(200);
    expect(ok.body.conversation.id).toBe(convA);

    const cross = await request(app).get(`/api/v1/conversations/${convB}`).set(bearer(tokenA));
    expect(cross.status).toBe(404);
  });
});

describe('contacts (F38-S12)', () => {
  it('lista só contatos do workspace da chave', async () => {
    const res = await request(app).get('/api/v1/contacts').set(bearer(tokenA));
    expect(res.status).toBe(200);
    const ids = res.body.contacts.map((c: { id: string }) => c.id);
    expect(ids).toContain(contactA);
  });

  it('GET :id retorna o contato; 404 com scope mas id inexistente', async () => {
    const ok = await request(app).get(`/api/v1/contacts/${contactA}`).set(bearer(tokenA));
    expect(ok.status).toBe(200);
    expect(ok.body.contact.id).toBe(contactA);
    const miss = await request(app).get(`/api/v1/contacts/${randomUUID()}`).set(bearer(tokenA));
    expect(miss.status).toBe(404);
  });

  it('403 sem o scope read:contacts', async () => {
    const res = await request(app).get('/api/v1/contacts').set(bearer(tokenNoScope));
    expect(res.status).toBe(403);
  });
});

describe('send_media (F38-S12)', () => {
  it('201 + persiste mensagem de mídia pending', async () => {
    const res = await request(app)
      .post('/api/v1/messages/media')
      .set(bearer(tokenA))
      .send({ conversationId: convA, mediaKind: 'image', mediaUrl: 'https://cdn.test/x.png', mime: 'image/png', caption: 'foto' });
    expect(res.status).toBe(201);
    expect(res.body.message.type).toBe('image');
    const [row] = await getDb().select().from(messages).where(eq(messages.id, res.body.message.id));
    expect(row?.mediaUrl).toBe('https://cdn.test/x.png');
    expect(row?.viewStatus).toBe('pending');
  });

  it('404 ao mirar conversa de outro workspace', async () => {
    const res = await request(app)
      .post('/api/v1/messages/media')
      .set(bearer(tokenA))
      .send({ conversationId: convB, mediaKind: 'image', mediaUrl: 'https://cdn.test/y.png', mime: 'image/png' });
    expect(res.status).toBe(404);
  });
});

describe('deals (F38-S12)', () => {
  it('lista só deals do workspace da chave', async () => {
    const res = await request(app).get('/api/v1/deals').set(bearer(tokenA));
    expect(res.status).toBe(200);
    expect(res.body.deals.map((d: { id: string }) => d.id)).toContain(dealA);
  });

  it('GET :id retorna o deal; move troca o stage', async () => {
    const get = await request(app).get(`/api/v1/deals/${dealA}`).set(bearer(tokenA));
    expect(get.status).toBe(200);
    expect(get.body.deal.stageId).toBe(stageOpenA);

    const mv = await request(app)
      .post(`/api/v1/deals/${dealA}/move`)
      .set(bearer(tokenA))
      .send({ stageId: stageWonA });
    expect(mv.status).toBe(200);
    expect(mv.body.deal.stageId).toBe(stageWonA);
    expect(mv.body.fromStageId).toBe(stageOpenA);
  });

  it('404 ao mover deal inexistente', async () => {
    const res = await request(app)
      .post(`/api/v1/deals/${randomUUID()}/move`)
      .set(bearer(tokenA))
      .send({ stageId: stageWonA });
    expect(res.status).toBe(404);
  });
});

describe('conversions (F38-S12)', () => {
  it('cria conversão (201) e deduplica no mesmo dia (200)', async () => {
    const first = await request(app)
      .post('/api/v1/conversions')
      .set(bearer(tokenA))
      .send({ conversionTypeKey: 'venda', contactId: contactA, dealId: dealA, valueCents: 9900 });
    expect(first.status).toBe(201);
    expect(first.body.status).toBe('created');

    const dup = await request(app)
      .post('/api/v1/conversions')
      .set(bearer(tokenA))
      .send({ conversionTypeKey: 'venda', contactId: contactA, dealId: dealA, valueCents: 9900 });
    expect(dup.status).toBe(200);
    expect(dup.body.status).toBe('deduped');
  });

  it('404 para tipo de conversão inexistente', async () => {
    const res = await request(app)
      .post('/api/v1/conversions')
      .set(bearer(tokenA))
      .send({ conversionTypeKey: 'inexistente', contactId: contactA });
    expect(res.status).toBe(404);
  });

  it('lista conversões do workspace da chave', async () => {
    const res = await request(app).get('/api/v1/conversions').set(bearer(tokenA));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.conversions)).toBe(true);
    expect(res.body.conversions.length).toBeGreaterThan(0);
  });
});

describe('flows + events (F38-S12)', () => {
  it('lista flows do workspace', async () => {
    const res = await request(app).get('/api/v1/flows').set(bearer(tokenA));
    expect(res.status).toBe(200);
    expect(res.body.flows.map((f: { id: string }) => f.id)).toContain(flowA);
  });

  it('cria e lista eventos', async () => {
    const start = new Date(Date.now() + 86_400_000).toISOString();
    const end = new Date(Date.now() + 86_400_000 + 3_600_000).toISOString();
    const create = await request(app)
      .post('/api/v1/events')
      .set(bearer(tokenA))
      .send({ calendarId: calendarA, title: 'Demo API', startAt: start, endAt: end, contactId: contactA });
    expect(create.status).toBe(201);
    expect(create.body.event.title).toBe('Demo API');

    const list = await request(app).get('/api/v1/events').set(bearer(tokenA));
    expect(list.status).toBe(200);
    expect(list.body.events.map((e: { id: string }) => e.id)).toContain(create.body.event.id);
  });

  it('422 quando endAt <= startAt', async () => {
    const now = new Date(Date.now() + 86_400_000).toISOString();
    const res = await request(app)
      .post('/api/v1/events')
      .set(bearer(tokenA))
      .send({ calendarId: calendarA, title: 'Inválido', startAt: now, endAt: now });
    expect(res.status).toBe(422);
  });
});
