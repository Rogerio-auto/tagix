/**
 * F73-S11 — `/api/copilot/memory*` pelo router REAL do Copiloto (porta `requireAuth → withRLS →
 * copilotAvailable`) sobre o Postgres de dev: permissão por papel, validação, códigos estáveis,
 * efeito imediato no prompt, cross-tenant (404) e fontes.
 */
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import express, { type Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, copilotMemoryRepo, getDb, schema, withWorkspace } from '@hm/db';
import {
  MemoryFactPageSchema,
  MemoryFactSchema,
  MemoryProfileSchema,
  MemorySourceSchema,
  type Role,
} from '@hm/shared';
import {
  seedCopilotWorkspace,
  type SeededWorkspace,
} from '../../../services/copilot/identity/test-fixtures';
import { registerMemorySource } from '../../../services/copilot/memory';
import { createCopilotRouter } from '../index';

let a: SeededWorkspace;
let b: SeededWorkspace;
let readOnlySub: SeededWorkspace;
let app: Express;

beforeAll(async () => {
  a = await seedCopilotWorkspace({ label: 'MemRoutesA' });
  b = await seedCopilotWorkspace({ label: 'MemRoutesB' });
  readOnlySub = await seedCopilotWorkspace({ label: 'MemRoutesRO', subscriptionStatus: 'expired' });
  app = express();
  app.use(express.json());
  app.use(createCopilotRouter());
});

afterAll(async () => {
  await a?.cleanup();
  await b?.cleanup();
  await readOnlySub?.cleanup();
  await closeDb();
});

const cookie = (role: Role, ws: SeededWorkspace = a): string => ws.members[role].cookie;
const get = (path: string, role: Role = 'OWNER', ws: SeededWorkspace = a) =>
  request(app).get(path).set('Cookie', cookie(role, ws));
const post = (path: string, body: object, role: Role = 'OWNER', ws: SeededWorkspace = a) =>
  request(app).post(path).set('Cookie', cookie(role, ws)).send(body);
const put = (path: string, body: object, role: Role = 'OWNER', ws: SeededWorkspace = a) =>
  request(app).put(path).set('Cookie', cookie(role, ws)).send(body);

const prompt = (ws: SeededWorkspace = a) =>
  withWorkspace(ws.workspaceId, (tx) => copilotMemoryRepo.listActiveForPrompt(tx, ws.workspaceId));

async function teach(content: string, role: Role = 'SUPERVISOR', ws: SeededWorkspace = a) {
  const res = await post('/api/copilot/memory/facts', { content }, role, ws);
  expect(res.status).toBe(201);
  return MemoryFactSchema.parse(res.body);
}

describe('permissões: AGENT lê, SUPERVISOR escreve', () => {
  it('leitura com copilot.use (todos os papéis); escrita só com copilot.memory.edit', async () => {
    for (const role of ['AGENT', 'SUPERVISOR', 'ADMIN', 'OWNER'] as const) {
      expect((await get('/api/copilot/memory/profile', role)).status).toBe(200);
      expect((await get('/api/copilot/memory/facts', role)).status).toBe(200);
      expect((await get('/api/copilot/memory/sources', role)).status).toBe(200);
    }
    // AGENT não escreve em nenhuma rota (e nada muda).
    const fact = await teach('Fato para o teste de papel.');
    const denied = [
      await put('/api/copilot/memory/profile', { tone: 'x' }, 'AGENT'),
      await post('/api/copilot/memory/facts', { content: 'x' }, 'AGENT'),
      await post(`/api/copilot/memory/facts/${fact.id}/forget`, {}, 'AGENT'),
      await post(`/api/copilot/memory/facts/${fact.id}/restore`, {}, 'AGENT'),
      await post(`/api/copilot/memory/facts/${fact.id}/correct`, { content: 'x' }, 'AGENT'),
    ];
    expect(denied.map((r) => r.status)).toEqual([403, 403, 403, 403, 403]);
    expect((await prompt()).facts.some((f) => f.id === fact.id)).toBe(true);

    // READONLY tem copilot.use (lê), mas não copilot.memory.edit (não escreve).
    expect((await get('/api/copilot/memory/facts', 'READONLY')).status).toBe(200);
    expect((await post('/api/copilot/memory/facts', { content: 'x' }, 'READONLY')).status).toBe(
      403,
    );
    expect((await put('/api/copilot/memory/profile', { tone: 'x' }, 'READONLY')).status).toBe(403);
    // Sem sessão → 401.
    expect((await request(app).get('/api/copilot/memory/facts')).status).toBe(401);
  });

  it('assinatura vencida (só leitura): lê, mas escrever é 402', async () => {
    expect((await get('/api/copilot/memory/facts', 'OWNER', readOnlySub)).status).toBe(200);
    const res = await post('/api/copilot/memory/facts', { content: 'x' }, 'OWNER', readOnlySub);
    expect(res.status).toBe(402);
  });
});

describe('perfil', () => {
  it('PUT parcial → GET devolve as 5 chaves no contrato; vazio limpa; > 500 → 400', async () => {
    const put1 = await put(
      '/api/copilot/memory/profile',
      { what_we_sell: 'Clínica odontológica', hours: 'Seg a sex, 8h às 19h' },
      'SUPERVISOR',
    );
    expect(put1.status).toBe(200);
    const profile = MemoryProfileSchema.parse(put1.body);
    expect(profile.entries.map((e) => e.key)).toEqual([
      'what_we_sell',
      'avg_ticket',
      'tone',
      'hours',
      'commercial_rules',
    ]);
    expect(profile.entries.find((e) => e.key === 'hours')).toMatchObject({
      content: 'Seg a sex, 8h às 19h',
      updated_by: { member_id: a.members.SUPERVISOR.id },
    });
    expect(profile.entries.find((e) => e.key === 'tone')?.content).toBeNull();

    // O AGENT lê o que o SUPERVISOR escreveu.
    const read = await get('/api/copilot/memory/profile', 'AGENT');
    expect(
      MemoryProfileSchema.parse(read.body).entries.find((e) => e.key === 'what_we_sell')?.content,
    ).toBe('Clínica odontológica');

    // Limpar.
    const cleared = await put('/api/copilot/memory/profile', { hours: '' }, 'ADMIN');
    expect(
      MemoryProfileSchema.parse(cleared.body).entries.find((e) => e.key === 'hours')?.content,
    ).toBeNull();
    expect((await prompt()).profile.map((p) => p.key)).toEqual(['what_we_sell']);

    // > 500 → 400; corpo vazio, chave desconhecida e tipo errado também.
    const tooLong = await put('/api/copilot/memory/profile', { tone: 'x'.repeat(501) }, 'OWNER');
    expect(tooLong.status).toBe(400);
    expect(tooLong.body).toMatchObject({ error: 'invalid_payload' });
    expect(JSON.stringify(tooLong.body)).not.toContain('xxxxxxxxxx');
    expect((await put('/api/copilot/memory/profile', {}, 'OWNER')).status).toBe(400);
    expect((await put('/api/copilot/memory/profile', { outra: 'x' }, 'OWNER')).status).toBe(400);
    expect((await put('/api/copilot/memory/profile', { tone: 5 }, 'OWNER')).status).toBe(400);
    // 500 exatos passa.
    expect(
      (await put('/api/copilot/memory/profile', { tone: 'y'.repeat(500) }, 'OWNER')).status,
    ).toBe(200);
  });
});

describe('fatos', () => {
  it('ensinar → listar → esquecer (prompt muda na hora) → restaurar → corrigir', async () => {
    const fact = await teach('Parcelamos em até 12 vezes.');
    expect(fact).toMatchObject({
      status: 'active',
      source_type: 'member',
      created_by: { member_id: a.members.SUPERVISOR.id },
    });
    expect(fact.source_label).toMatch(/^Escrito por SUPERVISOR /);

    const list = MemoryFactPageSchema.parse((await get('/api/copilot/memory/facts', 'AGENT')).body);
    expect(list.data.some((f) => f.id === fact.id)).toBe(true);

    const forgot = await post(`/api/copilot/memory/facts/${fact.id}/forget`, {}, 'SUPERVISOR');
    expect(forgot.status).toBe(200);
    expect(MemoryFactSchema.parse(forgot.body)).toMatchObject({
      status: 'forgotten',
      can_restore: true,
    });
    expect((await prompt()).facts.some((f) => f.id === fact.id)).toBe(false);

    const restored = await post(`/api/copilot/memory/facts/${fact.id}/restore`, {}, 'SUPERVISOR');
    expect(restored.status).toBe(200);
    expect(MemoryFactSchema.parse(restored.body).status).toBe('active');
    expect((await prompt()).facts.some((f) => f.id === fact.id)).toBe(true);

    const corrected = await post(
      `/api/copilot/memory/facts/${fact.id}/correct`,
      { content: 'Parcelamos em até 10 vezes.' },
      'ADMIN',
    );
    expect(corrected.status).toBe(200);
    const fixed = MemoryFactSchema.parse(corrected.body);
    expect(fixed).toMatchObject({
      status: 'active',
      source_type: 'member',
      content: 'Parcelamos em até 10 vezes.',
    });
    expect(fixed.id).not.toBe(fact.id);
    const p = await prompt();
    expect(p.facts.some((f) => f.id === fact.id)).toBe(false);
    expect(p.facts.some((f) => f.id === fixed.id)).toBe(true);
    // O original (superseded) saiu da lista.
    const after = MemoryFactPageSchema.parse(
      (await get('/api/copilot/memory/facts?limit=50')).body,
    );
    expect(after.data.some((f) => f.id === fact.id)).toBe(false);
  });

  it('restaurar depois de 24 h → 409; fato ativo não se restaura → 409; corrigir/esquecer superseded → 409', async () => {
    const fact = await teach('Prazo de entrega: 7 dias.');
    await post(`/api/copilot/memory/facts/${fact.id}/forget`, {}, 'OWNER');
    await getDb()
      .update(schema.copilotMemoryEntries)
      .set({ forgottenAt: new Date(Date.now() - 25 * 3600_000) })
      .where(eq(schema.copilotMemoryEntries.id, fact.id));
    const late = await post(`/api/copilot/memory/facts/${fact.id}/restore`, {}, 'OWNER');
    expect(late.status).toBe(409);
    expect(late.body).toMatchObject({ error: 'restore_window_closed' });
    expect(late.body.message).toMatch(/24 horas/);

    const live = await teach('Fato vivo.');
    const notForgotten = await post(`/api/copilot/memory/facts/${live.id}/restore`, {}, 'OWNER');
    expect(notForgotten.status).toBe(409);
    expect(notForgotten.body).toMatchObject({ error: 'not_forgotten' });

    await post(
      `/api/copilot/memory/facts/${live.id}/correct`,
      { content: 'Fato vivo v2.' },
      'OWNER',
    );
    const staleCorrect = await post(
      `/api/copilot/memory/facts/${live.id}/correct`,
      { content: 'v3' },
      'OWNER',
    );
    expect(staleCorrect.status).toBe(409);
    expect(staleCorrect.body).toMatchObject({ error: 'not_active' });
    expect((await post(`/api/copilot/memory/facts/${live.id}/forget`, {}, 'OWNER')).status).toBe(
      409,
    );
  });

  it('validação: conteúdo vazio, > 300, campo extra → 400; id malformado → 404; cursor ruim → 400', async () => {
    expect((await post('/api/copilot/memory/facts', { content: '   ' })).status).toBe(400);
    expect((await post('/api/copilot/memory/facts', { content: 'x'.repeat(301) })).status).toBe(
      400,
    );
    expect(
      (await post('/api/copilot/memory/facts', { content: 'ok', status: 'active' })).status,
    ).toBe(400);
    expect((await post('/api/copilot/memory/facts', {})).status).toBe(400);
    expect((await post('/api/copilot/memory/facts', { content: 'x'.repeat(300) })).status).toBe(
      201,
    );
    expect((await post('/api/copilot/memory/facts/nao-e-uuid/forget', {})).status).toBe(404);
    expect(
      (await post(`/api/copilot/memory/facts/${randomUUID()}/correct`, { content: 'x' })).status,
    ).toBe(404);
    expect((await get('/api/copilot/memory/facts?cursor=lixo')).status).toBe(400);
    expect((await get('/api/copilot/memory/facts?limit=0')).status).toBe(400);
    expect((await get('/api/copilot/memory/facts?limit=51')).status).toBe(400);
  });

  it('limite de 200 fatos ativos: o 201º → 409 com a mensagem clara; esquecer libera', async () => {
    const lim = await seedCopilotWorkspace({ label: 'MemRoutesLimit' });
    try {
      await getDb()
        .insert(schema.copilotMemoryEntries)
        .values(
          Array.from({ length: 200 }, (_, i) => ({
            workspaceId: lim.workspaceId,
            kind: 'fact' as const,
            content: `Fato ${i}`,
            sourceType: 'member' as const,
            sourceLabel: 'Escrito por Alguém',
          })),
        );
      const refused = await post('/api/copilot/memory/facts', { content: 'Mais um' }, 'ADMIN', lim);
      expect(refused.status).toBe(409);
      expect(refused.body).toMatchObject({
        error: 'memory_limit',
        message: 'Esqueça algum fato antes de ensinar outro.',
      });
      const [one] = await getDb()
        .select({ id: schema.copilotMemoryEntries.id })
        .from(schema.copilotMemoryEntries)
        .where(eq(schema.copilotMemoryEntries.workspaceId, lim.workspaceId))
        .limit(1);
      expect(
        (await post(`/api/copilot/memory/facts/${one!.id}/forget`, {}, 'ADMIN', lim)).status,
      ).toBe(200);
      expect(
        (await post('/api/copilot/memory/facts', { content: 'Mais um' }, 'ADMIN', lim)).status,
      ).toBe(201);
    } finally {
      await lim.cleanup();
    }
  });

  it('auditoria: cada escrita grava audit_logs sem o texto do fato', async () => {
    const fact = await teach('Texto confidencial da regra comercial.');
    await post(`/api/copilot/memory/facts/${fact.id}/forget`, {}, 'SUPERVISOR');
    const rows = await withWorkspace(a.workspaceId, (tx) =>
      tx
        .select()
        .from(schema.auditLogs)
        .where(
          and(
            eq(schema.auditLogs.workspaceId, a.workspaceId),
            eq(schema.auditLogs.resourceId, fact.id),
          ),
        ),
    );
    expect(rows.map((r) => r.action).sort()).toEqual([
      'copilot.memory.fact_added',
      'copilot.memory.fact_forgotten',
    ]);
    expect(
      rows.every((r) => r.actorMemberId === a.members.SUPERVISOR.id && r.actorType === 'member'),
    ).toBe(true);
    expect(JSON.stringify(rows.map((r) => r.metadata))).not.toContain('confidencial');
  });
});

describe('cross-tenant: fato de outro workspace → 404 em todas as rotas', () => {
  it('B não enxerga, não esquece, não restaura e não corrige o fato de A (e A segue intacto)', async () => {
    const fact = await teach('Segredo de A.');
    await post(`/api/copilot/memory/facts/${fact.id}/forget`, {}, 'OWNER');
    const live = await teach('Outro segredo de A.');
    const paths = [
      [`/api/copilot/memory/facts/${live.id}/forget`, {}],
      [`/api/copilot/memory/facts/${fact.id}/restore`, {}],
      [`/api/copilot/memory/facts/${live.id}/correct`, { content: 'adulterado' }],
    ] as const;
    for (const [path, body] of paths) {
      const res = await post(path, body, 'OWNER', b);
      expect(res.status, path).toBe(404);
      expect(res.body).toMatchObject({ error: 'not_found' });
    }
    const listB = MemoryFactPageSchema.parse(
      (await get('/api/copilot/memory/facts?limit=50', 'OWNER', b)).body,
    );
    expect(listB.data).toHaveLength(0);
    expect((await prompt(b)).facts).toHaveLength(0);
    const stillA = await withWorkspace(a.workspaceId, (tx) =>
      tx
        .select({
          status: schema.copilotMemoryEntries.status,
          content: schema.copilotMemoryEntries.content,
        })
        .from(schema.copilotMemoryEntries)
        .where(eq(schema.copilotMemoryEntries.id, live.id)),
    );
    expect(stillA).toEqual([{ status: 'active', content: 'Outro segredo de A.' }]);
  });
});

describe('GET /memory/sources', () => {
  it('contagens reais do workspace e o seam de fonte externa (provider fake)', async () => {
    const ws = a.workspaceId;
    await getDb()
      .insert(schema.kbDocuments)
      .values([
        {
          workspaceId: ws,
          title: 'FAQ',
          source: 'manual',
          rawContent: 'a',
          contentSha256: randomUUID(),
        },
        {
          workspaceId: ws,
          title: 'Preços',
          source: 'manual',
          rawContent: 'b',
          contentSha256: randomUUID(),
        },
        {
          workspaceId: ws,
          title: 'Velho',
          source: 'manual',
          status: 'archived',
          rawContent: 'c',
          contentSha256: randomUUID(),
        },
      ]);
    await getDb()
      .insert(schema.products)
      .values([
        { workspaceId: ws, name: 'P1' },
        { workspaceId: ws, name: 'P2' },
        { workspaceId: ws, name: 'P3' },
      ]);

    const res = await get('/api/copilot/memory/sources', 'AGENT');
    expect(res.status).toBe(200);
    const data = (res.body as { data: unknown[] }).data.map((s) => MemorySourceSchema.parse(s));
    const by = Object.fromEntries(data.map((s) => [s.key, s]));
    expect(by['knowledge']?.detail).toMatch(/^2 documentos/);
    expect(by['products']?.detail).toBe('3 produtos no catálogo');

    const off = registerMemorySource({
      key: 'erp',
      label: 'ERP',
      load: () => [
        { key: 'erp', label: 'ERP · pedidos', status: 'ok', detail: '1.204 pedidos sincronizados' },
      ],
    });
    try {
      const withErp = (await get('/api/copilot/memory/sources')).body as {
        data: { key: string }[];
      };
      expect(withErp.data.map((s) => s.key)).toEqual([
        'knowledge',
        'products',
        'pipeline',
        'inbox',
        'erp',
      ]);
      // O seam é global do processo; mas as nativas continuam sendo do workspace de quem pergunta.
      const fromB = (await get('/api/copilot/memory/sources', 'OWNER', b)).body as {
        data: { key: string; detail: string }[];
      };
      expect(fromB.data.find((s) => s.key === 'knowledge')?.detail).toBe(
        'Nenhum documento ativo ainda',
      );
    } finally {
      off();
    }
    const without = (await get('/api/copilot/memory/sources')).body as { data: { key: string }[] };
    expect(without.data.map((s) => s.key)).toEqual(['knowledge', 'products', 'pipeline', 'inbox']);
  });
});
