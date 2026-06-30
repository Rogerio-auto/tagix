/**
 * F55-S09 (QA) — fecha o buraco de cobertura entre os marcos de ciclo (S01/S02) e as
 * métricas que os consomem (S03/S04). Os testes de S02 provam que `resolved_at` /
 * `first_response_at` são GRAVADOS corretamente; este arquivo prova que as queries de
 * dashboard LEEM esses marcos (e não mais `messages` / `updated_at`) e produzem números
 * exatos — o requisito da DoD "SLA/TTR refletem o real".
 *
 * Cobertura:
 *  - `tempoMedioPrimeiraResposta24h`: média/amostra sobre `first_response_at`, janela 24h,
 *    exclusão de NULL e de respostas fora da janela, e o recorte por `memberId`.
 *  - `tempoMedioResolucao24h`: média sobre `coalesce(closed_at, resolved_at)`, exigindo
 *    `status IN ('resolved','closed')` — uma conversa REABERTA (status open) com
 *    `resolved_at` setado NÃO conta (regressão clássica de quem lê só o timestamp).
 *  - `slaVioladoHoje`: viola por 1ª resposta e por resolução comparando os marcos contra
 *    `sla_rules`; sem regra → `null`.
 *
 * Cada cenário usa um workspace isolado (essas queries agregam sobre o workspace inteiro),
 * semeado e sob RLS. Roda contra o Postgres dev (infra Docker UP); cleanup em afterEach.
 */
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { closeDb, getDb, schema, withWorkspace } from '@hm/db';
import {
  slaVioladoHoje,
  tempoMedioPrimeiraResposta24h,
  tempoMedioResolucao24h,
} from '../queries';

const { workspaces, members, channels, conversations, slaRules } = schema;

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

interface Fixture {
  readonly ws: string;
  readonly channelId: string;
  readonly memberId: string;
}

const created: string[] = [];

async function makeWorkspace(): Promise<Fixture> {
  const db = getDb();
  const sfx = randomUUID().slice(0, 8);
  const [w] = await db
    .insert(workspaces)
    .values({ name: `Cycle ${sfx}`, slug: `cycle-${sfx}` })
    .returning();
  if (!w) throw new Error('ws');
  created.push(w.id);

  const [m] = await db
    .insert(members)
    .values({
      workspaceId: w.id,
      authUserId: randomUUID(),
      email: `cycle-${sfx}@t.local`,
      name: 'Atendente',
      role: 'AGENT',
      status: 'active',
    })
    .returning();
  const [ch] = await db
    .insert(channels)
    .values({
      workspaceId: w.id,
      provider: 'meta_whatsapp',
      name: `WA ${sfx}`,
      phoneNumberId: `pnid-${sfx}`,
      wabaId: `waba-${sfx}`,
    })
    .returning();
  if (!m || !ch) throw new Error('seed');
  return { ws: w.id, channelId: ch.id, memberId: m.id };
}

/** Insere uma conversa com marcos de ciclo controlados. */
async function seedConversation(
  f: Fixture,
  values: Partial<typeof conversations.$inferInsert>,
): Promise<void> {
  await getDb()
    .insert(conversations)
    .values({
      workspaceId: f.ws,
      channelId: f.channelId,
      remoteId: `r-${randomUUID().slice(0, 12)}`,
      status: 'open',
      ...values,
    });
}

afterEach(async () => {
  const db = getDb();
  for (const id of created.splice(0)) {
    await db.delete(workspaces).where(eq(workspaces.id, id));
  }
});

afterAll(async () => {
  await closeDb();
});

describe('F55 tempoMedioPrimeiraResposta24h — lê first_response_at (não messages)', () => {
  it('média/amostra sobre o marco; NULL e fora-da-janela excluídos', async () => {
    const f = await makeWorkspace();
    const now = Date.now();
    // 60s de TTR (dentro da janela).
    await seedConversation(f, {
      createdAt: new Date(now - 2 * HOUR),
      firstResponseAt: new Date(now - 2 * HOUR + 60 * SECOND),
      assignedTo: f.memberId,
    });
    // 120s de TTR (dentro da janela), de outro atendente (sem assignedTo).
    await seedConversation(f, {
      createdAt: new Date(now - 1 * HOUR),
      firstResponseAt: new Date(now - 1 * HOUR + 120 * SECOND),
    });
    // Sem 1ª resposta → não entra.
    await seedConversation(f, { createdAt: new Date(now - 30 * MINUTE) });
    // 1ª resposta há 30h → fora da janela de 24h.
    await seedConversation(f, {
      createdAt: new Date(now - 31 * HOUR),
      firstResponseAt: new Date(now - 30 * HOUR),
    });

    const out = await withWorkspace(f.ws, (tx) => tempoMedioPrimeiraResposta24h(tx, f.ws));
    expect(out['sample']).toBe(2);
    expect(out['value']).toBe(90); // (60 + 120) / 2
    expect(out['unit']).toBe('s');
  });

  it('recorte por memberId restringe ao atendente atribuído', async () => {
    const f = await makeWorkspace();
    const now = Date.now();
    await seedConversation(f, {
      createdAt: new Date(now - 2 * HOUR),
      firstResponseAt: new Date(now - 2 * HOUR + 60 * SECOND),
      assignedTo: f.memberId,
    });
    await seedConversation(f, {
      createdAt: new Date(now - 1 * HOUR),
      firstResponseAt: new Date(now - 1 * HOUR + 999 * SECOND),
    });

    const mine = await withWorkspace(f.ws, (tx) =>
      tempoMedioPrimeiraResposta24h(tx, f.ws, f.memberId),
    );
    expect(mine['sample']).toBe(1);
    expect(mine['value']).toBe(60);
  });

  it('sem dado → value 0, sample 0 (não lança)', async () => {
    const f = await makeWorkspace();
    const out = await withWorkspace(f.ws, (tx) => tempoMedioPrimeiraResposta24h(tx, f.ws));
    expect(out['sample']).toBe(0);
    expect(out['value']).toBe(0);
  });
});

describe('F55 tempoMedioResolucao24h — lê coalesce(closed_at, resolved_at)', () => {
  it('média sobre o marco e exige status terminal (reaberta NÃO conta)', async () => {
    const f = await makeWorkspace();
    const now = Date.now();
    // Resolvida: resolved_at = created + 100s, status resolved.
    await seedConversation(f, {
      createdAt: new Date(now - 3 * HOUR),
      resolvedAt: new Date(now - 3 * HOUR + 100 * SECOND),
      status: 'resolved',
    });
    // Fechada: closed_at prevalece sobre resolved_at no coalesce → 300s.
    await seedConversation(f, {
      createdAt: new Date(now - 2 * HOUR),
      resolvedAt: new Date(now - 2 * HOUR + 50 * SECOND),
      closedAt: new Date(now - 2 * HOUR + 300 * SECOND),
      status: 'closed',
    });
    // REABERTA: tem resolved_at mas voltou pra open → o filtro de status a exclui.
    // (Sem o `status IN (...)`, leria 9999s e poluiria a média — regressão clássica.)
    await seedConversation(f, {
      createdAt: new Date(now - 1 * HOUR),
      resolvedAt: new Date(now - 1 * HOUR + 9999 * SECOND),
      status: 'open',
    });

    const out = await withWorkspace(f.ws, (tx) => tempoMedioResolucao24h(tx, f.ws));
    expect(out['sample']).toBe(2);
    expect(out['value']).toBe(200); // (100 + 300) / 2
  });

  it('resolução há mais de 24h fica fora da janela', async () => {
    const f = await makeWorkspace();
    const now = Date.now();
    await seedConversation(f, {
      createdAt: new Date(now - 30 * HOUR),
      resolvedAt: new Date(now - 29 * HOUR),
      status: 'resolved',
    });
    const out = await withWorkspace(f.ws, (tx) => tempoMedioResolucao24h(tx, f.ws));
    expect(out['sample']).toBe(0);
  });
});

describe('F55 slaVioladoHoje — compara marcos contra sla_rules', () => {
  it('sem regra de SLA configurada → null (não inventa limite)', async () => {
    const f = await makeWorkspace();
    const out = await withWorkspace(f.ws, (tx) => slaVioladoHoje(tx));
    expect(out).toBeNull();
  });

  it('conta violação de 1ª resposta e de resolução pelos marcos', async () => {
    const f = await makeWorkspace();
    const now = Date.now();
    await getDb().insert(slaRules).values({
      workspaceId: f.ws,
      scopeType: 'workspace',
      firstResponseSecs: 300, // 5 min
      resolutionSecs: 1800, // 30 min
      isActive: 'active',
    });

    // (A) Aberta hoje há 10 min, sem 1ª resposta → 600s > 300 → viola FRT.
    await seedConversation(f, { createdAt: new Date(now - 10 * MINUTE), status: 'open' });
    // (B) Respondeu em 30s e resolveu em 5 min → dentro de AMBOS os limites → não viola.
    await seedConversation(f, {
      createdAt: new Date(now - 8 * MINUTE),
      firstResponseAt: new Date(now - 8 * MINUTE + 30 * SECOND),
      resolvedAt: new Date(now - 8 * MINUTE + 5 * MINUTE),
      status: 'resolved',
    });
    // (C) Respondeu rápido (60s, dentro do FRT) mas segue ABERTA há 40 min sem resolver →
    // viola resolução pelo ramo "ainda aberta e além do limite" (40 min > 30 min). Isola
    // o ramo de resolução — o FRT já foi cumprido, então a violação NÃO é por 1ª resposta.
    await seedConversation(f, {
      createdAt: new Date(now - 40 * MINUTE),
      firstResponseAt: new Date(now - 40 * MINUTE + 60 * SECOND),
      status: 'open',
    });

    const out = await withWorkspace(f.ws, (tx) => slaVioladoHoje(tx));
    // A (FRT) e C (resolução) violam; B não.
    expect(out?.['count']).toBe(2);
  });
});
