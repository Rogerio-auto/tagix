/**
 * F69-S03 — gravação do lead contra o Postgres dev (RLS).
 *
 * Protege: lead vira contato + conversa + mensagem + card; o mesmo lead duas vezes
 * não duplica nada; contato que já falou pelo WhatsApp é reaproveitado; e um
 * workspace não enxerga o lead do outro.
 *
 * Pula sem `DATABASE_URL`.
 */
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ParsedLead } from '@hm/channels';
import { closeDb, encryptSecret, getDb, leadAdsRepo, schema, withWorkspace } from '@hm/db';
import { DbLeadStore, LEAD_ADS_SOURCE } from './db-store';
import { consentEvidence } from './process';
import type { LeadgenJob } from './ports';

const url = process.env['DATABASE_URL'];

describe.skipIf(!url)('F69-S03 DbLeadStore', () => {
  const sfx = randomUUID().slice(0, 8);
  const pageId = `9${Date.now()}`;
  const store = new DbLeadStore();
  let workspaceId = '';
  let outroWorkspaceId = '';
  let channelId = '';
  let connectionId = '';
  let sourceId = '';

  const lead = (id: string, telefone: string): ParsedLead => ({
    leadgenId: id,
    createdTime: '2026-09-15T12:00:00+0000',
    adId: 'ad1',
    formId: 'f1',
    answers: { full_name: ['Ana Souza'], phone_number: [telefone], tipo_de_obra: ['Cozinha'] },
    consent: [{ checkboxKey: 'optin', isChecked: true }],
  });

  beforeAll(async () => {
    const db = getDb();
    const [ws] = await db
      .insert(schema.workspaces)
      .values({ name: 'F69S03', slug: `f69s03-${sfx}`, planId: null, market: 'US' })
      .returning();
    const [ws2] = await db
      .insert(schema.workspaces)
      .values({ name: 'F69S03-b', slug: `f69s03b-${sfx}`, planId: null })
      .returning();
    if (!ws || !ws2) throw new Error('workspaces de teste não criados');
    workspaceId = ws.id;
    outroWorkspaceId = ws2.id;

    const [canal] = await db
      .insert(schema.channels)
      .values({
        workspaceId,
        provider: 'meta_whatsapp',
        name: 'WA',
        phoneNumber: '+13055550100',
        phoneNumberId: `PN_${sfx}`,
        wabaId: `WABA_${sfx}`,
      })
      .returning();
    if (!canal) throw new Error('canal não criado');
    channelId = canal.id;

    const [pipeline] = await db
      .insert(schema.pipelines)
      .values({
        workspaceId,
        name: 'Vendas',
        isDefault: true,
        settings: { custom_fields: [{ key: 'tipo_de_obra', label: 'Tipo de obra', type: 'select', required: false, options: ['Cozinha', 'Banheiro'], position: 0 }] },
      })
      .returning();
    if (!pipeline) throw new Error('pipeline não criado');
    await db.insert(schema.stages).values({ workspaceId, pipelineId: pipeline.id, name: 'Novo', position: 0 });

    const [conexao] = await db
      .insert(schema.metaConnections)
      .values({
        workspaceId,
        metaUserId: `u-${sfx}`,
        accessTokenEnc: encryptSecret('token-de-teste'),
        keyVersion: 1,
        useCases: ['leads'],
      })
      .returning();
    if (!conexao) throw new Error('conexão não criada');
    connectionId = conexao.id;

    const fonte = await withWorkspace(workspaceId, (tx) =>
      leadAdsRepo.upsertSource(tx, { workspaceId, connectionId, pageId, pageName: 'Página', now: new Date() }),
    );
    sourceId = fonte.id;
  });

  afterAll(async () => {
    const db = getDb();
    await db.delete(schema.workspaces).where(eq(schema.workspaces.id, workspaceId));
    await db.delete(schema.workspaces).where(eq(schema.workspaces.id, outroWorkspaceId));
    await closeDb();
  });

  async function processar(id: string, telefone: string) {
    const fonte = { workspaceId, sourceId, connectionId };
    const job: LeadgenJob = { leadgenId: id, pageId, formId: 'f1', adId: 'ad1', origin: 'webhook' };
    const reserva = await store.claim(fonte, job);
    if (reserva.alreadyProcessed) return { reserva, gravado: null };
    const l = lead(id, telefone);
    const gravado = await store.persist({
      source: fonte,
      submissionId: reserva.submissionId,
      job,
      lead: l,
      consent: consentEvidence(l, 'f1', null),
      now: new Date(),
    });
    return { reserva, gravado };
  }

  it('webhook resolve a página para o workspace pela função SECURITY DEFINER', async () => {
    const fontes = await store.resolveSources(pageId);
    expect(fontes).toEqual([{ workspaceId, sourceId, connectionId }]);
  });

  it('claim decifra o token da conexão', async () => {
    const r = await store.claim({ workspaceId, sourceId, connectionId }, {
      leadgenId: `token-${sfx}`, pageId, formId: null, adId: null, origin: 'webhook',
    });
    expect(r.connectionToken).toBe('token-de-teste');
  });

  it('lead vira contato + conversa + mensagem + card com campo do funil preenchido', async () => {
    const { gravado } = await processar(`lg1-${sfx}`, '(305) 555-0142');
    expect(gravado?.created).toBe(true);
    expect(gravado?.conversationId).not.toBeNull();
    expect(gravado?.message?.content).toContain('Tipo de obra: Cozinha');

    const db = getDb();
    const [contato] = await db.select().from(schema.contacts).where(eq(schema.contacts.id, gravado!.contactId!));
    expect(contato?.phone).toBe('13055550142');
    expect(contato?.source).toBe(LEAD_ADS_SOURCE);

    const [conversa] = await db.select().from(schema.conversations).where(eq(schema.conversations.id, gravado!.conversationId!));
    expect(conversa?.remoteId).toBe('13055550142');
    expect(conversa?.channelId).toBe(channelId);
    expect(conversa?.lastMessageFrom).toBe('contact');

    const [card] = await db.select().from(schema.deals).where(eq(schema.deals.id, gravado!.dealId!));
    expect(card?.source).toBe(LEAD_ADS_SOURCE);
    expect(card?.currency).toBe('USD');
    expect(card?.customFields).toMatchObject({ tipo_de_obra: 'Cozinha' });
  });

  it('o mesmo lead de novo não cria nada', async () => {
    const { reserva, gravado } = await processar(`lg1-${sfx}`, '(305) 555-0142');
    expect(reserva.alreadyProcessed).toBe(true);
    expect(gravado).toBeNull();
    const db = getDb();
    const contatos = await db.select().from(schema.contacts).where(eq(schema.contacts.workspaceId, workspaceId));
    expect(contatos).toHaveLength(1);
  });

  it('segundo formulário da mesma pessoa reaproveita contato, conversa e card', async () => {
    const primeiro = await processar(`lg2-${sfx}`, '+13055550142');
    expect(primeiro.gravado?.created).toBe(true);
    const db = getDb();
    const cards = await db.select().from(schema.deals).where(eq(schema.deals.workspaceId, workspaceId));
    expect(cards).toHaveLength(1);
    const mensagens = await db
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.conversationId, primeiro.gravado!.conversationId!));
    expect(mensagens).toHaveLength(2);
  });

  it('persist concorrente: o segundo vê processed e não grava', async () => {
    const fonte = { workspaceId, sourceId, connectionId };
    const job: LeadgenJob = { leadgenId: `lg3-${sfx}`, pageId, formId: 'f1', adId: null, origin: 'webhook' };
    const reserva = await store.claim(fonte, job);
    const l = lead(job.leadgenId, '+13055550199');
    const entrada = { source: fonte, submissionId: reserva.submissionId, job, lead: l, consent: consentEvidence(l, 'f1', null), now: new Date() };
    const [a, b] = await Promise.all([store.persist(entrada), store.persist(entrada)]);
    expect([a.created, b.created].sort()).toEqual([false, true]);
  });

  it('RLS: outro workspace não enxerga fontes nem leads', async () => {
    const vistos = await withWorkspace(outroWorkspaceId, async (tx) => ({
      fontes: await tx.select().from(schema.leadAdSources),
      leads: await tx.select().from(schema.leadAdSubmissions),
    }));
    expect(vistos.fontes).toHaveLength(0);
    expect(vistos.leads).toHaveLength(0);
  });
});
