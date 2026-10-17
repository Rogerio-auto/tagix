/**
 * F73-S11 — serviço da memória do negócio contra o Postgres de dev (RLS de verdade).
 *
 * Cobre: perfil (≤ 500, limpar, trilha sem conteúdo); fatos (fonte, esquecer/restaurar/corrigir
 * e o efeito IMEDIATO em `listActiveForPrompt`, que é o que a sessão injeta a cada turno);
 * teto de 200 fatos; janela de 24 h; cross-tenant; fontes nativas e o seam de fonte externa.
 */
import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, copilotMemoryRepo, getDb, schema, withWorkspace } from '@hm/db';
import { MEMORY_ACTIVE_FACTS_MAX, MemoryProfileUpdateSchema } from '@hm/shared';
import { seedCopilotWorkspace, type SeededWorkspace } from '../identity/test-fixtures';
import {
  MEMORY_SOURCE_PROVIDER_TIMEOUT_MS,
  addMemberFact,
  correctFact,
  forgetFact,
  listFactsPage,
  listMemorySources,
  loadFact,
  loadProfile,
  registerMemorySource,
  restoreFact,
  updateProfile,
} from './index';

let a: SeededWorkspace;
let b: SeededWorkspace;

beforeAll(async () => {
  a = await seedCopilotWorkspace({ label: 'MemA' });
  b = await seedCopilotWorkspace({ label: 'MemB' });
});

afterAll(async () => {
  await a?.cleanup();
  await b?.cleanup();
  await closeDb();
});

const wsA = (): string => a.workspaceId;
const bruna = (): string => a.members.SUPERVISOR.id;
const prompt = () => withWorkspace(wsA(), (tx) => copilotMemoryRepo.listActiveForPrompt(tx, wsA()));

async function teach(content: string) {
  const out = await withWorkspace(wsA(), (tx) =>
    addMemberFact(tx, { workspaceId: wsA(), memberId: bruna(), memberName: 'Bruna Lima', content }),
  );
  if (!out.ok) throw new Error(out.error);
  return out.value;
}

describe('perfil', () => {
  it('devolve sempre as 5 chaves; grava, troca, limpa, e a trilha não leva o texto', async () => {
    const empty = await withWorkspace(wsA(), (tx) => loadProfile(tx, wsA()));
    expect(empty.entries.map((e) => e.key)).toEqual([
      'what_we_sell',
      'avg_ticket',
      'tone',
      'hours',
      'commercial_rules',
    ]);
    expect(empty.entries.every((e) => e.content === null)).toBe(true);

    const update = MemoryProfileUpdateSchema.parse({
      what_we_sell: '  Clínica odontológica  ',
      tone: 'Próximo e cuidadoso',
    });
    const res = await withWorkspace(wsA(), (tx) =>
      updateProfile(tx, {
        workspaceId: wsA(),
        memberId: bruna(),
        memberName: 'Bruna Lima',
        update,
      }),
    );
    expect(res.changed).toEqual(['what_we_sell', 'tone']);

    const filled = await withWorkspace(wsA(), (tx) => loadProfile(tx, wsA()));
    const sell = filled.entries.find((e) => e.key === 'what_we_sell');
    expect(sell?.content).toBe('Clínica odontológica');
    expect(sell?.updated_by?.member_id).toBe(bruna());
    expect((await prompt()).profile.map((p) => p.key).sort()).toEqual(['tone', 'what_we_sell']);

    // Mesmo texto: no-op, sem nova trilha.
    const again = await withWorkspace(wsA(), (tx) =>
      updateProfile(tx, {
        workspaceId: wsA(),
        memberId: bruna(),
        memberName: 'Bruna Lima',
        update: MemoryProfileUpdateSchema.parse({ tone: 'Próximo e cuidadoso' }),
      }),
    );
    expect(again.changed).toEqual([]);

    // Troca e limpa (string vazia): some do prompt na hora; o texto antigo fica como histórico.
    await withWorkspace(wsA(), (tx) =>
      updateProfile(tx, {
        workspaceId: wsA(),
        memberId: bruna(),
        memberName: 'Bruna Lima',
        update: MemoryProfileUpdateSchema.parse({ what_we_sell: 'Odontologia estética', tone: '' }),
      }),
    );
    const p = await prompt();
    expect(p.profile).toEqual([{ key: 'what_we_sell', content: 'Odontologia estética' }]);

    const audit = await getDb()
      .select()
      .from(schema.auditLogs)
      .where(
        and(
          eq(schema.auditLogs.workspaceId, wsA()),
          eq(schema.auditLogs.action, 'copilot.memory.profile_updated'),
        ),
      );
    expect(audit).toHaveLength(2);
    expect(JSON.stringify(audit.map((r) => r.metadata))).not.toMatch(
      /Cl[ií]nica|Odontologia|Próximo/,
    );
    expect(
      audit.some((r) => (r.metadata as { cleared?: string[] }).cleared?.includes('tone')),
    ).toBe(true);
  });

  it('o contrato recusa texto > 500 e corpo vazio', () => {
    expect(MemoryProfileUpdateSchema.safeParse({ tone: 'x'.repeat(501) }).success).toBe(false);
    expect(MemoryProfileUpdateSchema.safeParse({}).success).toBe(false);
    expect(MemoryProfileUpdateSchema.safeParse({ tone: 'x'.repeat(500) }).success).toBe(true);
  });
});

describe('fatos: esquecer, restaurar e corrigir mudam o prompt na hora', () => {
  it('ensinar grava a fonte visível e o fato entra no prompt', async () => {
    const fact = await teach('Parcelamos em até 12 vezes sem juros.');
    expect(fact).toMatchObject({
      source_type: 'member',
      source_label: 'Escrito por Bruna Lima',
      status: 'active',
      can_restore: false,
      created_by: { member_id: bruna() },
    });
    const p = await prompt();
    expect(p.facts.find((f) => f.id === fact.id)).toMatchObject({
      sourceType: 'member',
      sourceLabel: 'Escrito por Bruna Lima',
    });
  });

  it('esquecer: o fato some do prompt na chamada seguinte; restaurar volta; idempotente', async () => {
    const fact = await teach('Avaliação inicial gratuita.');
    expect((await prompt()).facts.some((f) => f.id === fact.id)).toBe(true);

    const forgot = await withWorkspace(wsA(), (tx) =>
      forgetFact(tx, { workspaceId: wsA(), id: fact.id, memberId: bruna() }),
    );
    expect(forgot.ok && forgot.value).toMatchObject({ status: 'forgotten', can_restore: true });
    expect((await prompt()).facts.some((f) => f.id === fact.id)).toBe(false);

    // Esquecer de novo não falha nem duplica a trilha.
    const twice = await withWorkspace(wsA(), (tx) =>
      forgetFact(tx, { workspaceId: wsA(), id: fact.id, memberId: bruna() }),
    );
    expect(twice.ok).toBe(true);
    const trail = await getDb()
      .select()
      .from(schema.auditLogs)
      .where(
        and(
          eq(schema.auditLogs.resourceId, fact.id),
          eq(schema.auditLogs.action, 'copilot.memory.fact_forgotten'),
        ),
      );
    expect(trail).toHaveLength(1);

    const back = await withWorkspace(wsA(), (tx) =>
      restoreFact(tx, { workspaceId: wsA(), id: fact.id, memberId: bruna() }),
    );
    expect(back.ok && back.value).toMatchObject({ status: 'active', can_restore: false });
    expect((await prompt()).facts.some((f) => f.id === fact.id)).toBe(true);

    const notForgotten = await withWorkspace(wsA(), (tx) =>
      restoreFact(tx, { workspaceId: wsA(), id: fact.id, memberId: bruna() }),
    );
    expect(notForgotten).toEqual({ ok: false, error: 'not_forgotten' });
  });

  it('restaurar só até 24 h depois de esquecer; depois, 409 restore_window_closed e some da lista', async () => {
    const fact = await teach('Desconto de 10% à vista.');
    await withWorkspace(wsA(), (tx) =>
      forgetFact(tx, { workspaceId: wsA(), id: fact.id, memberId: bruna() }),
    );
    const inList = async () =>
      (await withWorkspace(wsA(), (tx) => listFactsPage(tx, { limit: 50 }))).data.find(
        (f) => f.id === fact.id,
      );
    await expect(inList()).resolves.toMatchObject({ status: 'forgotten', can_restore: true });

    await getDb()
      .update(schema.copilotMemoryEntries)
      .set({ forgottenAt: sql`now() - interval '25 hours'` })
      .where(eq(schema.copilotMemoryEntries.id, fact.id));
    const late = await withWorkspace(wsA(), (tx) =>
      restoreFact(tx, { workspaceId: wsA(), id: fact.id, memberId: bruna() }),
    );
    expect(late).toEqual({ ok: false, error: 'restore_window_closed' });
    expect(await inList()).toBeUndefined();
    // O fato continua fora do prompt.
    expect((await prompt()).facts.some((f) => f.id === fact.id)).toBe(false);
  });

  it('corrigir: original vira superseded, o novo é de pessoa e o antigo some do prompt', async () => {
    // Fato aprendido pelo Copiloto (fonte mais fraca na ordem do prompt).
    const copilotFact = await withWorkspace(wsA(), (tx) =>
      copilotMemoryRepo.addFact(tx, {
        workspaceId: wsA(),
        content: 'Atendemos sábado até 14h.',
        sourceType: 'copilot',
        sourceLabel: 'Pedido de Paula ao Copiloto em 10/10/2026',
        createdBy: a.members.AGENT.id,
      }),
    );
    const fixed = await withWorkspace(wsA(), (tx) =>
      correctFact(tx, {
        workspaceId: wsA(),
        id: copilotFact.id,
        memberId: bruna(),
        memberName: 'Bruna Lima',
        content: 'Atendemos sábado até 12h.',
      }),
    );
    expect(fixed.ok).toBe(true);
    if (!fixed.ok) return;
    expect(fixed.value).toMatchObject({
      source_type: 'member',
      source_label: 'Escrito por Bruna Lima',
      content: 'Atendemos sábado até 12h.',
    });
    const [orig] = await getDb()
      .select()
      .from(schema.copilotMemoryEntries)
      .where(eq(schema.copilotMemoryEntries.id, copilotFact.id));
    expect(orig?.status).toBe('superseded');
    const p = await prompt();
    expect(p.facts.some((f) => f.id === copilotFact.id)).toBe(false);
    expect(p.facts.some((f) => f.id === fixed.value.id)).toBe(true);

    // Corrigir de novo o original (já superseded) = conflito; esquecer também.
    const again = await withWorkspace(wsA(), (tx) =>
      correctFact(tx, {
        workspaceId: wsA(),
        id: copilotFact.id,
        memberId: bruna(),
        memberName: 'Bruna Lima',
        content: 'x',
      }),
    );
    expect(again).toEqual({ ok: false, error: 'not_active' });
    const forgetOld = await withWorkspace(wsA(), (tx) =>
      forgetFact(tx, { workspaceId: wsA(), id: copilotFact.id, memberId: bruna() }),
    );
    expect(forgetOld).toEqual({ ok: false, error: 'not_active' });
  });

  it('fato de pessoa tem precedência sobre o do Copiloto no prompt', async () => {
    const aprendido = await withWorkspace(wsA(), (tx) =>
      copilotMemoryRepo.addFact(tx, {
        workspaceId: wsA(),
        content: 'Política de prazo: 30 dias.',
        sourceType: 'copilot',
        sourceLabel: 'Pedido de Paula ao Copiloto em 17/10/2026',
      }),
    );
    const pessoa = await teach('Política de prazo: 15 dias.');
    const ids = (await prompt()).facts.map((f) => f.id);
    expect(ids.indexOf(pessoa.id)).toBeLessThan(ids.indexOf(aprendido.id));
  });

  it('a lista pagina por keyset e rejeita cursor malformado', async () => {
    const first = await withWorkspace(wsA(), (tx) => listFactsPage(tx, { limit: 2 }));
    expect(first.data).toHaveLength(2);
    expect(first.next_cursor).not.toBeNull();
    const second = await withWorkspace(wsA(), (tx) =>
      listFactsPage(tx, { limit: 2, cursor: first.next_cursor }),
    );
    expect(second.data.length).toBeGreaterThan(0);
    const seen = new Set(first.data.map((f) => f.id));
    expect(second.data.some((f) => seen.has(f.id))).toBe(false);
    await expect(
      withWorkspace(wsA(), (tx) => listFactsPage(tx, { cursor: 'nao-e-cursor' })),
    ).rejects.toThrow();
  });
});

describe('cross-tenant', () => {
  it('fato de outro workspace é "não encontrado" em todas as operações e fora da lista', async () => {
    const fact = await teach('Segredo do workspace A.');
    const wsB = b.workspaceId;
    const memberB = b.members.OWNER.id;
    const [forget, restore, correct, load, list] = await Promise.all([
      withWorkspace(wsB, (tx) =>
        forgetFact(tx, { workspaceId: wsB, id: fact.id, memberId: memberB }),
      ),
      withWorkspace(wsB, (tx) =>
        restoreFact(tx, { workspaceId: wsB, id: fact.id, memberId: memberB }),
      ),
      withWorkspace(wsB, (tx) =>
        correctFact(tx, {
          workspaceId: wsB,
          id: fact.id,
          memberId: memberB,
          memberName: 'Dono B',
          content: 'adulterado',
        }),
      ),
      withWorkspace(wsB, (tx) => loadFact(tx, fact.id)),
      withWorkspace(wsB, (tx) => listFactsPage(tx, { limit: 50 })),
    ]);
    expect(forget).toEqual({ ok: false, error: 'not_found' });
    expect(restore).toEqual({ ok: false, error: 'not_found' });
    expect(correct).toEqual({ ok: false, error: 'not_found' });
    expect(load).toBeNull();
    expect(list.data.some((f) => f.id === fact.id)).toBe(false);
    // O prompt do B também não carrega nada do A.
    const promptB = await withWorkspace(wsB, (tx) =>
      copilotMemoryRepo.listActiveForPrompt(tx, wsB),
    );
    expect(promptB.facts.some((f) => f.id === fact.id)).toBe(false);
    // E o fato do A segue intacto.
    expect((await withWorkspace(wsA(), (tx) => loadFact(tx, fact.id)))?.status).toBe('active');
  });
});

describe('teto de 200 fatos ativos', () => {
  it('o 201º é recusado; esquecer um libera; restaurar também respeita o teto', async () => {
    const lim = await seedCopilotWorkspace({ label: 'MemLimit' });
    try {
      const ws = lim.workspaceId;
      const member = lim.members.ADMIN.id;
      const add = (content: string) =>
        withWorkspace(ws, (tx) =>
          addMemberFact(tx, { workspaceId: ws, memberId: member, memberName: 'Admin', content }),
        );
      const rows = Array.from({ length: MEMORY_ACTIVE_FACTS_MAX }, (_, i) => ({
        workspaceId: ws,
        kind: 'fact' as const,
        content: `Fato ${i}`,
        sourceType: 'member' as const,
        sourceLabel: 'Escrito por Admin',
        createdBy: member,
      }));
      await getDb().insert(schema.copilotMemoryEntries).values(rows);

      const refused = await add('Fato 201');
      expect(refused).toEqual({ ok: false, error: 'memory_limit' });

      const [one] = await getDb()
        .select()
        .from(schema.copilotMemoryEntries)
        .where(eq(schema.copilotMemoryEntries.workspaceId, ws))
        .limit(1);
      await withWorkspace(ws, (tx) =>
        forgetFact(tx, { workspaceId: ws, id: one!.id, memberId: member }),
      );
      const accepted = await add('Fato 201');
      expect(accepted.ok).toBe(true);
      // Cheio de novo: restaurar o esquecido estoura o teto.
      const restore = await withWorkspace(ws, (tx) =>
        restoreFact(tx, { workspaceId: ws, id: one!.id, memberId: member }),
      );
      expect(restore).toEqual({ ok: false, error: 'memory_limit' });
    } finally {
      await lim.cleanup();
    }
  });

  it('escritas paralelas não passam do teto (advisory lock)', async () => {
    const lim = await seedCopilotWorkspace({ label: 'MemRace' });
    try {
      const ws = lim.workspaceId;
      const member = lim.members.ADMIN.id;
      await getDb()
        .insert(schema.copilotMemoryEntries)
        .values(
          Array.from({ length: MEMORY_ACTIVE_FACTS_MAX - 2 }, (_, i) => ({
            workspaceId: ws,
            kind: 'fact' as const,
            content: `Fato ${i}`,
            sourceType: 'member' as const,
            sourceLabel: 'Escrito por Admin',
          })),
        );
      const results = await Promise.all(
        Array.from({ length: 6 }, (_, i) =>
          withWorkspace(ws, (tx) =>
            addMemberFact(tx, {
              workspaceId: ws,
              memberId: member,
              memberName: 'Admin',
              content: `Paralelo ${i}`,
            }),
          ),
        ),
      );
      expect(results.filter((r) => r.ok)).toHaveLength(2);
      expect(results.filter((r) => !r.ok && r.error === 'memory_limit')).toHaveLength(4);
    } finally {
      await lim.cleanup();
    }
  });
});

describe('fontes (A10)', () => {
  it('lista as 4 nativas com contagens reais do workspace', async () => {
    const ws = a.workspaceId;
    // Estado vazio.
    const empty = await withWorkspace(ws, (tx) => listMemorySources(tx, ws));
    expect(empty.map((s) => s.key)).toEqual(['knowledge', 'products', 'pipeline', 'inbox']);
    expect(empty.every((s) => s.status === 'warn')).toBe(true);

    const db = getDb();
    await db.insert(schema.kbDocuments).values([
      {
        workspaceId: ws,
        title: 'A',
        source: 'manual',
        rawContent: 'a',
        contentSha256: randomUUID(),
      },
      {
        workspaceId: ws,
        title: 'B',
        source: 'manual',
        rawContent: 'b',
        contentSha256: randomUUID(),
      },
      {
        workspaceId: ws,
        title: 'Rascunho',
        source: 'manual',
        status: 'draft',
        rawContent: 'c',
        contentSha256: randomUUID(),
      },
    ]);
    await db.insert(schema.products).values([
      { workspaceId: ws, name: 'Alinhador', priceCents: 500000 },
      { workspaceId: ws, name: 'Implante', priceCents: 400000 },
      { workspaceId: ws, name: 'Antigo', active: false },
      { workspaceId: ws, name: 'Apagado', deletedAt: new Date() },
    ]);
    const [pipeline] = await db
      .insert(schema.pipelines)
      .values({ workspaceId: ws, name: 'Tratamentos', isDefault: true })
      .returning();
    await db.insert(schema.stages).values([
      { workspaceId: ws, pipelineId: pipeline!.id, name: 'Novo', position: 0 },
      { workspaceId: ws, pipelineId: pipeline!.id, name: 'Orçamento', position: 1 },
      { workspaceId: ws, pipelineId: pipeline!.id, name: 'Fechado', position: 2, isWon: true },
    ]);
    await db.insert(schema.channels).values([
      { workspaceId: ws, provider: 'waha', name: 'WA', wahaSessionId: `s-${randomUUID()}` },
      {
        workspaceId: ws,
        provider: 'waha',
        name: 'WA 2',
        wahaSessionId: `s-${randomUUID()}`,
        isActive: false,
      },
    ]);

    const full = await withWorkspace(ws, (tx) => listMemorySources(tx, ws));
    const by = Object.fromEntries(full.map((s) => [s.key, s]));
    expect(by['knowledge']).toMatchObject({ status: 'ok' });
    expect(by['knowledge']?.detail).toMatch(/^2 documentos · atualizado em \d{2}\/\d{2}\/\d{4}$/);
    expect(by['products']).toMatchObject({ status: 'ok', detail: '2 produtos no catálogo' });
    expect(by['pipeline']).toMatchObject({ status: 'ok', detail: 'Tratamentos · 3 estágios' });
    expect(by['inbox']).toMatchObject({ status: 'warn', detail: '1 canal ativo · 1 inativo' });

    // Outro workspace não vê as contagens do A.
    const other = await withWorkspace(b.workspaceId, (tx) => listMemorySources(tx, b.workspaceId));
    expect(other.every((s) => s.status === 'warn')).toBe(true);
  });

  it('seam: provider externo registrado aparece; erro e timeout viram "warn"; remover tira', async () => {
    const ws = a.workspaceId;
    const off = registerMemorySource({
      key: 'erp',
      label: 'ERP',
      load: ({ workspaceId }) => [
        {
          key: 'erp:pedidos',
          label: 'ERP · pedidos',
          status: 'ok',
          detail: `ws ${workspaceId.slice(0, 4)}`,
        },
        // Item inválido é descartado, sem derrubar a lista.
        { key: 'ERP INVALIDO', label: 'x', status: 'ok', detail: '' },
      ],
    });
    const offBroken = registerMemorySource({
      key: 'crm_x',
      label: 'CRM X',
      load: () => {
        throw new Error('segredo-interno');
      },
    });
    const offSlow = registerMemorySource({
      key: 'slow',
      label: 'Lenta',
      load: () => new Promise((resolve) => setTimeout(() => resolve([]), 30_000).unref()),
    });
    try {
      expect(() => registerMemorySource({ key: 'erp', label: 'dup', load: () => [] })).toThrow(
        /repetida/,
      );
      expect(() =>
        registerMemorySource({ key: 'knowledge', label: 'dup', load: () => [] }),
      ).toThrow(/repetida/);
      expect(() => registerMemorySource({ key: 'Inválida!', label: 'x', load: () => [] })).toThrow(
        /inválida/,
      );

      const started = Date.now();
      const list = await withWorkspace(ws, (tx) => listMemorySources(tx, ws));
      expect(Date.now() - started).toBeLessThan(MEMORY_SOURCE_PROVIDER_TIMEOUT_MS + 3_000);
      const by = Object.fromEntries(list.map((s) => [s.key, s]));
      expect(by['erp:pedidos']).toMatchObject({ status: 'ok' });
      expect(by['ERP INVALIDO']).toBeUndefined();
      expect(by['crm_x']).toMatchObject({
        status: 'warn',
        detail: 'Não consegui ler esta fonte agora',
      });
      expect(JSON.stringify(list)).not.toContain('segredo-interno');
      expect(by['slow']).toMatchObject({ status: 'warn' });
    } finally {
      off();
      offBroken();
      offSlow();
    }
    const after = await withWorkspace(ws, (tx) => listMemorySources(tx, ws));
    expect(after.map((s) => s.key)).toEqual(['knowledge', 'products', 'pipeline', 'inbox']);
  }, 20_000);
});
