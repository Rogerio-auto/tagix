/**
 * F72-S04 — auditoria H1/M2/L1, sem banco. Uma `tx` falsa registra o SQL que a Home e
 * a Hoje mandariam ao Postgres (renderizado pelo dialeto real do Drizzle), e as
 * asserções leem o texto:
 *
 * - H1: para SUPERVISOR (e AGENT/READONLY), "aguardando", "mídia que falhou" e o
 *   speed-to-lead carregam o predicado de visibilidade da inbox (F30) do membro; para
 *   OWNER/ADMIN, não. Na Hoje, a fila também, e a agenda é recortada pelos calendários
 *   acessíveis para todos os papéis.
 * - M2: a 1ª instrução da carga é o `SET LOCAL statement_timeout`.
 * - L1: o EXISTS da mídia amarra `workspace_id` da conversa ao da mensagem.
 *
 * O predicado é substituído por um marcador (`inbox_visible($memberId)`) para o teste
 * não depender da forma interna do `buildVisibilityPredicate` (que tem testes próprios).
 */
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it, vi } from 'vitest';
import type * as HmDb from '@hm/db';
import type { DbTx } from '@hm/db';
import type { Role } from '@hm/shared';

const MARKER = 'inbox_visible(';

vi.mock('@hm/db', async (importOriginal) => {
  const actual = await importOriginal<typeof HmDb>();
  const { sql } = await import('drizzle-orm');
  return {
    ...actual,
    buildVisibilityPredicate: (ctx: { memberId: string }) =>
      sql`inbox_visible(${ctx.memberId})`,
    calendarRepo: {
      ...actual.calendarRepo,
      accessibleCalendarIds: async () => ['cal-acessivel'],
    },
  };
});

const { loadHome } = await import('./home');
const { loadToday } = await import('../../routes/dashboard/today');
const { DASHBOARD_STATEMENT_TIMEOUT_MS } = await import('./viewer-scope');
const { loadDashboard } = await import('./load-dashboard');
const { drillDown } = await import('./drill-down');

const dialect = new PgDialect();

interface Captured {
  readonly sql: string;
  readonly params: readonly unknown[];
}

function isSql(v: unknown): v is SQL {
  return typeof v === 'object' && v !== null && 'queryChunks' in v;
}

/** `tx` falsa: `execute` e todo builder encadeado registram o SQL e resolvem `[]`. */
function fakeTx(): { tx: DbTx; captured: Captured[] } {
  const captured: Captured[] = [];
  const record = (args: readonly unknown[]): void => {
    for (const a of args) {
      if (isSql(a)) {
        const q = dialect.sqlToQuery(a);
        captured.push({ sql: q.sql, params: q.params });
      }
    }
  };
  const chain = (): unknown =>
    new Proxy(() => undefined, {
      get(_t, prop) {
        if (prop === 'then') return (resolve: (v: unknown[]) => void) => resolve([]);
        return (...args: unknown[]) => {
          record(args);
          return chain();
        };
      },
    });
  const tx = {
    execute: async (q: unknown) => {
      record([q]);
      return [];
    },
    select: () => chain(),
  };
  return { tx: tx as unknown as DbTx, captured };
}

const MEMBER = 'mem-sup-1';
const NOW = new Date('2026-09-15T18:00:00Z');

async function homeSql(role: Role): Promise<Captured[]> {
  const { tx, captured } = fakeTx();
  await loadHome(tx, { workspaceId: 'ws-1', memberId: MEMBER, role, now: NOW });
  return captured;
}

const find = (all: readonly Captured[], needle: string): Captured | undefined =>
  all.find((c) => c.sql.includes(needle));

describe('Home — visibilidade da inbox (H1)', () => {
  for (const role of ['SUPERVISOR', 'AGENT', 'READONLY'] as const) {
    it(`${role}: "aguardando" e "mídia que falhou" levam o predicado do membro`, async () => {
      const all = await homeSql(role);
      const waiting = find(all, "last_message_from = 'contact'");
      const media = find(all, "media_status = 'failed'");
      expect(waiting?.sql).toContain(MARKER);
      expect(waiting?.params).toContain(MEMBER);
      expect(media?.sql).toContain(MARKER);
      expect(media?.params).toContain(MEMBER);
    });
  }

  it('SUPERVISOR: speed-to-lead recortado pelos departamentos que lidera', async () => {
    const all = await homeSql('SUPERVISOR');
    const stl = find(all, 'percentile_cont');
    expect(stl?.sql).toContain(MARKER);
    // Receita/leads ficam no workspace (decisão documentada em home.ts).
    expect(find(all, 'FROM conversion_events')?.sql).not.toContain(MARKER);
    expect(find(all, 'FROM contacts')?.sql).not.toContain(MARKER);
  });

  for (const role of ['ADMIN', 'OWNER'] as const) {
    it(`${role}: nenhuma query carrega o predicado`, async () => {
      const all = await homeSql(role);
      for (const c of all) expect(c.sql).not.toContain(MARKER);
    });
  }
});

describe('Home — mídia que falhou, recorte pessoal (L1)', () => {
  it('o EXISTS amarra o workspace da conversa ao da mensagem', async () => {
    const all = await homeSql('AGENT');
    const media = find(all, "media_status = 'failed'");
    expect(media?.sql).toMatch(/conversations\.workspace_id\s*=\s*m\.workspace_id/);
    expect(media?.sql).toMatch(/conversations\.assigned_to\s*=/);
  });
});

describe('statement_timeout (M2)', () => {
  it('Home: 1ª instrução da carga', async () => {
    const all = await homeSql('OWNER');
    expect(all[0]?.sql).toBe(`SET LOCAL statement_timeout = ${DASHBOARD_STATEMENT_TIMEOUT_MS}`);
    expect(DASHBOARD_STATEMENT_TIMEOUT_MS).toBe(5_000);
  });

  it('Hoje: 1ª instrução da carga', async () => {
    const { tx, captured } = fakeTx();
    await loadToday(tx, { workspaceId: 'ws-1', now: NOW, viewer: { memberId: MEMBER, role: 'OWNER' } });
    expect(captured[0]?.sql).toBe(`SET LOCAL statement_timeout = ${DASHBOARD_STATEMENT_TIMEOUT_MS}`);
  });

  it('Painel completo (/dashboard/me): 1ª instrução da carga', async () => {
    const { tx, captured } = fakeTx();
    // A tx falsa devolve `[]` a tudo; o que importa aqui é a ORDEM do SQL emitido,
    // não o payload (que tem testes próprios com banco).
    await loadDashboard(tx, { workspaceId: 'ws-1', memberId: MEMBER, role: 'OWNER' }).catch(
      () => undefined,
    );
    expect(captured.length).toBeGreaterThan(1);
    expect(captured[0]?.sql).toBe(`SET LOCAL statement_timeout = ${DASHBOARD_STATEMENT_TIMEOUT_MS}`);
  });

  it('Drill-down: o teto vem antes da 1ª leitura da métrica', async () => {
    const { tx, captured } = fakeTx();
    const r = await drillDown(tx, {
      workspaceId: 'ws-1',
      memberId: MEMBER,
      role: 'OWNER',
      metricKey: 'volume_inbound_24h',
    });
    expect(r.kind).toBe('ok');
    expect(captured[0]?.sql).toBe(`SET LOCAL statement_timeout = ${DASHBOARD_STATEMENT_TIMEOUT_MS}`);
    expect(captured[1]?.sql).toContain('mv_dashboard_volume_24h');
  });

  it('Drill-down negado não toca o banco', async () => {
    const { tx, captured } = fakeTx();
    const r = await drillDown(tx, {
      workspaceId: 'ws-1',
      memberId: MEMBER,
      role: 'AGENT',
      metricKey: 'custo_llm_hoje_usd',
    });
    expect(r.kind).toBe('forbidden');
    expect(captured).toEqual([]);
  });
});

describe('Hoje — fila e agenda por papel (H1)', () => {
  async function todaySql(role: Role): Promise<Captured[]> {
    const { tx, captured } = fakeTx();
    await loadToday(tx, { workspaceId: 'ws-1', now: NOW, viewer: { memberId: MEMBER, role } });
    return captured;
  }

  it('SUPERVISOR: a fila carrega o predicado da inbox dele', async () => {
    const all = await todaySql('SUPERVISOR');
    const fila = all.filter((c) => c.sql.includes('"last_message_from"'));
    expect(fila.length).toBeGreaterThan(0);
    for (const c of fila) {
      expect(c.sql).toContain(MARKER);
      expect(c.params).toContain(MEMBER);
    }
  });

  it('OWNER: fila sem predicado', async () => {
    const all = await todaySql('OWNER');
    for (const c of all) expect(c.sql).not.toContain(MARKER);
  });

  for (const role of ['SUPERVISOR', 'ADMIN', 'OWNER', 'AGENT'] as const) {
    it(`${role}: agenda recortada pelos calendários acessíveis`, async () => {
      const all = await todaySql(role);
      const agenda = find(all, '"start_at"');
      expect(agenda?.sql).toContain('"calendar_id" in');
      expect(agenda?.params).toContain('cal-acessivel');
    });
  }
});
