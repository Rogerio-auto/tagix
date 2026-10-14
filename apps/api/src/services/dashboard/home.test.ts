/**
 * F72-S04 — agregações da Home contra o Postgres (precisa da infra Docker).
 *
 * Protege o que só o SQL decide: speed-to-lead como MEDIANA da 1ª resposta (humana ou
 * da IA) a partir da 1ª mensagem do contato, as bordas (automação não é resposta,
 * saída antes do lead não conta, sem resposta fica fora da mediana mas é contado),
 * a janela anterior do mesmo tamanho, o recorte pessoal e o RLS de workspace.
 */
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, getDb, schema, withWorkspace } from '@hm/db';
import { loadToday } from '../../routes/dashboard/today';
import { homeWindows } from './home-model';
import { loadHome, speedToLeadStats } from './home';

const AGORA = new Date('2026-09-15T18:00:00Z');
const DIA = 86_400_000;
const JANELAS = homeWindows(AGORA, 30);

let ws = '';
let wsVazio = '';
let agentId = '';
let ownerId = '';
let channelId = '';
let sfx = '';

type Msg = {
  /** Segundos depois da criação da conversa. */
  em: number;
  dir: 'inbound' | 'outbound';
  quem: 'contact' | 'member' | 'agent' | 'system';
  falhou?: boolean;
};

async function conversa(opts: {
  criadaHaDias: number;
  msgs: readonly Msg[];
  assignedTo?: string;
  aguardandoMin?: number;
  kind?: 'direct' | 'group';
  workspaceId?: string;
  channel?: string;
}): Promise<string> {
  const db = getDb();
  const wsId = opts.workspaceId ?? ws;
  const [contato] = await db
    .insert(schema.contacts)
    .values({ workspaceId: wsId, displayName: `Lead ${randomUUID().slice(0, 6)}` })
    .returning();
  const created = new Date(AGORA.getTime() - opts.criadaHaDias * DIA);
  const [conv] = await db
    .insert(schema.conversations)
    .values({
      workspaceId: wsId,
      channelId: opts.channel ?? channelId,
      contactId: contato!.id,
      remoteId: `remote-${randomUUID()}`,
      status: 'open',
      kind: opts.kind ?? 'direct',
      createdAt: created,
      ...(opts.assignedTo ? { assignedTo: opts.assignedTo } : {}),
      ...(opts.aguardandoMin !== undefined
        ? {
            lastMessageFrom: 'contact',
            lastMessageAt: new Date(AGORA.getTime() - opts.aguardandoMin * 60_000),
          }
        : {}),
    })
    .returning();
  for (const m of opts.msgs) {
    const at = new Date(created.getTime() + m.em * 1000);
    await db.insert(schema.messages).values({
      workspaceId: wsId,
      conversationId: conv!.id,
      direction: m.dir,
      senderType: m.quem,
      content: 'x',
      viewStatus: m.falhou ? 'failed' : 'sent',
      createdAt: at,
      providerTimestamp: at,
    });
  }
  return conv!.id;
}

const lead = (em: number): Msg => ({ em, dir: 'inbound', quem: 'contact' });
const humano = (em: number): Msg => ({ em, dir: 'outbound', quem: 'member' });
const ia = (em: number): Msg => ({ em, dir: 'outbound', quem: 'agent' });
const automacao = (em: number): Msg => ({ em, dir: 'outbound', quem: 'system' });

beforeAll(async () => {
  const db = getDb();
  sfx = randomUUID().slice(0, 8);
  const [w] = await db
    .insert(schema.workspaces)
    .values({ name: `Home ${sfx}`, slug: `home-${sfx}` })
    .returning();
  const [v] = await db
    .insert(schema.workspaces)
    .values({ name: `Home V ${sfx}`, slug: `home-v-${sfx}` })
    .returning();
  ws = w!.id;
  wsVazio = v!.id;

  const mk = async (role: 'AGENT' | 'OWNER'): Promise<string> => {
    const [m] = await db
      .insert(schema.members)
      .values({
        workspaceId: ws,
        authUserId: randomUUID(),
        email: `${role.toLowerCase()}-${sfx}@t.local`,
        role,
        status: 'active',
      })
      .returning();
    return m!.id;
  };
  agentId = await mk('AGENT');
  ownerId = await mk('OWNER');

  const [ch] = await db
    .insert(schema.channels)
    .values({
      workspaceId: ws,
      provider: 'meta_whatsapp',
      name: `WA ${sfx}`,
      phoneNumberId: `pn-${sfx}`,
      wabaId: `waba-${sfx}`,
    })
    .returning();
  channelId = ch!.id;

  // Janela atual. Respostas efetivas: 30s (humano), 60s (IA), 600s (humano).
  // Mediana 60s — a média seria 230s.
  await conversa({ criadaHaDias: 2, msgs: [lead(0), humano(30)], assignedTo: agentId });
  // Boas-vindas automática em 5s NÃO é resposta; a IA em 60s é.
  await conversa({ criadaHaDias: 3, msgs: [lead(0), automacao(5), ia(60)], assignedTo: agentId });
  // Prospecção: nossa saída ANTES do lead não conta; o relógio começa no lead (100s)
  // e a resposta humana vem em 700s → 600s. Uma resposta que falhou no envio também não.
  await conversa({
    criadaHaDias: 4,
    msgs: [
      humano(0),
      lead(100),
      { em: 200, dir: 'outbound', quem: 'member', falhou: true },
      humano(700),
    ],
  });
  // Sem resposta: fora da mediana, contada em `unanswered`.
  await conversa({
    criadaHaDias: 5,
    msgs: [lead(0), automacao(2)],
    aguardandoMin: 90,
    assignedTo: agentId,
  });
  // Conversa sem mensagem do contato (campanha sem retorno): não é lead, não entra.
  await conversa({ criadaHaDias: 6, msgs: [automacao(0)] });
  // Grupo: não é lead.
  await conversa({ criadaHaDias: 6, msgs: [lead(0), humano(5)], kind: 'group' });

  // Janela anterior: 120s.
  await conversa({ criadaHaDias: 40, msgs: [lead(0), humano(120)] });
  // Fora das duas janelas: ignorada.
  await conversa({ criadaHaDias: 75, msgs: [lead(0), humano(9_999)] });
});

afterAll(async () => {
  const db = getDb();
  for (const id of [ws, wsVazio]) {
    if (id) await db.delete(schema.workspaces).where(eq(schema.workspaces.id, id));
  }
  await closeDb();
});

describe('speedToLeadStats', () => {
  it('MEDIANA da 1ª resposta humana ou da IA, com as bordas decididas', async () => {
    const s = await withWorkspace(ws, (tx) => speedToLeadStats(tx, ws, JANELAS));
    expect(s.current).toEqual({ medianSeconds: 60, answered: 3, unanswered: 1 });
  });

  it('janela anterior do mesmo tamanho, sem misturar com a atual', async () => {
    const s = await withWorkspace(ws, (tx) => speedToLeadStats(tx, ws, JANELAS));
    expect(s.previous).toEqual({ medianSeconds: 120, answered: 1, unanswered: 0 });
  });

  it('recorta pelas conversas atribuídas ao membro no escopo pessoal', async () => {
    const s = await withWorkspace(ws, (tx) =>
      speedToLeadStats(tx, ws, JANELAS, { memberId: agentId }),
    );
    expect(s.current).toEqual({ medianSeconds: 45, answered: 2, unanswered: 1 });
  });

  it('sem amostra: mediana null, nunca zero', async () => {
    const s = await withWorkspace(wsVazio, (tx) => speedToLeadStats(tx, wsVazio, JANELAS));
    expect(s.current).toEqual({ medianSeconds: null, answered: 0, unanswered: 0 });
  });

  it('RLS: o workspace vazio não enxerga as conversas do outro, mesmo pedindo pelo id', async () => {
    const s = await withWorkspace(wsVazio, (tx) => speedToLeadStats(tx, ws, JANELAS));
    expect(s.current.answered).toBe(0);
  });
});

describe('loadHome por papel', () => {
  it('OWNER: escopo workspace com speed-to-lead, delta e jornada', async () => {
    const r = await withWorkspace(ws, (tx) =>
      loadHome(tx, { workspaceId: ws, memberId: ownerId, role: 'OWNER', now: AGORA }),
    );
    expect(r.scope).toBe('workspace');
    expect(r.kpis.map((k) => k.key)).toEqual(['revenue', 'leads', 'speed_to_lead', 'conversions']);
    expect(r.kpis.find((k) => k.key === 'speed_to_lead')).toMatchObject({
      value: 60,
      previous: 120,
      sample: { answered: 3, unanswered: 1 },
    });
    expect(r.journey).not.toBeNull();
    // Sem tipo de conversão a receita é desconhecida, não zero.
    expect(r.kpis.find((k) => k.key === 'revenue')?.value).toBeNull();
    expect(r.revenueSeries).toBeNull();
  });

  it('AGENT: só a fila dele — sem receita, jornada, série, canal nem custo', async () => {
    const r = await withWorkspace(ws, (tx) =>
      loadHome(tx, { workspaceId: ws, memberId: agentId, role: 'AGENT', now: AGORA }),
    );
    expect(r.scope).toBe('personal');
    const keys = r.kpis.map((k) => k.key);
    for (const owner of ['revenue', 'leads', 'conversions']) expect(keys).not.toContain(owner);
    expect(r.journey).toBeNull();
    expect(r.revenueSeries).toBeNull();
    const raw = JSON.stringify(r).toLowerCase();
    for (const forbidden of ['cost', 'custo', 'usd', 'llm', 'token', 'channel_down']) {
      expect(raw, `AGENT recebeu ${forbidden}`).not.toContain(forbidden);
    }
  });

  it('"esperando" respeita o recorte pessoal e a régua de SLA, com alvo da ação', async () => {
    const agente = await withWorkspace(ws, (tx) =>
      loadHome(tx, { workspaceId: ws, memberId: agentId, role: 'AGENT', now: AGORA }),
    );
    const item = agente.attention.find((a) => a.kind === 'waiting_sla');
    expect(item).toMatchObject({ count: 1, oldestMinutes: 90, severity: 'critical' });
    expect(item?.targetId).toBeTruthy();
    expect(item?.href).toBe(`/conversations/${item?.targetId ?? ''}`);

    const outro = await withWorkspace(ws, (tx) =>
      loadHome(tx, { workspaceId: ws, memberId: randomUUID(), role: 'AGENT', now: AGORA }),
    );
    expect(outro.attention.find((a) => a.kind === 'waiting_sla')).toBeUndefined();
  });

  it('workspace vazio não quebra e não inventa atenção', async () => {
    const r = await withWorkspace(wsVazio, (tx) =>
      loadHome(tx, { workspaceId: wsVazio, memberId: randomUUID(), role: 'OWNER', now: AGORA }),
    );
    expect(r.attention).toHaveLength(0);
    expect(r.kpis.find((k) => k.key === 'speed_to_lead')?.value).toBeNull();
    expect(r.kpis.find((k) => k.key === 'leads')?.value).toBe(0);
  });
});

describe('Hoje com recorte pessoal (loadToday)', () => {
  it('AGENT vê só as conversas dele e nenhum resultado do mês; OWNER, a empresa', async () => {
    const dele = await withWorkspace(ws, (tx) =>
      loadToday(tx, {
        workspaceId: ws,
        viewer: { memberId: agentId, role: 'AGENT' },
        now: AGORA,
      }),
    );
    expect(dele.waitingTotal).toBe(1);
    expect(dele.month).toBeNull();
    expect(dele.appointments).toEqual([]);

    const outro = await withWorkspace(ws, (tx) =>
      loadToday(tx, {
        workspaceId: ws,
        viewer: { memberId: randomUUID(), role: 'AGENT' },
        now: AGORA,
      }),
    );
    expect(outro.waitingTotal).toBe(0);

    const todos = await withWorkspace(ws, (tx) =>
      loadToday(tx, { workspaceId: ws, viewer: { memberId: ownerId, role: 'OWNER' }, now: AGORA }),
    );
    expect(todos.waitingTotal).toBeGreaterThanOrEqual(1);
    expect(todos.month).not.toBeNull();
  });
});

/**
 * H1 (auditoria F72-S04): SUPERVISOR enxerga só os departamentos que LIDERA (F30). A
 * fila da Hoje, o "aguardando" e a "mídia que falhou" da Home e o speed-to-lead seguem
 * a inbox; a agenda segue os calendários acessíveis (para todo papel).
 */
describe('SUPERVISOR de departamento — visibilidade da inbox', () => {
  let wsSup = '';
  let supId = '';
  let ownerSupId = '';
  let convLiderada = '';
  let convOutroDept = '';

  beforeAll(async () => {
    const db = getDb();
    const s = randomUUID().slice(0, 8);
    const [w] = await db
      .insert(schema.workspaces)
      .values({ name: `Home Sup ${s}`, slug: `home-sup-${s}` })
      .returning();
    wsSup = w!.id;
    const membro = async (role: 'SUPERVISOR' | 'OWNER' | 'AGENT'): Promise<string> => {
      const [m] = await db
        .insert(schema.members)
        .values({
          workspaceId: wsSup,
          authUserId: randomUUID(),
          email: `${role.toLowerCase()}-${randomUUID().slice(0, 6)}@t.local`,
          role,
          status: 'active',
        })
        .returning();
      return m!.id;
    };
    supId = await membro('SUPERVISOR');
    ownerSupId = await membro('OWNER');
    const colega = await membro('AGENT');

    const [deptA] = await db
      .insert(schema.departments)
      .values({ workspaceId: wsSup, name: `Vendas ${s}` })
      .returning();
    const [deptB] = await db
      .insert(schema.departments)
      .values({ workspaceId: wsSup, name: `Suporte ${s}` })
      .returning();
    const [timeA] = await db
      .insert(schema.teams)
      .values({ workspaceId: wsSup, departmentId: deptA!.id, name: `Time A ${s}` })
      .returning();
    const [timeB] = await db
      .insert(schema.teams)
      .values({ workspaceId: wsSup, departmentId: deptB!.id, name: `Time B ${s}` })
      .returning();
    await db.insert(schema.teamMembers).values([
      { teamId: timeA!.id, memberId: supId, workspaceId: wsSup, role: 'lead' },
      { teamId: timeB!.id, memberId: colega, workspaceId: wsSup, role: 'member' },
    ]);

    const [ch] = await db
      .insert(schema.channels)
      .values({
        workspaceId: wsSup,
        provider: 'meta_whatsapp',
        name: `WA Sup ${s}`,
        phoneNumberId: `pn-sup-${s}`,
        wabaId: `waba-sup-${s}`,
      })
      .returning();

    // Uma conversa esperando há 90 min (acima do SLA) em cada departamento, cada uma
    // com uma mídia recebida que falhou e o lead respondido em 30s (A) / 300s (B).
    const esperando = async (departmentId: string, respostaEm: number): Promise<string> => {
      const [contato] = await db
        .insert(schema.contacts)
        .values({ workspaceId: wsSup, displayName: `Lead ${randomUUID().slice(0, 6)}` })
        .returning();
      const criada = new Date(AGORA.getTime() - 2 * DIA);
      const [conv] = await db
        .insert(schema.conversations)
        .values({
          workspaceId: wsSup,
          channelId: ch!.id,
          contactId: contato!.id,
          remoteId: `remote-${randomUUID()}`,
          status: 'open',
          departmentId,
          createdAt: criada,
          lastMessageFrom: 'contact',
          lastMessageAt: new Date(AGORA.getTime() - 90 * 60_000),
        })
        .returning();
      const msg = (em: number, quem: 'contact' | 'member') => {
        const at = new Date(criada.getTime() + em * 1000);
        return {
          workspaceId: wsSup,
          conversationId: conv!.id,
          direction: quem === 'contact' ? 'inbound' : 'outbound',
          senderType: quem,
          content: 'x',
          viewStatus: 'sent',
          createdAt: at,
          providerTimestamp: at,
        } as const;
      };
      await db.insert(schema.messages).values([msg(0, 'contact'), msg(respostaEm, 'member')]);
      await db.insert(schema.messages).values({
        workspaceId: wsSup,
        conversationId: conv!.id,
        direction: 'inbound',
        senderType: 'contact',
        content: 'foto',
        viewStatus: 'sent',
        mediaStatus: 'failed',
        createdAt: new Date(AGORA.getTime() - 60 * 60_000),
      });
      return conv!.id;
    };
    convLiderada = await esperando(deptA!.id, 30);
    convOutroDept = await esperando(deptB!.id, 300);

    const [calA] = await db
      .insert(schema.calendars)
      .values({ workspaceId: wsSup, name: `Cal A ${s}`, type: 'team', teamId: timeA!.id })
      .returning();
    const [calB] = await db
      .insert(schema.calendars)
      .values({ workspaceId: wsSup, name: `Cal B ${s}`, type: 'team', teamId: timeB!.id })
      .returning();
    const hoje = (h: number): Date => new Date(Date.UTC(2026, 8, 15, h));
    await db.insert(schema.events).values([
      {
        workspaceId: wsSup,
        calendarId: calA!.id,
        title: `Visita A ${s}`,
        startAt: hoje(19),
        endAt: hoje(20),
      },
      {
        workspaceId: wsSup,
        calendarId: calB!.id,
        title: `Visita B ${s}`,
        startAt: hoje(21),
        endAt: hoje(22),
      },
    ]);
  });

  afterAll(async () => {
    if (wsSup) await getDb().delete(schema.workspaces).where(eq(schema.workspaces.id, wsSup));
  });

  it('Hoje: fila só do departamento liderado; agenda só do calendário acessível', async () => {
    const r = await withWorkspace(wsSup, (tx) =>
      loadToday(tx, {
        workspaceId: wsSup,
        viewer: { memberId: supId, role: 'SUPERVISOR' },
        now: AGORA,
      }),
    );
    expect(r.waiting.map((w) => w.conversationId)).toEqual([convLiderada]);
    expect(r.waitingTotal).toBe(1);
    expect(r.waitingBands.esfriando).toBe(1);
    expect(r.appointments.map((a) => a.title)).toEqual([expect.stringMatching(/^Visita A /)]);
    expect(r.month).not.toBeNull();
  });

  it('Hoje: OWNER vê a fila inteira; a agenda segue os calendários acessíveis dele', async () => {
    const r = await withWorkspace(wsSup, (tx) =>
      loadToday(tx, {
        workspaceId: wsSup,
        viewer: { memberId: ownerSupId, role: 'OWNER' },
        now: AGORA,
      }),
    );
    expect(new Set(r.waiting.map((w) => w.conversationId))).toEqual(
      new Set([convLiderada, convOutroDept]),
    );
    // OWNER fora dos times: calendário de time não é acessível (mesma regra da Agenda).
    expect(r.appointments).toEqual([]);
  });

  it('Home: "aguardando", "mídia que falhou" e speed-to-lead do SUPERVISOR seguem a inbox', async () => {
    const r = await withWorkspace(wsSup, (tx) =>
      loadHome(tx, { workspaceId: wsSup, memberId: supId, role: 'SUPERVISOR', now: AGORA }),
    );
    expect(r.attention.find((a) => a.kind === 'waiting_sla')).toMatchObject({
      count: 1,
      targetId: convLiderada,
    });
    expect(r.attention.find((a) => a.kind === 'media_failed')).toMatchObject({
      count: 1,
      targetId: convLiderada,
    });
    // DASHBOARD §2.1: 1ª resposta do SUPERVISOR é "do team" — só a conversa liderada.
    expect(r.kpis.find((k) => k.key === 'speed_to_lead')).toMatchObject({
      value: 30,
      sample: { answered: 1, unanswered: 0 },
    });
  });

  it('Home: OWNER vê os dois departamentos', async () => {
    const r = await withWorkspace(wsSup, (tx) =>
      loadHome(tx, { workspaceId: wsSup, memberId: ownerSupId, role: 'OWNER', now: AGORA }),
    );
    expect(r.attention.find((a) => a.kind === 'waiting_sla')?.count).toBe(2);
    expect(r.attention.find((a) => a.kind === 'media_failed')?.count).toBe(2);
    expect(r.kpis.find((k) => k.key === 'speed_to_lead')?.value).toBe(165);
  });
});

/**
 * Item 7 (auditoria de design): o KPI de receita e a série do gráfico somam o MESMO
 * conjunto de conversões — soma da série == KPI, inclusive nas bordas da janela.
 */
describe('receita: soma da série == KPI', () => {
  let wsRec = '';

  beforeAll(async () => {
    const db = getDb();
    const s = randomUUID().slice(0, 8);
    const [w] = await db
      .insert(schema.workspaces)
      .values({ name: `Home Rec ${s}`, slug: `home-rec-${s}` })
      .returning();
    wsRec = w!.id;
    const [tipo] = await db
      .insert(schema.conversionTypes)
      .values({ workspaceId: wsRec, key: `venda_${s}`, label: 'Venda' })
      .returning();
    // Um contato por evento: o índice de dedup é (contato, tipo, dia).
    const ev = async (occurredAt: Date, valueCents: number | null, cancelled = false) => {
      const [contato] = await db
        .insert(schema.contacts)
        .values({ workspaceId: wsRec, displayName: `Comprador ${randomUUID().slice(0, 6)}` })
        .returning();
      await db.insert(schema.conversionEvents).values({
        workspaceId: wsRec,
        conversionTypeId: tipo!.id,
        contactId: contato!.id,
        valueCents,
        source: 'manual',
        occurredAt,
        ...(cancelled ? { cancelledAt: AGORA } : {}),
      });
    };
    const inicio = JANELAS.current.from;
    await ev(inicio, 1_000); // borda inferior (fechada): entra
    await ev(new Date(inicio.getTime() + DIA), 2_500);
    await ev(new Date(AGORA.getTime() - 60_000), 4_000); // hoje, dia parcial
    await ev(new Date(AGORA.getTime() - DIA), null); // sem valor: conta conversão, não receita
    await ev(new Date(AGORA.getTime() - 2 * DIA), 9_999, true); // cancelada: fora dos dois
    await ev(new Date(inicio.getTime() - 1), 7_777); // janela anterior: fora da série
    await ev(AGORA, 8_888); // borda superior (aberta): fora
  });

  afterAll(async () => {
    if (wsRec) await getDb().delete(schema.workspaces).where(eq(schema.workspaces.id, wsRec));
  });

  it('a série soma exatamente a receita do KPI; o período anterior fica fora dela', async () => {
    const r = await withWorkspace(wsRec, (tx) =>
      loadHome(tx, { workspaceId: wsRec, memberId: randomUUID(), role: 'OWNER', now: AGORA }),
    );
    const revenue = r.kpis.find((k) => k.key === 'revenue');
    const soma = (r.revenueSeries ?? []).reduce((acc, p) => acc + p.valueCents, 0);
    expect(revenue?.value).toBe(7_500);
    expect(soma).toBe(revenue?.value);
    expect(revenue?.previous).toBe(7_777);
    expect(r.kpis.find((k) => k.key === 'conversions')?.value).toBe(4);
  });
});
