/**
 * F73-S01 — schema e repos do Copiloto contra o Postgres dev (migração 0097).
 *
 * Cobre: enum `as const` × CHECK do banco (drift), schema Drizzle × catálogo, RLS + FORCE nas 12
 * tabelas, únicos parciais, CHECKs, concorrência de `claimToolCall` (20 paralelas, teto 16) e do
 * `transition` (CAS), repos (paginação keyset, memória, briefing, piloto), extensões de
 * `audit_logs`/`llm_usage_logs` e a régua de "parado" (`idle.ts`).
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { eq, inArray, sql } from 'drizzle-orm';
import { getTableConfig, type PgTable } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, getDb } from '../client';
import { withWorkspace } from '../rls';
import {
  COPILOT_SETTINGS_DEFAULTS,
  copilotAutopilotRepo,
  copilotBriefingsRepo,
  copilotMemberPrefsRepo,
  copilotMemoryRepo,
  copilotMessagesRepo,
  copilotProposalsRepo,
  copilotSessionsRepo,
  copilotSettingsRepo,
  copilotToolCallsRepo,
  copilotTurnsRepo,
  dealIdleDaysSql,
  dealLastMessageDirectionSql,
  InvalidCursorError,
} from '../repos/copilot';
import {
  AUDIT_LOG_ACTOR_TYPES,
  RLS_TABLES,
  auditLogs,
  channels,
  contacts,
  conversations,
  deals,
  llmUsageLogs,
  members,
  messages,
  pipelines,
  stages,
  workspaces,
} from './index';
import {
  COPILOT_ACTION_ITEM_STATUSES,
  COPILOT_ACTION_TARGET_TYPES,
  COPILOT_AUTO_OPEN_MODES,
  COPILOT_AUTOPILOT_MODES,
  COPILOT_BLOCKED_REASONS,
  COPILOT_BRIEFING_STATUSES,
  COPILOT_BUDGET_MODES,
  COPILOT_HISTORY_RETENTION_MONTHS,
  COPILOT_MEMORY_KINDS,
  COPILOT_MEMORY_PROFILE_KEYS,
  COPILOT_MEMORY_SOURCE_TYPES,
  COPILOT_MEMORY_STATUSES,
  COPILOT_MESSAGE_ROLES,
  COPILOT_PROPOSAL_SOURCES,
  COPILOT_PROPOSAL_STATUSES,
  COPILOT_SESSION_ORIGINS,
  COPILOT_SUGGESTION_CONFIDENCES,
  COPILOT_SUGGESTION_STATUSES,
  COPILOT_SURFACES,
  COPILOT_TOOL_CALL_DECISIONS,
  COPILOT_TURN_STATUSES,
  copilotActionItems,
  copilotActionProposals,
  copilotAutopilotRules,
  copilotBriefings,
  copilotMemberPrefs,
  copilotMemoryEntries,
  copilotMessages,
  copilotSessions,
  copilotSettings,
  copilotSuggestions,
  copilotToolCalls,
  copilotTurns,
  type InsertCopilotProposalShape,
} from './copilot.test-types';
import { LLM_USAGE_SURFACES } from './llm';

const here = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION_TAG = '0097_f73_copilot';
const migration = readFileSync(path.resolve(here, `../../drizzle/${MIGRATION_TAG}.sql`), 'utf-8');

const COPILOT_TABLES: ReadonlyArray<[string, PgTable]> = [
  ['copilot_settings', copilotSettings],
  ['copilot_member_prefs', copilotMemberPrefs],
  ['copilot_sessions', copilotSessions],
  ['copilot_messages', copilotMessages],
  ['copilot_turns', copilotTurns],
  ['copilot_tool_calls', copilotToolCalls],
  ['copilot_action_proposals', copilotActionProposals],
  ['copilot_action_items', copilotActionItems],
  ['copilot_memory_entries', copilotMemoryEntries],
  ['copilot_briefings', copilotBriefings],
  ['copilot_autopilot_rules', copilotAutopilotRules],
  ['copilot_suggestions', copilotSuggestions],
];

type PgErr = { code?: string; constraint_name?: string };

function causaPg(erro: unknown): PgErr {
  let atual: unknown = erro;
  for (let i = 0; i < 5 && atual !== null && atual !== undefined; i += 1) {
    const c = atual as PgErr & { cause?: unknown };
    if (typeof c.code === 'string') return c;
    atual = c.cause;
  }
  return {};
}

async function falhaCom(p: Promise<unknown>): Promise<PgErr> {
  let erro: unknown;
  try {
    await p;
  } catch (e) {
    erro = e;
  }
  expect(erro, 'deveria ter falhado').toBeDefined();
  return causaPg(erro);
}

const nonce = (): string => randomBytes(24).toString('base64url');

// ─── Seed ────────────────────────────────────────────────────────────────────────

interface Tenant {
  ws: string;
  owner: string;
  agent: string;
  pipeline: string;
  stage: string;
  stage2: string;
  contact: string;
  channel: string;
  conversation: string;
  deal: string;
}

let sfx = '';
let A: Tenant;
let B: Tenant;

async function seedTenant(label: string): Promise<Tenant> {
  const db = getDb();
  const [w] = await db
    .insert(workspaces)
    .values({ name: `F73 ${label}`, slug: `f73-${label}-${sfx}` })
    .returning();
  if (!w) throw new Error('seed ws');
  const [owner] = await db
    .insert(members)
    .values({
      workspaceId: w.id,
      authUserId: randomUUID(),
      email: `f73-own-${label}-${sfx}@test.local`,
      role: 'OWNER',
      status: 'active',
    })
    .returning();
  const [agent] = await db
    .insert(members)
    .values({
      workspaceId: w.id,
      authUserId: randomUUID(),
      email: `f73-agt-${label}-${sfx}@test.local`,
      role: 'AGENT',
      status: 'active',
    })
    .returning();
  const [pl] = await db.insert(pipelines).values({ workspaceId: w.id, name: 'P' }).returning();
  if (!owner || !agent || !pl) throw new Error('seed members/pipeline');
  const [st] = await db
    .insert(stages)
    .values({ workspaceId: w.id, pipelineId: pl.id, name: 'Novo', position: 0 })
    .returning();
  const [st2] = await db
    .insert(stages)
    .values({ workspaceId: w.id, pipelineId: pl.id, name: 'Reativação', position: 1 })
    .returning();
  const [ct] = await db
    .insert(contacts)
    .values({ workspaceId: w.id, displayName: `C ${label}` })
    .returning();
  const [ch] = await db
    .insert(channels)
    .values({
      workspaceId: w.id,
      provider: 'meta_whatsapp',
      name: `WA ${label} ${sfx}`,
      phoneNumberId: `f73-pn-${label}-${sfx}`,
      wabaId: `f73-waba-${label}-${sfx}`,
    })
    .returning();
  if (!st || !st2 || !ct || !ch) throw new Error('seed stage/contact/channel');
  const [cv] = await db
    .insert(conversations)
    .values({ workspaceId: w.id, channelId: ch.id, remoteId: `f73-${label}-${sfx}`, contactId: ct.id })
    .returning();
  if (!cv) throw new Error('seed conversation');
  const [d] = await db
    .insert(deals)
    .values({
      workspaceId: w.id,
      pipelineId: pl.id,
      stageId: st.id,
      contactId: ct.id,
      title: `Deal ${label}`,
    })
    .returning();
  if (!d) throw new Error('seed deal');
  return {
    ws: w.id,
    owner: owner.id,
    agent: agent.id,
    pipeline: pl.id,
    stage: st.id,
    stage2: st2.id,
    contact: ct.id,
    channel: ch.id,
    conversation: cv.id,
    deal: d.id,
  };
}

/** Deal extra do tenant (sem conversa por padrão). */
async function seedDeal(t: Tenant, over: Partial<typeof deals.$inferInsert> = {}): Promise<string> {
  const [d] = await getDb()
    .insert(deals)
    .values({
      workspaceId: t.ws,
      pipelineId: t.pipeline,
      stageId: t.stage,
      contactId: t.contact,
      title: `Deal extra ${randomUUID().slice(0, 6)}`,
      ...over,
    })
    .returning({ id: deals.id });
  if (!d) throw new Error('seed deal extra');
  return d.id;
}

async function seedSession(t: Tenant, memberId = t.owner) {
  return withWorkspace(t.ws, (tx) =>
    copilotSessionsRepo.create(tx, { workspaceId: t.ws, memberId, origin: 'bubble' }),
  );
}

async function seedTurn(t: Tenant, opts: { max?: number; expiresInMs?: number; memberId?: string } = {}) {
  const memberId = opts.memberId ?? t.owner;
  const session = await seedSession(t, memberId);
  const grantNonce = nonce();
  const { turn } = await withWorkspace(t.ws, (tx) =>
    copilotTurnsRepo.createRunning(tx, {
      workspaceId: t.ws,
      memberId,
      sessionId: session.id,
      grantNonce,
      expiresAt: new Date(Date.now() + (opts.expiresInMs ?? 120_000)),
      maxToolCalls: opts.max ?? 16,
    }),
  );
  return { session, turn, grantNonce };
}

function proposalInput(t: Tenant, over: Partial<InsertCopilotProposalShape> = {}): InsertCopilotProposalShape {
  return {
    workspaceId: t.ws,
    capability: 'deal.move',
    riskLevel: 3,
    status: 'proposed',
    requestedByMemberId: t.owner,
    summary: 'Mover 2 negócios para Reativação',
    expiresAt: new Date(Date.now() + 15 * 60_000),
    ...over,
  };
}

beforeAll(async () => {
  sfx = randomUUID().slice(0, 8);
  A = await seedTenant('a');
  B = await seedTenant('b');
});

afterAll(async () => {
  const db = getDb();
  for (const t of [A, B]) {
    if (!t) continue;
    await db.delete(deals).where(eq(deals.workspaceId, t.ws));
    await db.delete(workspaces).where(eq(workspaces.id, t.ws));
  }
  await closeDb();
});

// ─── 1. Drift: enum × CHECK, schema × catálogo ───────────────────────────────────

describe('enums as const × CHECK do Postgres', () => {
  const ENUM_CHECKS: ReadonlyArray<[string, readonly (string | number)[]]> = [
    ['copilot_settings_budget_mode_chk', COPILOT_BUDGET_MODES],
    ['copilot_settings_default_auto_open_chk', COPILOT_AUTO_OPEN_MODES],
    ['copilot_settings_history_retention_chk', COPILOT_HISTORY_RETENTION_MONTHS],
    ['copilot_member_prefs_auto_open_chk', COPILOT_AUTO_OPEN_MODES],
    ['copilot_member_prefs_surface_chk', COPILOT_SURFACES],
    ['copilot_sessions_origin_chk', COPILOT_SESSION_ORIGINS],
    ['copilot_messages_role_chk', COPILOT_MESSAGE_ROLES],
    ['copilot_turns_status_chk', COPILOT_TURN_STATUSES],
    ['copilot_tool_calls_decision_chk', COPILOT_TOOL_CALL_DECISIONS],
    ['copilot_proposals_source_chk', COPILOT_PROPOSAL_SOURCES],
    ['copilot_proposals_status_chk', COPILOT_PROPOSAL_STATUSES],
    ['copilot_proposals_blocked_reason_chk', COPILOT_BLOCKED_REASONS],
    ['copilot_action_items_target_type_chk', COPILOT_ACTION_TARGET_TYPES],
    ['copilot_action_items_status_chk', COPILOT_ACTION_ITEM_STATUSES],
    ['copilot_memory_kind_chk', COPILOT_MEMORY_KINDS],
    ['copilot_memory_profile_key_chk', COPILOT_MEMORY_PROFILE_KEYS],
    ['copilot_memory_source_type_chk', COPILOT_MEMORY_SOURCE_TYPES],
    ['copilot_memory_status_chk', COPILOT_MEMORY_STATUSES],
    ['copilot_briefings_status_chk', COPILOT_BRIEFING_STATUSES],
    ['copilot_autopilot_rules_mode_chk', COPILOT_AUTOPILOT_MODES],
    ['copilot_suggestions_confidence_chk', COPILOT_SUGGESTION_CONFIDENCES],
    ['copilot_suggestions_status_chk', COPILOT_SUGGESTION_STATUSES],
    ['audit_logs_actor_type_chk', AUDIT_LOG_ACTOR_TYPES],
    ['llm_usage_logs_surface_chk', LLM_USAGE_SURFACES],
  ];

  it.each(ENUM_CHECKS)('%s aceita exatamente os valores da constante', async (name, values) => {
    const rows = await getDb().execute<{ def: string }>(
      sql`select pg_get_constraintdef(oid) as def from pg_constraint where conname = ${name}`,
    );
    const def = rows[0]?.def;
    expect(def, name).toBeDefined();
    if (!def) return;
    const isNumeric = typeof values[0] === 'number';
    const found = isNumeric
      ? (/ARRAY\[([^\]]+)\]/.exec(def)?.[1] ?? '').split(',').map((v) => Number(v.trim()))
      : [...def.matchAll(/'([^']*)'::text/g)].map((m) => m[1]);
    expect([...found].sort()).toEqual([...values].sort());
  });

  it('copilot_proposals_status_chk segue o ciclo de vida da spec §6.3', () => {
    expect([...COPILOT_PROPOSAL_STATUSES].sort()).toEqual(
      [
        'awaiting_approval',
        'blocked',
        'cancelled',
        'completed',
        'confirmed',
        'executing',
        'expired',
        'failed',
        'partially_completed',
        'partially_undone',
        'proposed',
        'undone',
      ].sort(),
    );
  });
});

describe('schema Drizzle × catálogo do Postgres', () => {
  it.each(COPILOT_TABLES)('%s: CHECKs, FKs nomeadas e índices batem', async (name, table) => {
    const cfg = getTableConfig(table);
    expect(cfg.name).toBe(name);
    const cons = await getDb().execute<{ conname: string; contype: string }>(sql`
      select conname, contype from pg_constraint where conrelid = ${name}::regclass`);
    const dbChecks = cons.filter((c) => c.contype === 'c').map((c) => c.conname).sort();
    expect(cfg.checks.map((c) => c.name).sort()).toEqual(dbChecks);
    const dbFks = new Set(cons.filter((c) => c.contype === 'f').map((c) => c.conname));
    for (const fk of cfg.foreignKeys) {
      const fkName = fk.getName();
      // A FK simples de workspace (`.references`) tem o nome automático do Postgres no SQL.
      if (fkName.endsWith('_workspace_id_workspaces_id_fk')) continue;
      expect(dbFks.has(fkName), fkName).toBe(true);
    }
    const idx = await getDb().execute<{ indexname: string }>(sql`
      select indexname from pg_indexes where schemaname = 'public' and tablename = ${name}`);
    const dbIdx = new Set(idx.map((i) => i.indexname));
    for (const i of cfg.indexes) {
      expect(dbIdx.has(i.config.name ?? ''), i.config.name).toBe(true);
    }
  });

  it('todas as 12 tabelas em RLS_TABLES, com RLS + FORCE e policy de isolamento', async () => {
    const names = COPILOT_TABLES.map(([n]) => n);
    for (const n of names) expect(RLS_TABLES as readonly string[]).toContain(n);
    const rows = await getDb().execute<{
      relname: string;
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
      qual: string | null;
      with_check: string | null;
    }>(sql`
      select c.relname, c.relrowsecurity, c.relforcerowsecurity, p.qual, p.with_check
        from pg_class c
        left join pg_policies p on p.tablename = c.relname and p.policyname = c.relname || '_isolation'
       where c.relname = any(${names}::text[])`);
    expect(rows).toHaveLength(12);
    for (const r of rows) {
      expect(r.relrowsecurity, r.relname).toBe(true);
      expect(r.relforcerowsecurity, r.relname).toBe(true);
      expect(r.qual, r.relname).toBe('(workspace_id = app_current_workspace())');
      expect(r.with_check, r.relname).toBe('(workspace_id = app_current_workspace())');
    }
  });

  it('migração: cabeçalho com down, próxima livre no journal, deal_history intocado', () => {
    expect(migration).toMatch(/Reverter \(down\)/);
    expect(migration).not.toMatch(/deal_history/i);
    const journal = JSON.parse(
      readFileSync(path.resolve(here, '../../drizzle/meta/_journal.json'), 'utf-8'),
    ) as { entries: Array<{ idx: number; tag: string }> };
    const i = journal.entries.findIndex((e) => e.tag === MIGRATION_TAG);
    expect(journal.entries[i]?.idx).toBe(97);
    expect(journal.entries[i - 1]?.tag).toBe('0096_f70_contact_profile_name');
  });
});

// ─── 2. Configuração e preferências ──────────────────────────────────────────────

describe('copilotSettingsRepo / copilotMemberPrefsRepo', () => {
  it('sem linha devolve os defaults do contrato; upsert parcial preserva o resto', async () => {
    const t = await seedTenant(`st${randomUUID().slice(0, 4)}`);
    try {
      const empty = await withWorkspace(t.ws, (tx) => copilotSettingsRepo.get(tx, t.ws));
      expect(empty.persisted).toBe(false);
      const { workspaceId: _w, persisted: _p, updatedAt: _u, updatedBy: _b, ...vals } = empty;
      expect(vals).toEqual({
        enabled: true,
        capabilityMatrix: {},
        monthlyBudgetUsd: '30.00',
        budgetMode: 'queries_only',
        budgetAlertPct: 80,
        historyRetentionMonths: 12,
        defaultAutoOpen: 'daily',
        partnerAccess: false,
        model: null,
      });
      expect(vals).toEqual({ ...COPILOT_SETTINGS_DEFAULTS, capabilityMatrix: {} });

      const saved = await withWorkspace(t.ws, (tx) =>
        copilotSettingsRepo.upsert(tx, {
          workspaceId: t.ws,
          updatedBy: t.owner,
          patch: { monthlyBudgetUsd: '45.50', capabilityMatrix: { AGENT: { 'deal.move': false } } },
        }),
      );
      expect(saved.persisted).toBe(true);
      expect(saved.monthlyBudgetUsd).toBe('45.50');
      expect(saved.budgetMode).toBe('queries_only');
      const again = await withWorkspace(t.ws, (tx) =>
        copilotSettingsRepo.upsert(tx, {
          workspaceId: t.ws,
          updatedBy: t.agent,
          patch: { budgetMode: 'pause' },
        }),
      );
      expect(again.monthlyBudgetUsd).toBe('45.50');
      expect(again.budgetMode).toBe('pause');
      expect(again.capabilityMatrix).toEqual({ AGENT: { 'deal.move': false } });
      expect(again.updatedBy).toBe(t.agent);

      const e = await falhaCom(
        withWorkspace(t.ws, (tx) =>
          tx.update(copilotSettings).set({ historyRetentionMonths: 7 as 6 }),
        ),
      );
      expect(e.constraint_name).toBe('copilot_settings_history_retention_chk');
    } finally {
      await getDb().delete(deals).where(eq(deals.workspaceId, t.ws));
      await getDb().delete(workspaces).where(eq(workspaces.id, t.ws));
    }
  });

  it('preferências: defaults, upsert e herança (auto_open null)', async () => {
    const before = await withWorkspace(A.ws, (tx) => copilotMemberPrefsRepo.get(tx, A.ws, A.agent));
    expect(before).toMatchObject({ persisted: false, autoOpen: null, surface: 'bubble' });
    const p1 = await withWorkspace(A.ws, (tx) =>
      copilotMemberPrefsRepo.upsert(tx, {
        workspaceId: A.ws,
        memberId: A.agent,
        patch: { surface: 'docked', briefingLastSeenOn: '2026-10-16' },
      }),
    );
    expect(p1).toMatchObject({ surface: 'docked', briefingLastSeenOn: '2026-10-16', autoOpen: null });
    const p2 = await withWorkspace(A.ws, (tx) =>
      copilotMemberPrefsRepo.upsert(tx, {
        workspaceId: A.ws,
        memberId: A.agent,
        patch: { autoOpen: 'never' },
      }),
    );
    expect(p2).toMatchObject({ surface: 'docked', autoOpen: 'never', persisted: true });
  });
});

// ─── 3. Sessões e mensagens ──────────────────────────────────────────────────────

describe('copilotSessionsRepo / copilotMessagesRepo', () => {
  it('lista só as sessões do membro, paginando por cursor; getOwned não vaza a de outro', async () => {
    const mine = [await seedSession(A, A.agent), await seedSession(A, A.agent), await seedSession(A, A.agent)];
    const other = await seedSession(A, A.owner);
    const p1 = await withWorkspace(A.ws, (tx) =>
      copilotSessionsRepo.listByMember(tx, { memberId: A.agent, limit: 2 }),
    );
    expect(p1.items).toHaveLength(2);
    expect(p1.nextCursor).not.toBeNull();
    const p2 = await withWorkspace(A.ws, (tx) =>
      copilotSessionsRepo.listByMember(tx, { memberId: A.agent, limit: 2, cursor: p1.nextCursor }),
    );
    const seen = [...p1.items, ...p2.items].map((s) => s.id);
    for (const s of mine) expect(seen).toContain(s.id);
    expect(seen).not.toContain(other.id);
    expect(new Set(seen).size).toBe(seen.length);

    expect(await withWorkspace(A.ws, (tx) => copilotSessionsRepo.getOwned(tx, other.id, A.agent))).toBeNull();
    // Outro workspace também não enxerga (RLS).
    expect(await withWorkspace(B.ws, (tx) => copilotSessionsRepo.getOwned(tx, other.id, A.owner))).toBeNull();

    const first = mine[0];
    if (!first) throw new Error('seed');
    const renamed = await withWorkspace(A.ws, (tx) =>
      copilotSessionsRepo.rename(tx, first.id, A.agent, '  Funil de outubro  '),
    );
    expect(renamed?.title).toBe('Funil de outubro');
    expect(
      await withWorkspace(A.ws, (tx) => copilotSessionsRepo.rename(tx, first.id, A.owner, 'x')),
    ).toBeNull();
    const archived = await withWorkspace(A.ws, (tx) => copilotSessionsRepo.archive(tx, first.id, A.agent));
    expect(archived?.archivedAt).toBeInstanceOf(Date);
    const after = await withWorkspace(A.ws, (tx) =>
      copilotSessionsRepo.listByMember(tx, { memberId: A.agent, limit: 50 }),
    );
    expect(after.items.map((s) => s.id)).not.toContain(first.id);

    await expect(
      withWorkspace(A.ws, (tx) =>
        copilotSessionsRepo.listByMember(tx, { memberId: A.agent, cursor: 'lixo' }),
      ),
    ).rejects.toBeInstanceOf(InvalidCursorError);
  });

  it('título > 80 é recusado; origem fora do enum é recusada', async () => {
    const e1 = await falhaCom(
      withWorkspace(A.ws, (tx) =>
        copilotSessionsRepo.create(tx, {
          workspaceId: A.ws,
          memberId: A.owner,
          origin: 'bubble',
          title: 'x'.repeat(81),
        }),
      ),
    );
    expect(e1.constraint_name).toBe('copilot_sessions_title_chk');
    const e2 = await falhaCom(
      getDb().execute(
        sql`insert into copilot_sessions (workspace_id, member_id, origin) values (${A.ws}, ${A.owner}, 'sms')`,
      ),
    );
    expect(e2.constraint_name).toBe('copilot_sessions_origin_chk');
  });

  it('histórico: páginas "carregar anteriores" em ordem cronológica; lastForPrompt ≤ 12 sem eventos', async () => {
    const s = await seedSession(A);
    await withWorkspace(A.ws, async (tx) => {
      for (let i = 0; i < 15; i += 1) {
        await copilotMessagesRepo.append(tx, {
          workspaceId: A.ws,
          sessionId: s.id,
          role: i % 2 === 0 ? 'user' : 'assistant',
          content: `m${i}`,
        });
      }
      await copilotMessagesRepo.append(tx, {
        workspaceId: A.ws,
        sessionId: s.id,
        role: 'event',
        content: 'evento',
      });
    });
    const p1 = await withWorkspace(A.ws, (tx) =>
      copilotMessagesRepo.listBySession(tx, { sessionId: s.id, limit: 10 }),
    );
    expect(p1.items).toHaveLength(10);
    expect(p1.items[p1.items.length - 1]?.content).toBe('evento');
    const p2 = await withWorkspace(A.ws, (tx) =>
      copilotMessagesRepo.listBySession(tx, { sessionId: s.id, limit: 10, cursor: p1.nextCursor }),
    );
    expect(p2.items.map((m) => m.content)).toEqual(['m0', 'm1', 'm2', 'm3', 'm4', 'm5']);
    expect(p2.nextCursor).toBeNull();
    const all = [...p2.items, ...p1.items];
    for (let i = 1; i < all.length; i += 1) {
      const prev = all[i - 1];
      const cur = all[i];
      if (!prev || !cur) continue;
      expect(prev.createdAt.getTime()).toBeLessThanOrEqual(cur.createdAt.getTime());
    }

    const hist = await withWorkspace(A.ws, (tx) => copilotMessagesRepo.lastForPrompt(tx, s.id, 50));
    expect(hist).toHaveLength(12);
    expect(hist.map((m) => m.content)).toEqual(
      Array.from({ length: 12 }, (_v, i) => `m${i + 3}`),
    );
  });
});

// ─── 4. Turnos ───────────────────────────────────────────────────────────────────

describe('copilotTurnsRepo', () => {
  it('claimToolCall: 20 chamadas paralelas com max=16 → exatamente 16 sucessos', async () => {
    const { turn, grantNonce } = await seedTurn(A, { max: 16 });
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        withWorkspace(A.ws, (tx) =>
          copilotTurnsRepo.claimToolCall(tx, { turnId: turn.id, memberId: A.owner, nonce: grantNonce }),
        ),
      ),
    );
    const ok = results.filter((r) => r !== null);
    expect(ok).toHaveLength(16);
    expect(ok.map((r) => r?.toolCalls).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual(
      Array.from({ length: 16 }, (_v, i) => i + 1),
    );
    const [row] = await getDb().select().from(copilotTurns).where(eq(copilotTurns.id, turn.id));
    expect(row?.toolCalls).toBe(16);
  });

  it('claimToolCall recusa nonce errado, outro membro, turno expirado, encerrado e outro workspace', async () => {
    const { turn, grantNonce } = await seedTurn(A, { max: 4 });
    const claim = (ws: string, input: { memberId: string; nonce: string; turnId?: string }) =>
      withWorkspace(ws, (tx) =>
        copilotTurnsRepo.claimToolCall(tx, {
          turnId: input.turnId ?? turn.id,
          memberId: input.memberId,
          nonce: input.nonce,
        }),
      );
    expect(await claim(A.ws, { memberId: A.owner, nonce: 'x'.repeat(32) })).toBeNull();
    expect(await claim(A.ws, { memberId: A.agent, nonce: grantNonce })).toBeNull();
    expect(await claim(B.ws, { memberId: A.owner, nonce: grantNonce })).toBeNull();
    const ok = await claim(A.ws, { memberId: A.owner, nonce: grantNonce });
    expect(ok).toMatchObject({ turnId: turn.id, workspaceId: A.ws, toolCalls: 1, maxToolCalls: 4 });
    expect(ok?.expiresAt.getTime()).toBeGreaterThan(Date.now());

    const expired = await seedTurn(A, { expiresInMs: -1000 });
    expect(
      await claim(A.ws, { memberId: A.owner, nonce: expired.grantNonce, turnId: expired.turn.id }),
    ).toBeNull();

    const done = await withWorkspace(A.ws, (tx) =>
      copilotTurnsRepo.complete(tx, turn.id, {
        model: 'openai/gpt-4o-mini',
        promptTokens: 1200,
        completionTokens: 300,
        costUsd: '0.00123456',
        iterations: 3,
      }),
    );
    expect(done).toMatchObject({ status: 'completed', costUsd: '0.00123456', iterations: 3 });
    expect(done?.completedAt).toBeInstanceOf(Date);
    expect(await claim(A.ws, { memberId: A.owner, nonce: grantNonce })).toBeNull();
    // Encerramento é único.
    expect(
      await withWorkspace(A.ws, (tx) => copilotTurnsRepo.fail(tx, turn.id, { errorCode: 'late' })),
    ).toBeNull();
  });

  it('createRunning é idempotente por client_request_id; markTainted/fail/findRunningByMember', async () => {
    const session = await seedSession(A, A.agent);
    const input = {
      workspaceId: A.ws,
      memberId: A.agent,
      sessionId: session.id,
      grantNonce: nonce(),
      expiresAt: new Date(Date.now() + 120_000),
      maxToolCalls: 16,
      clientRequestId: `req-${randomUUID()}`,
    };
    const first = await withWorkspace(A.ws, (tx) => copilotTurnsRepo.createRunning(tx, input));
    const second = await withWorkspace(A.ws, (tx) =>
      copilotTurnsRepo.createRunning(tx, { ...input, grantNonce: nonce() }),
    );
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.turn.id).toBe(first.turn.id);
    // Outro membro pode usar o mesmo client_request_id.
    const otherSession = await seedSession(A, A.owner);
    const third = await withWorkspace(A.ws, (tx) =>
      copilotTurnsRepo.createRunning(tx, { ...input, memberId: A.owner, sessionId: otherSession.id }),
    );
    expect(third.created).toBe(true);

    expect(await withWorkspace(A.ws, (tx) => copilotTurnsRepo.markTainted(tx, first.turn.id))).toBe(true);
    const running = await withWorkspace(A.ws, (tx) => copilotTurnsRepo.findRunningByMember(tx, A.agent));
    expect(running?.id).toBe(first.turn.id);
    expect(running?.tainted).toBe(true);
    const failed = await withWorkspace(A.ws, (tx) =>
      copilotTurnsRepo.fail(tx, first.turn.id, { errorCode: 'budget', status: 'budget_blocked' }),
    );
    expect(failed).toMatchObject({ status: 'budget_blocked', errorCode: 'budget' });
    expect(await withWorkspace(A.ws, (tx) => copilotTurnsRepo.findRunningByMember(tx, A.agent))).toBeNull();

    // Turno encerrado sem completed_at é recusado (copilot_turns_completed_chk).
    const e = await falhaCom(
      getDb().update(copilotTurns).set({ completedAt: null }).where(eq(copilotTurns.id, first.turn.id)),
    );
    expect(e.constraint_name).toBe('copilot_turns_completed_chk');
  });

  it('copilotToolCallsRepo.insert grava o log; decisão fora do enum é recusada', async () => {
    const { turn } = await seedTurn(A);
    const row = await withWorkspace(A.ws, (tx) =>
      copilotToolCallsRepo.insert(tx, {
        workspaceId: A.ws,
        turnId: turn.id,
        memberId: A.owner,
        toolKey: 'list_deals',
        decision: 'executed',
        resultMeta: { count: 7, result_id: 'r1' },
        riskLevel: 1,
        durationMs: 42,
      }),
    );
    expect(row).toMatchObject({ toolKey: 'list_deals', decision: 'executed', riskLevel: 1 });
    const e = await falhaCom(
      getDb().execute(sql`
        insert into copilot_tool_calls (workspace_id, turn_id, member_id, tool_key, decision)
        values (${A.ws}, ${turn.id}, ${A.owner}, 'x', 'maybe')`),
    );
    expect(e.constraint_name).toBe('copilot_tool_calls_decision_chk');
  });
});

// ─── 5. Propostas ────────────────────────────────────────────────────────────────

describe('copilotProposalsRepo', () => {
  it('insertWithItems/getWithItems preservam a ordem; alvo repetido é recusado', async () => {
    const deal2 = await seedDeal(A);
    const created = await withWorkspace(A.ws, (tx) =>
      copilotProposalsRepo.insertWithItems(tx, {
        proposal: proposalInput(A),
        items: [
          { targetType: 'deal', targetId: A.deal, before: { stage_id: A.stage }, after: { stage_id: A.stage2 } },
          { targetType: 'deal', targetId: deal2, before: { stage_id: A.stage }, after: { stage_id: A.stage2 } },
        ],
      }),
    );
    expect(created.items.map((i) => i.position)).toEqual([0, 1]);
    const got = await withWorkspace(A.ws, (tx) => copilotProposalsRepo.getWithItems(tx, created.proposal.id));
    expect(got?.items.map((i) => i.targetId)).toEqual([A.deal, deal2]);
    expect(got?.items.every((i) => i.status === 'pending')).toBe(true);
    expect(await withWorkspace(B.ws, (tx) => copilotProposalsRepo.getWithItems(tx, created.proposal.id))).toBeNull();

    const e = await falhaCom(
      withWorkspace(A.ws, (tx) =>
        copilotProposalsRepo.insertWithItems(tx, {
          proposal: proposalInput(A),
          items: [
            { targetType: 'deal', targetId: A.deal },
            { targetType: 'deal', targetId: A.deal },
          ],
        }),
      ),
    );
    expect(e.constraint_name).toBe('uq_copilot_action_items_proposal_target');
  });

  it('transition por CAS: duas confirmações paralelas → exatamente uma vence', async () => {
    const { proposal } = await withWorkspace(A.ws, (tx) =>
      copilotProposalsRepo.insertWithItems(tx, { proposal: proposalInput(A), items: [] }),
    );
    const confirm = (key: string) =>
      withWorkspace(A.ws, (tx) =>
        copilotProposalsRepo.transition(tx, {
          id: proposal.id,
          from: ['proposed', 'awaiting_approval'],
          to: 'executing',
          expectedVersion: proposal.version,
          patch: { confirmIdempotencyKey: key, confirmedAt: new Date(), executedAsMemberId: A.owner },
          leaseSeconds: 120,
        }),
      );
    const results = await Promise.all([confirm('k-1'), confirm('k-2')]);
    const winners = results.filter((r) => r !== null);
    expect(winners).toHaveLength(1);
    const w = winners[0];
    expect(w?.status).toBe('executing');
    expect(w?.version).toBe(proposal.version + 1);
    expect(w?.leaseExpiresAt?.getTime()).toBeGreaterThan(Date.now() + 60_000);
    // Versão velha não casa mais.
    expect(await confirm('k-3')).toBeNull();
    // Executando sem lease é recusado pelo CHECK.
    const e = await falhaCom(
      getDb()
        .update(copilotActionProposals)
        .set({ leaseExpiresAt: null })
        .where(eq(copilotActionProposals.id, proposal.id)),
    );
    expect(e.constraint_name).toBe('copilot_proposals_executing_lease_chk');
  });

  it('setItemStatus (CAS por status), renewLease devolve stop_requested, varreduras', async () => {
    const { proposal, items } = await withWorkspace(A.ws, (tx) =>
      copilotProposalsRepo.insertWithItems(tx, {
        proposal: proposalInput(A, { status: 'executing', leaseExpiresAt: new Date(Date.now() - 1000) }),
        items: [{ targetType: 'deal', targetId: A.deal }],
      }),
    );
    const item = items[0];
    if (!item) throw new Error('seed item');
    const done = await withWorkspace(A.ws, (tx) =>
      copilotProposalsRepo.setItemStatus(tx, {
        itemId: item.id,
        from: ['pending'],
        to: 'done',
        patch: { executedAt: new Date(), undoPayload: { stage_id: A.stage } },
      }),
    );
    expect(done?.status).toBe('done');
    // Retomada idempotente: item já feito não volta a "pending → done".
    expect(
      await withWorkspace(A.ws, (tx) =>
        copilotProposalsRepo.setItemStatus(tx, { itemId: item.id, from: ['pending'], to: 'done' }),
      ),
    ).toBeNull();

    // Varredura (papel owner, entre workspaces): lease vencido aparece.
    const stale = await copilotProposalsRepo.listStaleExecuting(getDb(), new Date(), 1000);
    expect(stale.map((p) => p.id)).toContain(proposal.id);

    await getDb()
      .update(copilotActionProposals)
      .set({ stopRequested: true })
      .where(eq(copilotActionProposals.id, proposal.id));
    const lease = await withWorkspace(A.ws, (tx) => copilotProposalsRepo.renewLease(tx, proposal.id, 60));
    expect(lease?.stopRequested).toBe(true);
    expect(lease?.leaseExpiresAt.getTime()).toBeGreaterThan(Date.now());
    const staleAfter = await copilotProposalsRepo.listStaleExecuting(getDb(), new Date(), 1000);
    expect(staleAfter.map((p) => p.id)).not.toContain(proposal.id);

    // Expiração de abertas.
    const { proposal: old } = await withWorkspace(A.ws, (tx) =>
      copilotProposalsRepo.insertWithItems(tx, {
        proposal: proposalInput(A, { expiresAt: new Date(Date.now() - 60_000) }),
        items: [],
      }),
    );
    const expired = await copilotProposalsRepo.listExpiredOpen(getDb(), new Date(), 1000);
    expect(expired.map((p) => p.id)).toContain(old.id);
    expect(expired.every((p) => p.status === 'proposed' || p.status === 'awaiting_approval')).toBe(true);
  });

  it('listActivity: mine × all, contagem de itens e paginação', async () => {
    const t = await seedTenant(`ac${randomUUID().slice(0, 4)}`);
    try {
      const mk = (requestedByMemberId: string) =>
        withWorkspace(t.ws, (tx) =>
          copilotProposalsRepo.insertWithItems(tx, {
            proposal: proposalInput(t, { requestedByMemberId }),
            items: [{ targetType: 'deal', targetId: t.deal }],
          }),
        );
      const a1 = await mk(t.agent);
      await mk(t.agent);
      await mk(t.owner);
      const item = a1.items[0];
      if (!item) throw new Error('seed');
      await withWorkspace(t.ws, (tx) =>
        copilotProposalsRepo.setItemStatus(tx, { itemId: item.id, to: 'done' }),
      );

      const mine = await withWorkspace(t.ws, (tx) =>
        copilotProposalsRepo.listActivity(tx, { scope: 'mine', memberId: t.agent }),
      );
      expect(mine.items).toHaveLength(2);
      expect(mine.items.every((p) => p.requestedByMemberId === t.agent)).toBe(true);
      const entry = mine.items.find((p) => p.id === a1.proposal.id);
      expect(entry?.itemCounts).toMatchObject({ total: 1, done: 1, pending: 0 });

      const page1 = await withWorkspace(t.ws, (tx) =>
        copilotProposalsRepo.listActivity(tx, { scope: 'all', memberId: t.agent, limit: 2 }),
      );
      expect(page1.items).toHaveLength(2);
      const page2 = await withWorkspace(t.ws, (tx) =>
        copilotProposalsRepo.listActivity(tx, {
          scope: 'all',
          memberId: t.agent,
          limit: 2,
          cursor: page1.nextCursor,
        }),
      );
      expect(page2.items).toHaveLength(1);
      expect(page2.nextCursor).toBeNull();
      // B não vê a atividade de t.
      const fromB = await withWorkspace(B.ws, (tx) =>
        copilotProposalsRepo.listActivity(tx, { scope: 'all', memberId: B.owner, limit: 50 }),
      );
      expect(fromB.items.some((p) => p.workspaceId === t.ws)).toBe(false);
    } finally {
      await getDb().delete(deals).where(eq(deals.workspaceId, t.ws));
      await getDb().delete(workspaces).where(eq(workspaces.id, t.ws));
    }
  });

  it('CHECKs: risco 1–4, bloqueada exige motivo, aberta exige validade', async () => {
    const ins = (over: Partial<InsertCopilotProposalShape>) =>
      withWorkspace(A.ws, (tx) =>
        copilotProposalsRepo.insertWithItems(tx, { proposal: proposalInput(A, over), items: [] }),
      );
    expect((await falhaCom(ins({ riskLevel: 5 as 4 }))).constraint_name).toBe(
      'copilot_proposals_risk_level_chk',
    );
    expect((await falhaCom(ins({ riskLevel: 0 as 1 }))).constraint_name).toBe(
      'copilot_proposals_risk_level_chk',
    );
    expect((await falhaCom(ins({ status: 'blocked' }))).constraint_name).toBe(
      'copilot_proposals_blocked_has_reason_chk',
    );
    expect((await falhaCom(ins({ expiresAt: null }))).constraint_name).toBe(
      'copilot_proposals_open_expires_chk',
    );
    await expect(ins({ status: 'blocked', blockedReason: 'role', expiresAt: null })).resolves.toBeTruthy();
    // Nível 2 executado na hora: completed, sem validade, com prazo de desfazer.
    await expect(
      ins({
        status: 'completed',
        riskLevel: 2,
        expiresAt: null,
        completedAt: new Date(),
        undoDeadline: new Date(Date.now() + 24 * 3600_000),
      }),
    ).resolves.toBeTruthy();
  });
});

// ─── 6. Memória ──────────────────────────────────────────────────────────────────

describe('copilotMemoryRepo', () => {
  it('upsertProfile supera o anterior; paralelas na mesma chave não quebram o único parcial', async () => {
    const t = await seedTenant(`mp${randomUUID().slice(0, 4)}`);
    try {
      const v1 = await withWorkspace(t.ws, (tx) =>
        copilotMemoryRepo.upsertProfile(tx, {
          workspaceId: t.ws,
          key: 'what_we_sell',
          content: 'Alinhadores e clareamento',
          sourceLabel: 'Bruna',
          createdBy: t.owner,
        }),
      );
      const same = await withWorkspace(t.ws, (tx) =>
        copilotMemoryRepo.upsertProfile(tx, {
          workspaceId: t.ws,
          key: 'what_we_sell',
          content: 'Alinhadores e clareamento',
          sourceLabel: 'Bruna',
        }),
      );
      expect(same.id).toBe(v1.id);
      const results = await Promise.all(
        ['Implantes', 'Ortodontia', 'Clareamento'].map((content) =>
          withWorkspace(t.ws, (tx) =>
            copilotMemoryRepo.upsertProfile(tx, {
              workspaceId: t.ws,
              key: 'what_we_sell',
              content,
              sourceLabel: 'Bruna',
            }),
          ),
        ),
      );
      expect(results).toHaveLength(3);
      const rows = await getDb()
        .select()
        .from(copilotMemoryEntries)
        .where(eq(copilotMemoryEntries.workspaceId, t.ws));
      expect(rows.filter((r) => r.status === 'active')).toHaveLength(1);
      expect(rows.filter((r) => r.status === 'superseded')).toHaveLength(3);
      // Cadeia: toda linha nova aponta para a que superou.
      expect(rows.filter((r) => r.supersedesId !== null)).toHaveLength(3);

      // Único parcial direto no banco: dois ativos na mesma chave → 23505.
      const e = await falhaCom(
        getDb().insert(copilotMemoryEntries).values({
          workspaceId: t.ws,
          kind: 'profile',
          profileKey: 'what_we_sell',
          content: 'duplicado',
          sourceType: 'member',
          sourceLabel: 'x',
        }),
      );
      expect(e.code).toBe('23505');
      expect(e.constraint_name).toBe('uq_copilot_memory_active_profile');
    } finally {
      await getDb().delete(deals).where(eq(deals.workspaceId, t.ws));
      await getDb().delete(workspaces).where(eq(workspaces.id, t.ws));
    }
  });

  it('content: 1–500 após btrim; fato não tem chave de perfil', async () => {
    const base = { workspaceId: A.ws, kind: 'fact' as const, sourceType: 'member' as const, sourceLabel: 'x' };
    const db = getDb();
    expect((await falhaCom(db.insert(copilotMemoryEntries).values({ ...base, content: '   ' }))).constraint_name).toBe(
      'copilot_memory_content_chk',
    );
    expect(
      (await falhaCom(db.insert(copilotMemoryEntries).values({ ...base, content: 'a'.repeat(501) }))).constraint_name,
    ).toBe('copilot_memory_content_chk');
    await expect(
      db.insert(copilotMemoryEntries).values({ ...base, content: ` ${'a'.repeat(500)} ` }),
    ).resolves.toBeDefined();
    expect(
      (await falhaCom(db.insert(copilotMemoryEntries).values({ ...base, content: 'x', profileKey: 'tone' })))
        .constraint_name,
    ).toBe('copilot_memory_kind_key_chk');
  });

  it('listActiveForPrompt: perfil inteiro, pessoa antes de Copiloto/integração, ≤ 30 fatos e ≤ 2.500 caracteres', async () => {
    const t = await seedTenant(`mf${randomUUID().slice(0, 4)}`);
    try {
      const db = getDb();
      await withWorkspace(t.ws, (tx) =>
        copilotMemoryRepo.upsertProfile(tx, { workspaceId: t.ws, key: 'tone', content: 'Próximo', sourceLabel: 'Bruna' }),
      );
      // 20 de integração (mais novos), 20 do Copiloto, 5 de pessoa (mais velhos): a ordem é por fonte.
      const mk = (sourceType: 'member' | 'copilot' | 'integration', n: number, agoMin: number) =>
        Array.from({ length: n }, (_v, i) => ({
          workspaceId: t.ws,
          kind: 'fact' as const,
          content: `${sourceType} ${i}`,
          sourceType,
          sourceLabel: sourceType,
          updatedAt: new Date(Date.now() - (agoMin + i) * 60_000),
        }));
      await db.insert(copilotMemoryEntries).values([
        ...mk('integration', 20, 0),
        ...mk('copilot', 20, 100),
        ...mk('member', 5, 1000),
      ]);
      const mem = await withWorkspace(t.ws, (tx) => copilotMemoryRepo.listActiveForPrompt(tx, t.ws));
      expect(mem.profile).toEqual([{ key: 'tone', content: 'Próximo' }]);
      expect(mem.facts).toHaveLength(30);
      expect(mem.facts.slice(0, 5).every((f) => f.sourceType === 'member')).toBe(true);
      expect(mem.facts[0]?.content).toBe('member 0');
      expect(mem.facts.slice(5, 25).every((f) => f.sourceType === 'copilot')).toBe(true);
      expect(mem.facts.slice(25).every((f) => f.sourceType === 'integration')).toBe(true);

      // Teto de caracteres: fatos de 400 → cabem 6 (2.400), o 7º estouraria.
      await db
        .update(copilotMemoryEntries)
        .set({ content: 'z'.repeat(400) })
        .where(eq(copilotMemoryEntries.workspaceId, t.ws));
      const capped = await withWorkspace(t.ws, (tx) => copilotMemoryRepo.listActiveForPrompt(tx, t.ws));
      expect(capped.facts).toHaveLength(6);
      expect(capped.profile).toHaveLength(1);
    } finally {
      await getDb().delete(deals).where(eq(deals.workspaceId, t.ws));
      await getDb().delete(workspaces).where(eq(workspaces.id, t.ws));
    }
  });

  it('forget/restore/correct e listFacts', async () => {
    const fact = await withWorkspace(A.ws, (tx) =>
      copilotMemoryRepo.addFact(tx, {
        workspaceId: A.ws,
        content: 'Ticket médio R$ 4.800',
        sourceType: 'copilot',
        sourceLabel: 'Aprendido na conversa de 10/10',
      }),
    );
    const forgotten = await withWorkspace(A.ws, (tx) =>
      copilotMemoryRepo.forget(tx, { id: fact.id, memberId: A.owner }),
    );
    expect(forgotten).toMatchObject({ status: 'forgotten', forgottenBy: A.owner });
    expect(
      await withWorkspace(A.ws, (tx) => copilotMemoryRepo.forget(tx, { id: fact.id, memberId: A.owner })),
    ).toBeNull();
    const restored = await withWorkspace(A.ws, (tx) => copilotMemoryRepo.restore(tx, { id: fact.id }));
    expect(restored).toMatchObject({ status: 'active', forgottenAt: null, forgottenBy: null });

    const fixed = await withWorkspace(A.ws, (tx) =>
      copilotMemoryRepo.correct(tx, {
        id: fact.id,
        content: 'Ticket médio R$ 5.200',
        memberId: A.agent,
        sourceLabel: 'Corrigido por Paula',
      }),
    );
    expect(fixed?.original.status).toBe('superseded');
    expect(fixed?.corrected).toMatchObject({
      sourceType: 'member',
      supersedesId: fact.id,
      createdBy: A.agent,
      status: 'active',
    });
    // Corrigir de novo o original (já superado) não casa.
    expect(
      await withWorkspace(A.ws, (tx) =>
        copilotMemoryRepo.correct(tx, { id: fact.id, content: 'x', memberId: A.agent, sourceLabel: 'x' }),
      ),
    ).toBeNull();

    const facts = await withWorkspace(A.ws, (tx) => copilotMemoryRepo.listFacts(tx, { limit: 50 }));
    const ids = facts.items.map((f) => f.id);
    expect(ids).toContain(fixed?.corrected.id);
    expect(ids).not.toContain(fact.id); // superseded fica fora da lista padrão
    expect(facts.items.every((f) => f.kind === 'fact')).toBe(true);
  });
});

// ─── 7. Briefing ─────────────────────────────────────────────────────────────────

describe('copilotBriefingsRepo', () => {
  it('um por (membro, data): regenerar preserva visto/push; push sai uma vez; ≤ 3 itens', async () => {
    const day = '2026-10-16';
    const first = await withWorkspace(A.ws, (tx) =>
      copilotBriefingsRepo.upsert(tx, {
        workspaceId: A.ws,
        memberId: A.agent,
        forDate: day,
        dataAsOf: new Date(),
        items: [{ kind: 'deals_idle' }],
        overflowCount: 0,
        status: 'ready',
      }),
    );
    await withWorkspace(A.ws, (tx) => copilotBriefingsRepo.markSeen(tx, A.agent, day));
    expect(await withWorkspace(A.ws, (tx) => copilotBriefingsRepo.markPushSent(tx, first.id))).toBe(true);
    expect(await withWorkspace(A.ws, (tx) => copilotBriefingsRepo.markPushSent(tx, first.id))).toBe(false);
    const again = await withWorkspace(A.ws, (tx) =>
      copilotBriefingsRepo.upsert(tx, {
        workspaceId: A.ws,
        memberId: A.agent,
        forDate: day,
        dataAsOf: new Date(),
        items: [{ kind: 'deals_idle' }, { kind: 'events_today' }],
        overflowCount: 2,
        status: 'ready',
      }),
    );
    expect(again.id).toBe(first.id);
    expect(again.items).toHaveLength(2);
    expect(again.seenAt).toBeInstanceOf(Date);
    expect(again.pushSentAt).toBeInstanceOf(Date);
    const got = await withWorkspace(A.ws, (tx) => copilotBriefingsRepo.getFor(tx, A.agent, day));
    expect(got?.forDate).toBe(day);

    const e = await falhaCom(
      getDb().insert(copilotBriefings).values({
        workspaceId: A.ws,
        memberId: A.agent,
        forDate: day,
        dataAsOf: new Date(),
        status: 'ready',
      }),
    );
    expect(e.constraint_name).toBe('uq_copilot_briefings_member_date');
    const e2 = await falhaCom(
      getDb().insert(copilotBriefings).values({
        workspaceId: A.ws,
        memberId: A.agent,
        forDate: '2026-10-17',
        dataAsOf: new Date(),
        status: 'ready',
        items: [{}, {}, {}, {}],
      }),
    );
    expect(e2.constraint_name).toBe('copilot_briefings_items_chk');
  });
});

// ─── 8. Piloto automático ────────────────────────────────────────────────────────

describe('copilotAutopilotRepo', () => {
  it('upsertRule registra quem LIGOU e mantém enquanto segue ligada', async () => {
    const r1 = await withWorkspace(A.ws, (tx) =>
      copilotAutopilotRepo.upsertRule(tx, {
        workspaceId: A.ws,
        stageId: A.stage,
        mode: 'suggest',
        criteria: { idle_days: 7, target_stage_id: A.stage2, require_last_outbound: true },
        memberId: A.owner,
      }),
    );
    expect(r1).toMatchObject({ mode: 'suggest', enabledBy: A.owner, dailyLimit: 10 });
    const r2 = await withWorkspace(A.ws, (tx) =>
      copilotAutopilotRepo.upsertRule(tx, {
        workspaceId: A.ws,
        stageId: A.stage,
        mode: 'daily_approval',
        criteria: { idle_days: 9, target_stage_id: A.stage2 },
        dailyLimit: 20,
        memberId: A.agent,
      }),
    );
    expect(r2).toMatchObject({ mode: 'daily_approval', enabledBy: A.owner, dailyLimit: 20 });
    expect(r2.enabledAt?.getTime()).toBe(r1.enabledAt?.getTime());
    const off = await withWorkspace(A.ws, (tx) =>
      copilotAutopilotRepo.upsertRule(tx, {
        workspaceId: A.ws,
        stageId: A.stage,
        mode: 'off',
        criteria: {},
        memberId: A.agent,
      }),
    );
    expect(off).toMatchObject({ mode: 'off', enabledBy: null, enabledAt: null });
    const rules = await withWorkspace(A.ws, (tx) => copilotAutopilotRepo.listRules(tx));
    expect(rules.map((r) => r.stageId)).toContain(A.stage);
    expect(
      (await withWorkspace(A.ws, (tx) => copilotAutopilotRepo.listRules(tx, { modes: ['suggest'] }))).length,
    ).toBe(0);
    const e = await falhaCom(
      withWorkspace(A.ws, (tx) =>
        copilotAutopilotRepo.upsertRule(tx, {
          workspaceId: A.ws,
          stageId: A.stage,
          mode: 'suggest',
          criteria: {},
          dailyLimit: 51,
          memberId: A.owner,
        }),
      ),
    );
    expect(e.constraint_name).toBe('copilot_autopilot_rules_daily_limit_chk');
  });

  it('uma sugestão pendente por negócio; decidir é único; expirar libera nova', async () => {
    const dealId = await seedDeal(A);
    const input = {
      workspaceId: A.ws,
      dealId,
      fromStageId: A.stage,
      toStageId: A.stage2,
      reasonCode: 'idle_last_outbound',
      reasonText: 'Sem resposta há 9 dias; a última mensagem foi nossa, em 07/10',
      confidence: 'high' as const,
    };
    const s1 = await withWorkspace(A.ws, (tx) => copilotAutopilotRepo.insertSuggestionIfAbsent(tx, input));
    expect(s1?.status).toBe('pending');
    expect(
      await withWorkspace(A.ws, (tx) => copilotAutopilotRepo.insertSuggestionIfAbsent(tx, input)),
    ).toBeNull();
    // O único parcial direto no banco.
    const e = await falhaCom(getDb().insert(copilotSuggestions).values(input));
    expect(e.constraint_name).toBe('uq_copilot_suggestions_pending_deal');

    const list = await withWorkspace(A.ws, (tx) =>
      copilotAutopilotRepo.listSuggestions(tx, { status: 'pending', limit: 50 }),
    );
    expect(list.items.map((s) => s.id)).toContain(s1?.id);

    const decided = await withWorkspace(A.ws, (tx) =>
      copilotAutopilotRepo.decideSuggestions(tx, { ids: [s1?.id ?? ''], decision: 'reject', memberId: A.owner }),
    );
    expect(decided).toHaveLength(1);
    expect(decided[0]).toMatchObject({ status: 'rejected', decidedBy: A.owner });
    expect(
      await withWorkspace(A.ws, (tx) =>
        copilotAutopilotRepo.decideSuggestions(tx, { ids: [s1?.id ?? ''], decision: 'approve', memberId: A.owner }),
      ),
    ).toHaveLength(0);

    const s2 = await withWorkspace(A.ws, (tx) => copilotAutopilotRepo.insertSuggestionIfAbsent(tx, input));
    expect(s2).not.toBeNull();
    const n = await withWorkspace(A.ws, (tx) =>
      copilotAutopilotRepo.expireSuggestionsForDeal(tx, { dealId, status: 'superseded' }),
    );
    expect(n).toBe(1);
    expect(
      await withWorkspace(A.ws, (tx) => copilotAutopilotRepo.insertSuggestionIfAbsent(tx, input)),
    ).not.toBeNull();

    const e2 = await falhaCom(
      getDb().insert(copilotSuggestions).values({ ...input, dealId: A.deal, toStageId: A.stage }),
    );
    expect(e2.constraint_name).toBe('copilot_suggestions_stages_chk');
  });
});

// ─── 9. audit_logs / llm_usage_logs ──────────────────────────────────────────────

describe('extensões de audit_logs e llm_usage_logs', () => {
  it('audit_logs aceita copilot/autopilot com as colunas novas e recusa ator desconhecido', async () => {
    const { proposal } = await withWorkspace(A.ws, (tx) =>
      copilotProposalsRepo.insertWithItems(tx, { proposal: proposalInput(A), items: [] }),
    );
    for (const actorType of ['copilot', 'autopilot']) {
      const [row] = await withWorkspace(A.ws, (tx) =>
        tx
          .insert(auditLogs)
          .values({
            workspaceId: A.ws,
            actorMemberId: A.agent,
            requestedByMemberId: A.owner,
            actorType,
            action: 'copilot.proposal.confirmed',
            resourceType: 'copilot_proposal',
            resourceId: proposal.id,
            copilotProposalId: proposal.id,
            copilotTurnId: randomUUID(),
            metadata: { capability: 'deal.move', risk_level: 3 },
          })
          .returning(),
      );
      expect(row?.actorType).toBe(actorType);
      expect(row?.requestedByMemberId).toBe(A.owner);
    }
    const e = await falhaCom(
      getDb().insert(auditLogs).values({
        workspaceId: A.ws,
        actorType: 'robot',
        action: 'x',
        resourceType: 'x',
      }),
    );
    expect(e.constraint_name).toBe('audit_logs_actor_type_chk');
    // Valores antigos seguem válidos.
    await expect(
      getDb().insert(auditLogs).values({ workspaceId: A.ws, actorType: 'system', action: 'x', resourceType: 'x' }),
    ).resolves.toBeDefined();
    // requested_by de outro workspace: FK composta recusa.
    const e2 = await falhaCom(
      getDb().insert(auditLogs).values({
        workspaceId: A.ws,
        actorType: 'copilot',
        action: 'x',
        resourceType: 'x',
        requestedByMemberId: B.owner,
      }),
    );
    expect(e2.code).toBe('23503');
    expect(e2.constraint_name).toBe('audit_logs_workspace_requested_by_fk');
  });

  it('llm_usage_logs.surface: default agent; copilot aceito; outro valor recusado', async () => {
    const [legacy] = await getDb()
      .insert(llmUsageLogs)
      .values({ workspaceId: A.ws, requestType: 'chat', model: 'openai/gpt-4o-mini' })
      .returning();
    expect(legacy?.surface).toBe('agent');
    expect(legacy?.copilotTurnId).toBeNull();
    const turnId = randomUUID();
    const [cp] = await getDb()
      .insert(llmUsageLogs)
      .values({
        workspaceId: A.ws,
        requestType: 'chat',
        model: 'openai/gpt-4o-mini',
        surface: 'copilot',
        copilotTurnId: turnId,
        costUsd: '0.00010000',
      })
      .returning();
    expect(cp).toMatchObject({ surface: 'copilot', copilotTurnId: turnId });
    const e = await falhaCom(
      getDb().execute(sql`
        insert into llm_usage_logs (workspace_id, request_type, model, surface)
        values (${A.ws}, 'chat', 'm', 'playground')`),
    );
    expect(e.constraint_name).toBe('llm_usage_logs_surface_chk');
  });
});

// ─── 10. Régua de "parado" ───────────────────────────────────────────────────────

describe('dealIdleDaysSql / dealLastMessageDirectionSql', () => {
  async function newConversation(t: Tenant): Promise<string> {
    const [cv] = await getDb()
      .insert(conversations)
      .values({
        workspaceId: t.ws,
        channelId: t.channel,
        remoteId: `f73-idle-${randomUUID()}`,
        contactId: t.contact,
      })
      .returning({ id: conversations.id });
    if (!cv) throw new Error('seed conversation');
    return cv.id;
  }

  async function message(t: Tenant, conversationId: string, direction: 'inbound' | 'outbound', daysAgo: number) {
    await getDb()
      .insert(messages)
      .values({
        workspaceId: t.ws,
        conversationId,
        direction,
        senderType: direction === 'inbound' ? 'contact' : 'member',
        content: direction,
        providerTimestamp: new Date(Date.now() - daysAgo * 86_400_000),
      });
  }

  async function measure(dealIds: string[]) {
    const rows = await withWorkspace(A.ws, (tx) =>
      tx
        .select({
          id: deals.id,
          idle: dealIdleDaysSql(),
          direction: dealLastMessageDirectionSql(),
        })
        .from(deals)
        .where(inArray(deals.id, dealIds)),
    );
    return new Map(rows.map((r) => [r.id, r]));
  }

  it('sem conversa, conversa vazia, só nossa, do contato e do contato seguida da nossa', async () => {
    const updatedAt = new Date(Date.now() - 10 * 86_400_000);
    const noConv = await seedDeal(A, { updatedAt: new Date(Date.now() - 4 * 86_400_000) });
    const neverUpdated = await seedDeal(A, { createdAt: new Date(Date.now() - 2 * 86_400_000) });

    const cvEmpty = await newConversation(A);
    const emptyConv = await seedDeal(A, { conversationId: cvEmpty, updatedAt });

    const cvOurs = await newConversation(A);
    await message(A, cvOurs, 'outbound', 5);
    const onlyOurs = await seedDeal(A, { conversationId: cvOurs, updatedAt });

    const cvTheirs = await newConversation(A);
    await message(A, cvTheirs, 'outbound', 6);
    await message(A, cvTheirs, 'inbound', 3);
    const theirs = await seedDeal(A, { conversationId: cvTheirs, updatedAt });

    const cvBoth = await newConversation(A);
    await message(A, cvBoth, 'inbound', 8);
    await message(A, cvBoth, 'outbound', 1);
    const both = await seedDeal(A, { conversationId: cvBoth, updatedAt });

    const m = await measure([noConv, neverUpdated, emptyConv, onlyOurs, theirs, both]);
    expect(m.get(noConv)).toMatchObject({ idle: 4, direction: null });
    expect(m.get(neverUpdated)).toMatchObject({ idle: 2, direction: null });
    expect(m.get(emptyConv)).toMatchObject({ idle: 10, direction: null });
    // Só mensagem nossa: o contato nunca respondeu → conta desde o negócio.
    expect(m.get(onlyOurs)).toMatchObject({ idle: 10, direction: 'outbound' });
    expect(m.get(theirs)).toMatchObject({ idle: 3, direction: 'inbound' });
    // A nossa depois da dele não "zera" o parado: conta da última DO CONTATO.
    expect(m.get(both)).toMatchObject({ idle: 8, direction: 'outbound' });
    expect(typeof m.get(both)?.idle).toBe('number');
  });
});
