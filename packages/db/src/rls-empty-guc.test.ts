import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from './schema';
import { contacts, plans, workspaces } from './schema';

/**
 * Regressão F40-S01: o GUC `app.workspace_id`, depois de setado via set_config(local)
 * numa conexão física, reverte ao fim da transação para string vazia ('') — não para
 * NULL. As policies RLS castavam `(current_setting(...))::uuid`; numa conexão reusada
 * do pool (pós-withWorkspace) o cast virava `''::uuid` e estourava
 * `invalid input syntax for type uuid: ""` em toda query cross-tenant via getDb()
 * (schedulers flow-wakeup / automations). Fix: helper `app_current_workspace()` com
 * `nullif(current_setting(...), '')::uuid` — '' e NULL viram "sem workspace" (0 rows).
 *
 * Usa um cliente com `max: 1` (uma única conexão física) para reproduzir o reuso de
 * conexão "envenenada" de forma determinística — com o pool de 20 conexões a conexão
 * reusada seria não-determinística e o teste ficaria flaky.
 */
const url = process.env['DATABASE_URL'];
const client = postgres(url ?? '', { max: 1 });
const db = drizzle(client, { schema });

let wsA = '';
let wsB = '';

beforeAll(async () => {
  const [free] = await db.select().from(plans).where(eq(plans.key, 'free'));
  const planId = free?.id ?? null;
  const sfx = randomUUID().slice(0, 8);

  const [a] = await db
    .insert(workspaces)
    .values({ name: 'GUC A', slug: `guc-a-${sfx}`, planId })
    .returning();
  const [b] = await db
    .insert(workspaces)
    .values({ name: 'GUC B', slug: `guc-b-${sfx}`, planId })
    .returning();
  if (!a || !b) throw new Error('Falha ao criar workspaces de teste.');
  wsA = a.id;
  wsB = b.id;

  // Inseridos como owner (bypassa RLS no setup).
  await db.insert(contacts).values({ workspaceId: wsA, displayName: 'Lead A' });
  await db.insert(contacts).values({ workspaceId: wsB, displayName: 'Lead B' });
});

afterAll(async () => {
  if (wsA) await db.delete(contacts).where(eq(contacts.workspaceId, wsA));
  if (wsB) await db.delete(contacts).where(eq(contacts.workspaceId, wsB));
  if (wsA) await db.delete(workspaces).where(eq(workspaces.id, wsA));
  if (wsB) await db.delete(workspaces).where(eq(workspaces.id, wsB));
  await client.end();
});

/** Envenena a conexão: roda como hm_app no workspace `wsId` e commita (set local). */
async function runAsWorkspace(wsId: string): Promise<ReadonlyArray<Record<string, unknown>>> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`set local role hm_app`);
    await tx.execute(sql`select set_config('app.workspace_id', ${wsId}, true)`);
    return tx.execute(sql`select id, workspace_id from contacts`);
  });
}

describe('RLS — GUC app.workspace_id vazio (F40-S01)', () => {
  it('o helper trata o GUC vazio como NULL e o cast cru estouraria', async () => {
    // Reproduz o veneno: set local + commit deixa current_setting = '' na conexão.
    await runAsWorkspace(wsA);

    const poison = await db.execute(sql`select current_setting('app.workspace_id', true) as v`);
    expect(poison[0]?.['v']).toBe(''); // condição exata do bug (não é NULL)

    // O cast cru do GUC vazio estoura — mecanismo do bug.
    await expect(
      db.execute(sql`select (current_setting('app.workspace_id', true))::uuid`),
    ).rejects.toThrow();

    // O helper (usado pelas policies) devolve NULL em vez de estourar.
    const helper = await db.execute(sql`select app_current_workspace() as ws`);
    expect(helper[0]?.['ws']).toBeNull();
  });

  it('query cross-tenant logo após withWorkspace na mesma conexão NÃO lança', async () => {
    // 1. Envenena a conexão (mesma física, max:1).
    await runAsWorkspace(wsA);

    // 2. Confirma o veneno.
    const poison = await db.execute(sql`select current_setting('app.workspace_id', true) as v`);
    expect(poison[0]?.['v']).toBe('');

    // 3. Query cross-tenant como hm_app SEM setar o GUC (cenário do scheduler):
    //    antes do fix lançava 'invalid input syntax for type uuid: ""'; agora 0 rows.
    const rows = await db.transaction(async (tx) => {
      await tx.execute(sql`set local role hm_app`);
      return tx.execute(sql`select id from contacts`);
    });
    expect(rows.length).toBe(0);
  });

  it('isolamento de tenant preservado: dentro de A não se lê dados de B', async () => {
    const rows = await runAsWorkspace(wsA);
    const seen = new Set<unknown>(rows.map((r) => r['workspace_id']));
    expect(seen.has(wsA)).toBe(true);
    expect(seen.has(wsB)).toBe(false);

    const rowsB = await runAsWorkspace(wsB);
    const seenB = new Set<unknown>(rowsB.map((r) => r['workspace_id']));
    expect(seenB.has(wsB)).toBe(true);
    expect(seenB.has(wsA)).toBe(false);
  });
});
