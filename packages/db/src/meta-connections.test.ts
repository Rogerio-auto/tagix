/**
 * F69-S02 — conexões Meta contra Postgres de verdade.
 *
 * O que este arquivo protege:
 *
 * 1. **Isolamento por RLS.** Um workspace não enxerga a conexão de outro — é onde
 *    mora o token que opera os anúncios e os leads do cliente.
 * 2. **Os callbacks da Meta acham a pessoa em qualquer workspace.** O pedido de
 *    exclusão chega sem workspace; as funções `SECURITY DEFINER` da 0079 são a
 *    única exceção à RLS, e precisam funcionar sob o papel da aplicação.
 * 3. **Reconectar acumula casos de uso.** Quem conecta anúncios não pode perder os
 *    leads que já tinha.
 */
import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, getDb } from './client';
import { metaConnectionsRepo } from './repos/meta-connections';
import { withWorkspace } from './rls';
import { metaConnections, workspaces } from './schema';

let wsA = '';
let wsB = '';
let asid = '';
const agora = new Date('2026-09-14T12:00:00Z');

const base = (workspaceId: string, useCases: string[]) => ({
  workspaceId,
  metaUserId: asid,
  metaUserName: 'Ana',
  accessTokenEnc: 'cifrado-de-teste',
  keyVersion: 1,
  tokenExpiresAt: null,
  useCases,
  grantedPermissions: ['ads_read'],
  declinedPermissions: [],
  assets: { pages: [], adAccounts: [] },
  connectedBy: null,
  now: agora,
});

beforeAll(async () => {
  const db = getDb();
  const s = randomUUID().slice(0, 8);
  asid = `asid-${s}`;
  const [a] = await db.insert(workspaces).values({ name: `Meta A ${s}`, slug: `meta-a-${s}` }).returning();
  const [b] = await db.insert(workspaces).values({ name: `Meta B ${s}`, slug: `meta-b-${s}` }).returning();
  wsA = a!.id;
  wsB = b!.id;
});

afterAll(async () => {
  const db = getDb();
  for (const id of [wsA, wsB]) if (id) await db.delete(workspaces).where(eq(workspaces.id, id));
  await closeDb();
});

describe('conexão por workspace', () => {
  it('cria e reconectar acumula casos de uso', async () => {
    await withWorkspace(wsA, (tx) => metaConnectionsRepo.upsert(tx, base(wsA, ['leads'])));
    const depois = await withWorkspace(wsA, (tx) =>
      metaConnectionsRepo.upsert(tx, base(wsA, ['ads_read'])),
    );
    expect([...depois.useCases].sort()).toEqual(['ads_read', 'leads']);

    const lista = await withWorkspace(wsA, (tx) => metaConnectionsRepo.listForWorkspace(tx, wsA));
    expect(lista).toHaveLength(1);
  });

  it('a listagem nunca carrega o token', async () => {
    const [c] = await withWorkspace(wsA, (tx) => metaConnectionsRepo.listForWorkspace(tx, wsA));
    expect(c).toBeDefined();
    expect(Object.keys(c ?? {})).not.toContain('accessTokenEnc');
  });

  it('RLS: o workspace B não vê a conexão do A, nem pedindo pelo id do A', async () => {
    const [c] = await withWorkspace(wsA, (tx) => metaConnectionsRepo.listForWorkspace(tx, wsA));
    const doB = await withWorkspace(wsB, (tx) => metaConnectionsRepo.listForWorkspace(tx, wsA));
    expect(doB).toEqual([]);
    const tentativa = await withWorkspace(wsB, (tx) =>
      metaConnectionsRepo.getWithToken(tx, wsA, c!.id),
    );
    expect(tentativa).toBeNull();
  });

  it('conexão ativa sem token é recusada pelo banco', async () => {
    // O erro é capturado FORA da transação: dentro dela, o INSERT recusado aborta a
    // transação e o commit também rejeita — capturar só a query deixaria o teste
    // falhar por um motivo que não é o que ele quer provar.
    const erro = await withWorkspace(wsA, (tx) =>
      tx
        .insert(metaConnections)
        .values({ workspaceId: wsA, metaUserId: `sem-token-${asid}`, status: 'active', accessTokenEnc: null }),
    )
      .then(() => null)
      .catch((e: unknown) => e);
    expect(String((erro as { cause?: unknown })?.cause ?? erro)).toMatch(/meta_connections_token_chk/);
  });
});

describe('callbacks da Meta — atravessam workspaces só pelas funções da 0079', () => {
  it('a mesma pessoa conectada em dois workspaces', async () => {
    await withWorkspace(wsB, (tx) => metaConnectionsRepo.upsert(tx, base(wsB, ['leads'])));
  });

  it('revogar apaga o token nos dois e mantém o registro', async () => {
    const n = await metaConnectionsRepo.revokeMetaUser(asid);
    expect(n).toBe(2);
    for (const ws of [wsA, wsB]) {
      const [c] = await withWorkspace(ws, (tx) =>
        tx.select().from(metaConnections).where(eq(metaConnections.metaUserId, asid)),
      );
      expect(c?.status).toBe('revoked');
      expect(c?.accessTokenEnc).toBeNull();
    }
  });

  it('revogar de novo não conta o que já estava revogado', async () => {
    expect(await metaConnectionsRepo.revokeMetaUser(asid)).toBe(0);
  });

  it('excluir remove a pessoa de todos os workspaces', async () => {
    expect(await metaConnectionsRepo.forgetMetaUser(asid)).toBe(2);
    for (const ws of [wsA, wsB]) {
      const linhas = await withWorkspace(ws, (tx) => metaConnectionsRepo.listForWorkspace(tx, ws));
      expect(linhas.filter((l) => l.metaUserId === asid)).toEqual([]);
    }
  });

  it('pessoa desconhecida devolve 0, não erro', async () => {
    expect(await metaConnectionsRepo.forgetMetaUser('ninguem-conectou')).toBe(0);
  });

  it('as funções não ficam executáveis por PUBLIC', async () => {
    const linhas = await getDb().execute<{ publico: boolean }>(
      sql`select has_function_privilege('public', 'public.meta_forget_user(text)', 'execute') as publico`,
    );
    expect(linhas[0]?.publico).toBe(false);
  });
});
