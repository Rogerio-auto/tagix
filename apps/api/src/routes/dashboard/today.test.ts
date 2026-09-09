/**
 * F61-S02 — a visão de dono.
 *
 * O que este arquivo protege: a definição de "aguardando resposta" (é o número
 * que fecha venda), o isolamento por workspace, e o comportamento com dado zero —
 * porque workspace novo não pode parecer quebrado.
 */
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { closeDb, getDb, schema, withWorkspace } from '@hm/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadToday } from './today';

let wsA = '';
let wsB = '';
let canalA = '';
let suffix = '';
const AGORA = new Date('2026-09-15T18:00:00Z');

async function conversa(input: {
  workspaceId: string;
  channelId: string;
  nome: string;
  lastMessageFrom: 'contact' | 'member';
  minutosAtras: number;
  status?: string;
  snoozed?: boolean;
}): Promise<string> {
  const db = getDb();
  const [contato] = await db
    .insert(schema.contacts)
    .values({ workspaceId: input.workspaceId, displayName: `${input.nome} ${suffix}` })
    .returning();
  const [conv] = await db
    .insert(schema.conversations)
    .values({
      workspaceId: input.workspaceId,
      channelId: input.channelId,
      contactId: contato!.id,
      remoteId: `remote-${randomUUID()}`,
      status: input.status ?? 'open',
      lastMessageFrom: input.lastMessageFrom,
      lastMessagePreview: `mensagem de ${input.nome}`,
      lastMessageAt: new Date(AGORA.getTime() - input.minutosAtras * 60_000),
      ...(input.snoozed ? { snoozedUntil: new Date(AGORA.getTime() + 3_600_000) } : {}),
    })
    .returning();
  return conv!.id;
}

beforeAll(async () => {
  const db = getDb();
  suffix = randomUUID().slice(0, 8);

  const [a] = await db
    .insert(schema.workspaces)
    .values({ name: `Hoje A ${suffix}`, slug: `hoje-a-${suffix}` })
    .returning();
  const [b] = await db
    .insert(schema.workspaces)
    .values({ name: `Hoje B ${suffix}`, slug: `hoje-b-${suffix}` })
    .returning();
  wsA = a!.id;
  wsB = b!.id;

  const [ch] = await db
    .insert(schema.channels)
    .values({
      workspaceId: wsA,
      provider: 'meta_whatsapp',
      name: `WA ${suffix}`,
      phoneNumberId: `pn-${suffix}`,
      wabaId: `waba-${suffix}`,
    })
    .returning();
  canalA = ch!.id;
});

afterAll(async () => {
  const db = getDb();
  for (const id of [wsA, wsB]) {
    if (id) await db.delete(schema.workspaces).where(eq(schema.workspaces.id, id));
  }
  await closeDb();
});

describe('aguardando resposta — o número que fecha venda', () => {
  it('conta só conversa cuja última mensagem veio do CONTATO', async () => {
    await conversa({
      workspaceId: wsA,
      channelId: canalA,
      nome: 'Esperando',
      lastMessageFrom: 'contact',
      minutosAtras: 20,
    });
    await conversa({
      workspaceId: wsA,
      channelId: canalA,
      nome: 'Ja respondido',
      lastMessageFrom: 'member',
      minutosAtras: 5,
    });

    const r = await withWorkspace(wsA, (tx) => loadToday(tx, { workspaceId: wsA, now: AGORA }));
    const nomes = r.waiting.map((w) => w.contactName ?? '');
    expect(nomes.some((n) => n.startsWith('Esperando'))).toBe(true);
    expect(nomes.some((n) => n.startsWith('Ja respondido'))).toBe(false);
  });

  it('ordena do MAIS ANTIGO para o mais novo', async () => {
    // Quem espera há mais tempo está mais perto de fechar com o concorrente.
    const r = await withWorkspace(wsA, (tx) => loadToday(tx, { workspaceId: wsA, now: AGORA }));
    const minutos = r.waiting.map((w) => w.waitingMinutes);
    expect([...minutos].sort((a, b) => b - a)).toEqual(minutos);
  });

  it('conversa adiada NÃO conta como esperando', async () => {
    // Alguém decidiu que ela espera — não é lead abandonado.
    await conversa({
      workspaceId: wsA,
      channelId: canalA,
      nome: 'Adiada',
      lastMessageFrom: 'contact',
      minutosAtras: 200,
      snoozed: true,
    });
    const r = await withWorkspace(wsA, (tx) => loadToday(tx, { workspaceId: wsA, now: AGORA }));
    expect(r.waiting.map((w) => w.contactName ?? '').some((n) => n.startsWith('Adiada'))).toBe(
      false,
    );
  });

  it('conversa fechada não conta', async () => {
    await conversa({
      workspaceId: wsA,
      channelId: canalA,
      nome: 'Fechada',
      lastMessageFrom: 'contact',
      minutosAtras: 300,
      status: 'closed',
    });
    const r = await withWorkspace(wsA, (tx) => loadToday(tx, { workspaceId: wsA, now: AGORA }));
    expect(r.waiting.map((w) => w.contactName ?? '').some((n) => n.startsWith('Fechada'))).toBe(
      false,
    );
  });

  it('os minutos vêm calculados do SERVIDOR', async () => {
    // O relógio do celular pode estar errado, e é este número que decide se o
    // dono para o que está fazendo.
    const r = await withWorkspace(wsA, (tx) => loadToday(tx, { workspaceId: wsA, now: AGORA }));
    const esperando = r.waiting.find((w) => (w.contactName ?? '').startsWith('Esperando'));
    expect(esperando?.waitingMinutes).toBe(20);
    expect(r.serverTime).toBe(AGORA.toISOString());
  });

  it('waitingTotal reflete o total, não só a página exibida', async () => {
    const r = await withWorkspace(wsA, (tx) => loadToday(tx, { workspaceId: wsA, now: AGORA }));
    expect(r.waitingTotal).toBeGreaterThanOrEqual(r.waiting.length);
  });
});

describe('isolamento por workspace', () => {
  it('workspace B não vê nada do A', async () => {
    const r = await withWorkspace(wsB, (tx) => loadToday(tx, { workspaceId: wsB, now: AGORA }));
    expect(r.waiting).toHaveLength(0);
    expect(r.waitingTotal).toBe(0);
  });
});

describe('workspace sem dado nenhum', () => {
  it('devolve zeros, não erro nem nulo — vazio não pode parecer defeito', async () => {
    const r = await withWorkspace(wsB, (tx) => loadToday(tx, { workspaceId: wsB, now: AGORA }));
    expect(r.waiting).toEqual([]);
    expect(r.appointments).toEqual([]);
    expect(r.month.leads).toBe(0);
    expect(r.month.leadsPrevious).toBe(0);
    expect(r.month.appointments).toBe(0);
    expect(typeof r.serverTime).toBe('string');
  });
});

describe('resultado do mês', () => {
  it('separa mês corrente do anterior', async () => {
    const db = getDb();
    // Um contato no mês anterior, para a comparação ter os dois lados.
    await db.insert(schema.contacts).values({
      workspaceId: wsB,
      displayName: `Antigo ${suffix}`,
      createdAt: new Date('2026-08-10T12:00:00Z'),
    });
    await db.insert(schema.contacts).values({
      workspaceId: wsB,
      displayName: `Novo ${suffix}`,
      createdAt: new Date('2026-09-10T12:00:00Z'),
    });

    const r = await withWorkspace(wsB, (tx) => loadToday(tx, { workspaceId: wsB, now: AGORA }));
    expect(r.month.leads).toBe(1);
    expect(r.month.leadsPrevious).toBe(1);
  });
});
