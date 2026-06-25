/**
 * Testes de shape das queries do Command Center v2 (F48-S02 / DASHBOARD §5/§9.3).
 * Foco: as 3 novas fontes (leaderboard com avatar, leads recentes distinct-por-contato,
 * série 30d da MV com filtro de workspace) + o enriquecimento `avatarUrl` dos rankings
 * member-based, sem alterar `columns`.
 *
 * Roda contra o Postgres local (infra Docker UP). Workspace isolado, semeado e sob RLS.
 */
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, getDb, schema, withWorkspace } from '@hm/db';
import {
  conversoesPorAtendenteHumano,
  leaderboardProdutividade,
  leadsRecentes,
  serieDesempenho30d,
} from './queries';

const { workspaces, members, contacts, conversations, channels, conversionTypes, conversionEvents } =
  schema;

let ws = '';
let memberId = '';
let contactA = '';
let contactB = '';

beforeAll(async () => {
  const db = getDb();
  const sfx = randomUUID().slice(0, 8);
  const [w] = await db
    .insert(workspaces)
    .values({ name: 'DashQ', slug: `dashq-${sfx}` })
    .returning();
  if (!w) throw new Error('ws');
  ws = w.id;

  const [m] = await db
    .insert(members)
    .values({
      workspaceId: ws,
      authUserId: randomUUID(),
      email: `dashq-${sfx}@t.local`,
      name: 'Atendente Foto',
      avatarUrl: 'https://cdn.local/m.png',
      role: 'AGENT',
      status: 'active',
    })
    .returning();
  if (!m) throw new Error('member');
  memberId = m.id;

  const [ch] = await db
    .insert(channels)
    .values({
      workspaceId: ws,
      provider: 'meta_whatsapp',
      name: `WA ${sfx}`,
      phoneNumberId: `pnid-${sfx}`,
      wabaId: `waba-${sfx}`,
    })
    .returning();
  if (!ch) throw new Error('channel');

  const [ca] = await db
    .insert(contacts)
    .values({
      workspaceId: ws,
      displayName: 'Lead A',
      avatarUrl: 'https://cdn.local/a.png',
      phone: `+5511900${sfx.slice(0, 5)}`,
    })
    .returning();
  const [cb] = await db
    .insert(contacts)
    .values({ workspaceId: ws, displayName: 'Lead B', phone: `+5511901${sfx.slice(0, 5)}` })
    .returning();
  if (!ca || !cb) throw new Error('contacts');
  contactA = ca.id;
  contactB = cb.id;

  const older = new Date(Date.now() - 3600_000);
  const newer = new Date(Date.now() - 60_000);
  const newest = new Date(Date.now() - 30_000);

  // Contato A com 2 conversas (distinct-on deve colapsar p/ a mais recente).
  // 1 open atribuída ao member + 1 closed hoje (resolvida) p/ o leaderboard.
  await db.insert(conversations).values([
    {
      workspaceId: ws,
      channelId: ch.id,
      contactId: contactA,
      remoteId: `a1-${sfx}`,
      status: 'open',
      assignedTo: memberId,
      lastMessageAt: older,
      lastMessagePreview: 'mensagem antiga',
    },
    {
      workspaceId: ws,
      channelId: ch.id,
      contactId: contactA,
      remoteId: `a2-${sfx}`,
      status: 'closed',
      assignedTo: memberId,
      updatedAt: new Date(),
      lastMessageAt: newest,
      lastMessagePreview: 'mensagem recente A',
    },
    {
      workspaceId: ws,
      channelId: ch.id,
      contactId: contactB,
      remoteId: `b1-${sfx}`,
      status: 'open',
      lastMessageAt: newer,
      lastMessagePreview: 'mensagem B',
    },
  ]);

  const [ct] = await db
    .insert(conversionTypes)
    .values({ workspaceId: ws, key: 'venda', label: 'Venda' })
    .returning();
  if (!ct) throw new Error('conversion type');
  await db.insert(conversionEvents).values({
    workspaceId: ws,
    conversionTypeId: ct.id,
    contactId: contactA,
    source: 'manual',
    valueCents: 5000,
    triggeredByMemberId: memberId,
  });
});

afterAll(async () => {
  const db = getDb();
  if (ws) await db.delete(workspaces).where(eq(workspaces.id, ws));
  await closeDb();
});

describe('F48-S02 queries: leaderboard / leads / série (shape)', () => {
  it('leaderboardProdutividade traz avatarUrl e contadores do atendente', async () => {
    const out = await withWorkspace(ws, (tx) => leaderboardProdutividade(tx, ws));
    const rows = out['rows'] as Array<Record<string, unknown>>;
    expect(Array.isArray(rows)).toBe(true);
    const me = rows.find((r) => r['memberId'] === memberId);
    expect(me).toBeDefined();
    expect(me?.['nome']).toBe('Atendente Foto');
    expect(me?.['avatarUrl']).toBe('https://cdn.local/m.png');
    expect(me?.['abertas']).toBe(1);
    expect(me?.['resolvidas']).toBe(1);
    // sem mensagens semeadas → FRT nulo.
    expect(me?.['tmr_seg']).toBeNull();
  });

  it('leadsRecentes é distinct por contato e ordenado por atividade desc', async () => {
    const out = await withWorkspace(ws, (tx) => leadsRecentes(tx, 8));
    const rows = out['rows'] as Array<Record<string, unknown>>;
    // 2 contatos distintos (A colapsado em 1 apesar das 2 conversas).
    const ids = rows.map((r) => r['contactId']);
    expect(new Set(ids).size).toBe(ids.length);
    const a = rows.find((r) => r['contactId'] === contactA);
    expect(a?.['nome']).toBe('Lead A');
    expect(a?.['avatarUrl']).toBe('https://cdn.local/a.png');
    expect(a?.['canal']).toBe('meta_whatsapp');
    // distinct-on pega a conversa mais recente do contato A.
    expect(a?.['preview']).toBe('mensagem recente A');
    expect(typeof a?.['lastActivityAt']).toBe('string');
    // A (newest) vem antes de B (newer).
    const idxA = ids.indexOf(contactA);
    const idxB = ids.indexOf(contactB);
    expect(idxA).toBeLessThan(idxB);
    // avatar ausente → null (fallback de iniciais no front).
    const b = rows.find((r) => r['contactId'] === contactB);
    expect(b?.['avatarUrl']).toBeNull();
  });

  it('serieDesempenho30d retorna a série (array, possivelmente vazia sem refresh da MV)', async () => {
    const out = await withWorkspace(ws, (tx) => serieDesempenho30d(tx, ws));
    expect(Array.isArray(out['series'])).toBe(true);
  });

  it('conversoesPorAtendenteHumano expõe avatarUrl nas rows sem mudar columns', async () => {
    const out = await withWorkspace(ws, (tx) => conversoesPorAtendenteHumano(tx));
    const columns = out.columns.map((c) => c.key);
    // columns inalteradas (compatível com o TableCard atual).
    expect(columns).toEqual(['nome', 'conversoes', 'valor_cents']);
    const me = out.rows.find((r) => r['memberId'] === memberId);
    expect(me?.['avatarUrl']).toBe('https://cdn.local/m.png');
    expect(me?.['conversoes']).toBe(1);
  });
});
