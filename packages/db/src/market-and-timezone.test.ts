/**
 * F59-S02 — mercado no workspace e fuso no contato.
 *
 * Cobre o que a migration promete e o que o resto do sistema vai depender:
 * default seguro (`BR`, que preserva o comportamento atual), CHECK de mercado,
 * fuso opcional por contato e isolamento por RLS das colunas novas.
 */
import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, getDb } from './client';
import { withWorkspace } from './rls';
import { contacts, workspaces } from './schema';

let wsBR = '';
let wsUS = '';
let suffix = '';

beforeAll(async () => {
  const db = getDb();
  suffix = randomUUID().slice(0, 8);

  const [br] = await db
    .insert(workspaces)
    .values({ name: `Mercado BR ${suffix}`, slug: `mercado-br-${suffix}` })
    .returning();
  const [us] = await db
    .insert(workspaces)
    .values({
      name: `Mercado US ${suffix}`,
      slug: `mercado-us-${suffix}`,
      market: 'US',
      locales: ['en-US', 'pt-BR'],
    })
    .returning();
  if (!br || !us) throw new Error('Falha ao criar workspaces do teste de mercado.');
  wsBR = br.id;
  wsUS = us.id;
});

afterAll(async () => {
  const db = getDb();
  for (const id of [wsBR, wsUS]) {
    if (id) await db.delete(workspaces).where(eq(workspaces.id, id));
  }
  await closeDb();
});

describe('workspaces.market', () => {
  it('nasce BR por default — nenhum workspace existente muda de comportamento', async () => {
    const db = getDb();
    const [row] = await db.select().from(workspaces).where(eq(workspaces.id, wsBR));
    expect(row?.market).toBe('BR');
  });

  it('aceita US e guarda os locales escolhidos', async () => {
    const db = getDb();
    const [row] = await db.select().from(workspaces).where(eq(workspaces.id, wsUS));
    expect(row?.market).toBe('US');
    expect(row?.locales).toEqual(['en-US', 'pt-BR']);
  });

  it('locales é nulo por default — significa "usar os do market pack"', async () => {
    const db = getDb();
    const [row] = await db.select().from(workspaces).where(eq(workspaces.id, wsBR));
    expect(row?.locales).toBeNull();
  });

  it('CHECK rejeita mercado desconhecido', async () => {
    const db = getDb();
    // O Drizzle envolve o erro do driver: o nome da constraint vive em `cause`,
    // não na mensagem de topo. Asserir na mensagem daria falso verde no dia em
    // que a rejeição viesse de outra causa (NOT NULL, unique, permissão).
    const erro = await db
      .insert(workspaces)
      .values({
        name: `Mercado XX ${suffix}`,
        slug: `mercado-xx-${suffix}`,
        // Valor inválido só alcançável por SQL cru ou driver externo — é
        // exatamente contra isso que o CHECK existe.
        market: 'XX' as 'BR' | 'US',
      })
      .then(
        () => null,
        (e: unknown) => e,
      );

    expect(erro).not.toBeNull();
    const causa = (erro as { cause?: { code?: string; constraint_name?: string } }).cause;
    expect(causa?.code).toBe('23514'); // check_violation
    expect(causa?.constraint_name).toBe('workspaces_market_chk');
  });
});

describe('contacts.timezone', () => {
  it('é opcional; nulo significa "resolver pelo market pack"', async () => {
    const db = getDb();
    const [row] = await db
      .insert(contacts)
      .values({ workspaceId: wsBR, displayName: `Sem fuso ${suffix}` })
      .returning();
    expect(row?.timezone).toBeNull();
  });

  it('guarda fuso IANA por contato — dois contatos do mesmo workspace em fusos diferentes', async () => {
    const db = getDb();
    const [florida] = await db
      .insert(contacts)
      .values({
        workspaceId: wsUS,
        displayName: `Orlando ${suffix}`,
        timezone: 'America/New_York',
      })
      .returning();
    const [california] = await db
      .insert(contacts)
      .values({
        workspaceId: wsUS,
        displayName: `LA ${suffix}`,
        timezone: 'America/Los_Angeles',
      })
      .returning();

    // É o caso que quebra fuso-por-campanha: mesma base, janelas legais distintas.
    expect(florida?.timezone).toBe('America/New_York');
    expect(california?.timezone).toBe('America/Los_Angeles');
  });

  it('índice parcial de fuso existe e cobre só quem tem fuso próprio', async () => {
    const db = getDb();
    const rows = await db.execute<{ indexdef: string }>(
      sql`select indexdef from pg_indexes where indexname = 'idx_contacts_workspace_timezone'`,
    );
    const def = rows[0]?.indexdef ?? '';
    expect(def).toContain('timezone IS NOT NULL');
    expect(def).toContain('deleted_at IS NULL');
  });
});

describe('RLS nas colunas novas', () => {
  it('workspace não enxerga contato de outro, inclusive o fuso', async () => {
    const db = getDb();
    await db
      .insert(contacts)
      .values({ workspaceId: wsUS, displayName: `Isolado ${suffix}`, timezone: 'America/Chicago' })
      .returning();

    const visiveisDeBR = await withWorkspace(wsBR, async (tx) =>
      tx.select().from(contacts).where(eq(contacts.timezone, 'America/Chicago')),
    );
    expect(visiveisDeBR).toHaveLength(0);

    const visiveisDeUS = await withWorkspace(wsUS, async (tx) =>
      tx.select().from(contacts).where(eq(contacts.timezone, 'America/Chicago')),
    );
    expect(visiveisDeUS.length).toBeGreaterThan(0);
  });
});
