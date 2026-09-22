/**
 * F59-S07 — valores personalizados por workspace.
 *
 * Cobre o que o template de workspace vai depender: unicidade da chave por
 * workspace, segredo cifrado que nunca sai pela listagem, resolução não
 * recursiva, chave desconhecida preservada, e isolamento por RLS.
 */
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, getDb } from './client';
import { customValuesRepo, resolveCustomValues } from './repos/custom-values';
import { withWorkspace } from './rls';
import { workspaceCustomValues, workspaces } from './schema';

/** O Drizzle envolve o erro do driver; o SQLSTATE vive na cadeia de `cause`. */
function causaPg(erro: unknown): { code?: string; constraint_name?: string } {
  let atual: unknown = erro;
  for (let i = 0; i < 5 && atual !== null && atual !== undefined; i += 1) {
    const c = atual as { code?: string; constraint_name?: string; cause?: unknown };
    if (typeof c.code === 'string') return c;
    atual = c.cause;
  }
  return {};
}

let wsA = '';
let wsB = '';
let suffix = '';

beforeAll(async () => {
  const db = getDb();
  suffix = randomUUID().slice(0, 8);
  const [a] = await db
    .insert(workspaces)
    .values({ name: `CV A ${suffix}`, slug: `cv-a-${suffix}` })
    .returning();
  const [b] = await db
    .insert(workspaces)
    .values({ name: `CV B ${suffix}`, slug: `cv-b-${suffix}` })
    .returning();
  if (!a || !b) throw new Error('Falha ao criar workspaces.');
  wsA = a.id;
  wsB = b.id;
});

afterAll(async () => {
  const db = getDb();
  for (const id of [wsA, wsB]) {
    if (id) await db.delete(workspaces).where(eq(workspaces.id, id));
  }
  await closeDb();
});

describe('resolveCustomValues (puro)', () => {
  const mapa = new Map([
    ['nome_empresa', 'Sunrise Remodeling'],
    ['link_review', 'https://g.page/r/abc'],
  ]);

  it('substitui as chaves conhecidas', () => {
    const r = resolveCustomValues('Oi, aqui é a {{nome_empresa}}!', mapa);
    expect(r.text).toBe('Oi, aqui é a Sunrise Remodeling!');
    expect(r.unresolved).toEqual([]);
  });

  it('tolera espaço dentro das chaves', () => {
    expect(resolveCustomValues('{{ nome_empresa }}', mapa).text).toBe('Sunrise Remodeling');
  });

  it('deixa chave desconhecida INTACTA e reporta', () => {
    // Apagar silenciosamente produziria "Olá, , tudo bem?" sem erro nenhum —
    // mensagem quebrada que ninguém percebe até o cliente reclamar.
    const r = resolveCustomValues('Olá {{nome_cliente}}, da {{nome_empresa}}', mapa);
    expect(r.text).toContain('{{nome_cliente}}');
    expect(r.text).toContain('Sunrise Remodeling');
    expect(r.unresolved).toEqual(['nome_cliente']);
  });

  it('reporta cada chave desconhecida uma vez só', () => {
    const r = resolveCustomValues('{{xx}} {{xx}} {{xx}}', mapa);
    expect(r.unresolved).toEqual(['xx']);
  });

  it('NÃO é recursivo — decisão de segurança, não simplificação', () => {
    // O valor é controlado pelo usuário e vai parar dentro de prompt de agente.
    // Expandir valor-dentro-de-valor abriria injeção e laço.
    const m = new Map([
      ['aa', '{{bb}}'],
      ['bb', 'EXPANDIDO'],
    ]);
    expect(resolveCustomValues('{{aa}}', m).text).toBe('{{bb}}');
  });

  it('ignora placeholder com formato inválido', () => {
    // Maiuscula, comeco por digito, traco e chave de 1 caractere sao todos
    // invalidos: a chave e digitada a mao dentro de {{...}}, entao o formato e
    // restrito de proposito.
    const r = resolveCustomValues('{{Nome}} {{1x}} {{com-traco}} {{a}}', mapa);
    expect(r.text).toBe('{{Nome}} {{1x}} {{com-traco}} {{a}}');
    expect(r.unresolved).toEqual([]);
  });

  it('texto sem placeholder passa intacto', () => {
    expect(resolveCustomValues('sem nada', mapa).text).toBe('sem nada');
  });
});

describe('persistência', () => {
  it('cria e lista', async () => {
    await withWorkspace(wsA, (tx) =>
      customValuesRepo.upsert(tx, {
        workspaceId: wsA,
        key: 'nome_empresa',
        label: 'Nome da empresa',
        value: 'Sunrise Remodeling',
        kind: 'text',
      }),
    );
    const lista = await withWorkspace(wsA, (tx) => customValuesRepo.list(tx, wsA));
    expect(lista).toHaveLength(1);
    expect(lista[0]).toMatchObject({ key: 'nome_empresa', value: 'Sunrise Remodeling' });
  });

  it('upsert pela chave não duplica', async () => {
    for (const v of ['Um', 'Dois', 'Tres']) {
      await withWorkspace(wsA, (tx) =>
        customValuesRepo.upsert(tx, {
          workspaceId: wsA,
          key: 'endereco',
          label: 'Endereço',
          value: v,
          kind: 'text',
        }),
      );
    }
    const rows = await withWorkspace(wsA, (tx) =>
      tx
        .select()
        .from(workspaceCustomValues)
        .where(
          and(
            eq(workspaceCustomValues.workspaceId, wsA),
            eq(workspaceCustomValues.key, 'endereco'),
          ),
        ),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.value).toBe('Tres');
  });

  it('CHECK rejeita chave fora do formato', async () => {
    const erro = await withWorkspace(wsA, (tx) =>
      tx.insert(workspaceCustomValues).values({
        workspaceId: wsA,
        key: 'Chave Invalida',
        label: 'x',
        value: 'y',
        kind: 'text',
      }),
    ).then(
      () => null,
      (e: unknown) => e,
    );
    expect(causaPg(erro).code).toBe('23514'); // check_violation
    expect(causaPg(erro).constraint_name).toBe('workspace_custom_values_key_chk');
  });

  it('remove apaga só a chave daquele workspace', async () => {
    for (const ws of [wsA, wsB]) {
      await withWorkspace(ws, (tx) =>
        customValuesRepo.upsert(tx, {
          workspaceId: ws,
          key: 'compartilhada',
          label: 'Compartilhada',
          value: `valor-${ws.slice(0, 4)}`,
          kind: 'text',
        }),
      );
    }
    await withWorkspace(wsA, (tx) => customValuesRepo.remove(tx, wsA, 'compartilhada'));

    const emA = await withWorkspace(wsA, (tx) => customValuesRepo.list(tx, wsA));
    const emB = await withWorkspace(wsB, (tx) => customValuesRepo.list(tx, wsB));
    expect(emA.map((v) => v.key)).not.toContain('compartilhada');
    expect(emB.map((v) => v.key)).toContain('compartilhada');
  });
});

describe('segredo', () => {
  it('é cifrado em repouso e NUNCA volta na listagem', async () => {
    const segredo = 'EAABsbCS1iHgBO0000TOKEN0000';
    await withWorkspace(wsA, (tx) =>
      customValuesRepo.upsert(tx, {
        workspaceId: wsA,
        key: 'capi_token',
        label: 'Token da API de Conversões',
        value: segredo,
        kind: 'secret',
      }),
    );

    const bruto = await withWorkspace(wsA, (tx) =>
      tx
        .select()
        .from(workspaceCustomValues)
        .where(
          and(
            eq(workspaceCustomValues.workspaceId, wsA),
            eq(workspaceCustomValues.key, 'capi_token'),
          ),
        ),
    );
    // No banco não está em claro.
    expect(bruto[0]?.value).not.toBe(segredo);
    expect(bruto[0]?.value.length).toBeGreaterThan(segredo.length);

    const lista = await withWorkspace(wsA, (tx) => customValuesRepo.list(tx, wsA));
    const item = lista.find((v) => v.key === 'capi_token');
    expect(item?.value).toBeNull();
    expect(item?.hasValue).toBe(true);
  });

  it('só o mapa de renderização decifra', async () => {
    const mapa = await withWorkspace(wsA, (tx) => customValuesRepo.resolveMap(tx, wsA));
    expect(mapa.get('capi_token')).toBe('EAABsbCS1iHgBO0000TOKEN0000');
    expect(mapa.get('nome_empresa')).toBe('Sunrise Remodeling');
  });
});

describe('RLS', () => {
  it('workspace não lê valor de outro', async () => {
    await withWorkspace(wsB, (tx) =>
      customValuesRepo.upsert(tx, {
        workspaceId: wsB,
        key: 'so_do_b',
        label: 'Só do B',
        value: 'segredo do B',
        kind: 'text',
      }),
    );
    const deA = await withWorkspace(wsA, (tx) => customValuesRepo.list(tx, wsA));
    expect(deA.map((v) => v.key)).not.toContain('so_do_b');
  });

  it('escrita cross-workspace é barrada', async () => {
    const erro = await withWorkspace(wsB, (tx) =>
      tx.insert(workspaceCustomValues).values({
        workspaceId: wsA,
        key: 'invasor',
        label: 'x',
        value: 'y',
        kind: 'text',
      }),
    ).then(
      () => null,
      (e: unknown) => e,
    );
    expect(erro).not.toBeNull();
  });
});
