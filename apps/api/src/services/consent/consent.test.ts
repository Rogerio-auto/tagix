/**
 * F59-S04 — serviço de consentimento (camada de I/O do portão).
 *
 * A regra em si é testada sem banco em `@hm/shared/consent.test.ts`. Aqui o que
 * importa é o carregamento: mercado do workspace, fuso do contato, snapshot sob
 * RLS, e o comportamento quando o dado não existe.
 */
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { consentRepo, getDb, schema, withWorkspace, closeDb } from '@hm/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checkOutbound } from './index';

let wsUS = '';
let wsBR = '';
let contatoUS = '';
let contatoBR = '';
let suffix = '';

/** 15h em Nova York — dentro da janela, para isolar o que cada teste mede. */
const TARDE_NY = new Date('2026-07-15T19:00:00Z');

beforeAll(async () => {
  const db = getDb();
  suffix = randomUUID().slice(0, 8);

  const [us] = await db
    .insert(schema.workspaces)
    .values({ name: `Gate US ${suffix}`, slug: `gate-us-${suffix}`, market: 'US' })
    .returning();
  const [br] = await db
    .insert(schema.workspaces)
    .values({ name: `Gate BR ${suffix}`, slug: `gate-br-${suffix}` })
    .returning();
  if (!us || !br) throw new Error('Falha ao criar workspaces do portão.');
  wsUS = us.id;
  wsBR = br.id;

  const [cUS] = await db
    .insert(schema.contacts)
    .values({
      workspaceId: wsUS,
      displayName: `Orlando ${suffix}`,
      timezone: 'America/New_York',
    })
    .returning();
  const [cBR] = await db
    .insert(schema.contacts)
    .values({ workspaceId: wsBR, displayName: `SP ${suffix}` })
    .returning();
  if (!cUS || !cBR) throw new Error('Falha ao criar contatos do portão.');
  contatoUS = cUS.id;
  contatoBR = cBR.id;
});

afterAll(async () => {
  const db = getDb();
  for (const id of [wsUS, wsBR]) {
    if (id) await db.delete(schema.workspaces).where(eq(schema.workspaces.id, id));
  }
  await closeDb();
});

describe('carregamento do contexto', () => {
  it('usa o mercado do workspace, não um default de código', async () => {
    // Mesmo canal, mesma finalidade, sem consentimento: US exige, BR (WhatsApp)
    // também — mas o SMS só existe no mercado US, e é isso que separa os dois.
    const us = await checkOutbound({
      workspaceId: wsUS,
      contactId: contatoUS,
      channel: 'sms',
      purpose: 'marketing',
      channelRegistration: 'approved',
      now: TARDE_NY,
    });
    const br = await checkOutbound({
      workspaceId: wsBR,
      contactId: contatoBR,
      channel: 'sms',
      purpose: 'marketing',
      channelRegistration: 'approved',
      now: TARDE_NY,
    });

    expect(us.allowed).toBe(false);
    if (!us.allowed) expect(us.reason).toBe('no_consent');
    expect(br.allowed).toBe(false);
    if (!br.allowed) expect(br.reason).toBe('channel_disabled');
  });

  it('usa o fuso do contato quando existe', async () => {
    const d = await checkOutbound({
      workspaceId: wsUS,
      contactId: contatoUS,
      channel: 'sms',
      purpose: 'transactional',
      channelRegistration: 'approved',
      now: TARDE_NY,
    });
    expect(d.timezone).toBe('America/New_York');
    expect(d.usedFallbackTimezone).toBe(false);
  });

  it('cai no fuso do mercado quando o contato não tem', async () => {
    const d = await checkOutbound({
      workspaceId: wsBR,
      contactId: contatoBR,
      channel: 'meta_whatsapp',
      purpose: 'transactional',
      now: TARDE_NY,
    });
    expect(d.timezone).toBe('America/Sao_Paulo');
    expect(d.usedFallbackTimezone).toBe(true);
  });
});

describe('snapshot sob RLS', () => {
  it('libera marketing depois do consentimento registrado', async () => {
    const antes = await checkOutbound({
      workspaceId: wsUS,
      contactId: contatoUS,
      channel: 'email',
      purpose: 'marketing',
      now: TARDE_NY,
    });
    // E-mail nos EUA dispensa opt-in (CAN-SPAM), então serve para provar o
    // caminho positivo sem depender de consentimento.
    expect(antes.allowed).toBe(true);

    const semConsentimento = await checkOutbound({
      workspaceId: wsUS,
      contactId: contatoUS,
      channel: 'meta_whatsapp',
      purpose: 'marketing',
      now: TARDE_NY,
    });
    expect(semConsentimento.allowed).toBe(false);

    await withWorkspace(wsUS, (tx) =>
      consentRepo.grant(tx, {
        workspaceId: wsUS,
        contactId: contatoUS,
        channel: 'meta_whatsapp',
        purpose: 'marketing',
        source: 'webchat',
        proof: { displayedText: 'Aceito receber mensagens' },
        market: 'US',
      }),
    );

    const depois = await checkOutbound({
      workspaceId: wsUS,
      contactId: contatoUS,
      channel: 'meta_whatsapp',
      purpose: 'marketing',
      now: TARDE_NY,
    });
    expect(depois.allowed).toBe(true);
  });

  it('supressão criada pelo repo bloqueia o envio no serviço', async () => {
    await withWorkspace(wsUS, (tx) =>
      consentRepo.revoke(tx, {
        workspaceId: wsUS,
        contactId: contatoUS,
        channel: null,
        reason: 'natural_language',
      }),
    );

    const d = await checkOutbound({
      workspaceId: wsUS,
      contactId: contatoUS,
      channel: 'meta_whatsapp',
      purpose: 'transactional',
      now: TARDE_NY,
    });
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.reason).toBe('suppressed');
  });
});

describe('dado ausente', () => {
  it('contato inexistente é recusa, não exceção', async () => {
    const d = await checkOutbound({
      workspaceId: wsUS,
      contactId: randomUUID(),
      channel: 'sms',
      purpose: 'marketing',
      now: TARDE_NY,
    });
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.message).toContain('não encontrado');
  });
});
