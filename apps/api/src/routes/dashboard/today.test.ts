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
let wsC = '';
/** Workspace que nunca recebe nada — o "vazio não pode parecer defeito". */
let wsVazio = '';
let canalA = '';
let canalC = '';
let suffix = '';
const AGORA = new Date('2026-09-15T18:00:00Z');

async function conversa(input: {
  workspaceId: string;
  channelId: string;
  nome: string | null;
  telefone?: string;
  preview?: string;
  lastMessageFrom: 'contact' | 'member';
  minutosAtras: number;
  status?: string;
  snoozed?: boolean;
}): Promise<string> {
  const db = getDb();
  const [contato] = await db
    .insert(schema.contacts)
    .values({
      workspaceId: input.workspaceId,
      displayName: input.nome === null ? null : `${input.nome} ${suffix}`,
      ...(input.telefone !== undefined ? { phone: input.telefone } : {}),
    })
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
      lastMessagePreview: input.preview ?? `mensagem de ${input.nome ?? 'ninguem'}`,
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
  const [c] = await db
    .insert(schema.workspaces)
    .values({ name: `Hoje C ${suffix}`, slug: `hoje-c-${suffix}` })
    .returning();
  const [v] = await db
    .insert(schema.workspaces)
    .values({ name: `Hoje V ${suffix}`, slug: `hoje-v-${suffix}` })
    .returning();
  wsA = a!.id;
  wsB = b!.id;
  wsC = c!.id;
  wsVazio = v!.id;

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

  const [chC] = await db
    .insert(schema.channels)
    .values({
      workspaceId: wsC,
      provider: 'meta_whatsapp',
      name: `WA C ${suffix}`,
      phoneNumberId: `pn-c-${suffix}`,
      wabaId: `waba-c-${suffix}`,
    })
    .returning();
  canalC = chC!.id;
});

afterAll(async () => {
  const db = getDb();
  for (const id of [wsA, wsB, wsC, wsVazio]) {
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

/**
 * F61-S12 — o que faltava para a tela ENTREGAR, não só existir.
 *
 * Contexto de produção (2026-09-09): 199 de 200 contatos sem nome, prévia
 * dominante `[voice]`, 61 esperando numa lista plana de 10.
 */
describe('identidade — nunca "Contato sem nome"', () => {
  it('sem nome, mostra o telefone formatado', async () => {
    await conversa({
      workspaceId: wsC,
      channelId: canalC,
      nome: null,
      telefone: '+5566999342444',
      lastMessageFrom: 'contact',
      minutosAtras: 5,
    });
    const r = await withWorkspace(wsC, (tx) => loadToday(tx, { workspaceId: wsC, now: AGORA }));
    const lead = r.waiting.find((w) => w.contactName === '(66) 99934-2444');
    expect(lead).toBeDefined();
  });

  it('nome do CRM vence o telefone — decisão de quem atende manda', async () => {
    await conversa({
      workspaceId: wsC,
      channelId: canalC,
      nome: 'Ana',
      telefone: '+5566999342445',
      lastMessageFrom: 'contact',
      minutosAtras: 6,
    });
    const r = await withWorkspace(wsC, (tx) => loadToday(tx, { workspaceId: wsC, now: AGORA }));
    const nomes = r.waiting.map((w) => w.contactName ?? '');
    expect(nomes.some((n) => n.startsWith('Ana'))).toBe(true);
    expect(nomes).not.toContain('(66) 99934-2445');
  });
});

describe('prévia — o cliente nunca lê sintaxe de máquina', () => {
  it('marcador cru gravado no banco é humanizado na leitura', async () => {
    await conversa({
      workspaceId: wsC,
      channelId: canalC,
      nome: 'Voz',
      preview: '[voice]',
      lastMessageFrom: 'contact',
      minutosAtras: 7,
    });
    const r = await withWorkspace(wsC, (tx) => loadToday(tx, { workspaceId: wsC, now: AGORA }));
    const previas = r.waiting.map((w) => w.preview ?? '');
    expect(previas).not.toContain('[voice]');
    expect(previas.some((p) => p.includes('Mensagem de voz'))).toBe(true);
  });

  it('nenhuma prévia devolvida contém colchetes de tipo', async () => {
    const r = await withWorkspace(wsC, (tx) => loadToday(tx, { workspaceId: wsC, now: AGORA }));
    for (const w of r.waiting) {
      expect(w.preview ?? '').not.toMatch(/^\[[a-z_]+\]$/);
    }
  });
});

describe('distribuição — faixas de urgência', () => {
  it('classifica cada lead e conta a fila INTEIRA, não só a página', async () => {
    const r = await withWorkspace(wsC, (tx) => loadToday(tx, { workspaceId: wsC, now: AGORA }));
    const soma = r.waitingBands.esfriando + r.waitingBands.atencao + r.waitingBands.agora;
    // A soma das faixas é o total: nenhum lead fica fora de uma faixa.
    expect(soma).toBe(r.waitingTotal);
  });

  it('os cortes são 15 min e 1 hora', async () => {
    await conversa({
      workspaceId: wsA,
      channelId: canalA,
      nome: 'Fria',
      lastMessageFrom: 'contact',
      minutosAtras: 120,
    });
    const r = await withWorkspace(wsA, (tx) => loadToday(tx, { workspaceId: wsA, now: AGORA }));
    const fria = r.waiting.find((w) => (w.contactName ?? '').startsWith('Fria'));
    expect(fria?.urgency).toBe('esfriando');

    const esperando = r.waiting.find((w) => (w.contactName ?? '').startsWith('Esperando'));
    expect(esperando?.urgency).toBe('atencao'); // 20 min
  });

  it('workspace vazio devolve faixas zeradas, não undefined', async () => {
    const r = await withWorkspace(wsVazio, (tx) =>
      loadToday(tx, { workspaceId: wsVazio, now: AGORA }),
    );
    expect(r.waitingBands).toEqual({ esfriando: 0, atencao: 0, agora: 0 });
  });
});
