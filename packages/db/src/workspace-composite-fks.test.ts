/**
 * F70-S12 — FKs compostas por workspace em `deals` e `stages` (migração 0085).
 *
 * A checagem de FK do Postgres roda fora da RLS. Com `(workspace_id, x_id) REFERENCES
 * alvo (workspace_id, id)` o banco recusa (23503) qualquer referência a um registro de
 * outro workspace, mesmo que o handler esqueça de validar.
 *
 * Três camadas: (1) schema Drizzle × texto da migração (sem banco); (2) o que está de
 * fato no Postgres dev (pg_constraint/pg_indexes); (3) comportamento — recusa cruzada,
 * ações de exclusão preservadas, caminho feliz e o pré-voo da migração.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { eq, sql } from 'drizzle-orm';
import { getTableConfig, type PgTable } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, getDb } from './client';
import { withWorkspace } from './rls';
import {
  channels,
  contacts,
  conversations,
  deals,
  members,
  pipelines,
  stages,
  workspaces,
} from './schema';

const here = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION_TAG = '0085_f70_workspace_composite_fks';
const migration = readFileSync(path.resolve(here, `../drizzle/${MIGRATION_TAG}.sql`), 'utf-8');
const journal: unknown = JSON.parse(
  readFileSync(path.resolve(here, '../drizzle/meta/_journal.json'), 'utf-8'),
);

type Action = 'cascade' | 'restrict' | 'set null';
type ExpectedFk = {
  table: 'deals' | 'stages';
  name: string;
  column: string;
  target: string;
  action: Action;
  /** Cláusula ON DELETE como o Postgres a devolve em pg_get_constraintdef. */
  onDeleteSql: string;
  /** Nome da FK simples que a migração remove. */
  legacy: string;
};

const FKS: readonly ExpectedFk[] = [
  {
    table: 'stages',
    name: 'stages_workspace_pipeline_fk',
    column: 'pipeline_id',
    target: 'pipelines',
    action: 'cascade',
    onDeleteSql: 'ON DELETE CASCADE',
    legacy: 'stages_pipeline_id_pipelines_id_fk',
  },
  {
    table: 'deals',
    name: 'deals_workspace_pipeline_fk',
    column: 'pipeline_id',
    target: 'pipelines',
    action: 'cascade',
    onDeleteSql: 'ON DELETE CASCADE',
    legacy: 'deals_pipeline_id_pipelines_id_fk',
  },
  {
    table: 'deals',
    name: 'deals_workspace_stage_fk',
    column: 'stage_id',
    target: 'stages',
    action: 'restrict',
    onDeleteSql: 'ON DELETE RESTRICT',
    legacy: 'deals_stage_id_stages_id_fk',
  },
  {
    table: 'deals',
    name: 'deals_workspace_contact_fk',
    column: 'contact_id',
    target: 'contacts',
    action: 'cascade',
    onDeleteSql: 'ON DELETE CASCADE',
    legacy: 'deals_contact_id_contacts_id_fk',
  },
  {
    table: 'deals',
    name: 'deals_workspace_conversation_fk',
    column: 'conversation_id',
    target: 'conversations',
    action: 'set null',
    onDeleteSql: 'ON DELETE SET NULL (conversation_id)',
    legacy: 'deals_conversation_id_conversations_id_fk',
  },
  {
    table: 'deals',
    name: 'deals_workspace_owner_fk',
    column: 'owner_id',
    target: 'members',
    action: 'set null',
    onDeleteSql: 'ON DELETE SET NULL (owner_id)',
    legacy: 'deals_owner_id_members_id_fk',
  },
];

const TARGETS: ReadonlyArray<[string, PgTable]> = [
  ['pipelines', pipelines],
  ['stages', stages],
  ['members', members],
  ['contacts', contacts],
  ['conversations', conversations],
];

const TABLES: Record<ExpectedFk['table'], PgTable> = { deals, stages };

type PgErr = { code?: string; constraint_name?: string; message?: string; detail?: string };

/** O Drizzle (e o withWorkspace) embrulham o erro do driver; o SQLSTATE vive em `cause`. */
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

// ─── 1. schema × migração (sem banco) ────────────────────────────────────────────

describe('schema Drizzle × migração 0085', () => {
  it.each(FKS)('$name: FK composta ($column) com a ação preservada', (fk) => {
    const cfg = getTableConfig(TABLES[fk.table]);
    const found = cfg.foreignKeys.find((f) => f.getName() === fk.name);
    expect(found, fk.name).toBeDefined();
    const ref = found?.reference();
    expect(ref?.columns.map((c) => c.name)).toEqual(['workspace_id', fk.column]);
    expect(ref?.foreignColumns.map((c) => c.name)).toEqual(['workspace_id', 'id']);
    expect(ref ? getTableConfig(ref.foreignTable).name : undefined).toBe(fk.target);
    expect(found?.onDelete).toBe(fk.action);

    // Nenhuma FK de coluna única sobra na coluna (a simples antiga foi removida).
    const simples = cfg.foreignKeys.filter((f) => {
      const cols = f.reference().columns.map((c) => c.name);
      return cols.length === 1 && cols[0] === fk.column;
    });
    expect(simples).toHaveLength(0);

    // A migração remove a antiga e cria a nova com a MESMA ação.
    expect(migration).toContain(`DROP CONSTRAINT IF EXISTS ${fk.legacy}`);
    const add = new RegExp(
      `ADD CONSTRAINT ${fk.name}\\s+FOREIGN KEY \\(workspace_id, ${fk.column}\\) REFERENCES ${fk.target} \\(workspace_id, id\\)\\s+${fk.onDeleteSql.replace(/[()]/g, '\\$&')}[,;]`,
    );
    expect(migration).toMatch(add);
  });

  it.each(TARGETS)('%s: unique (workspace_id, id) no schema e na migração', (name, table) => {
    const idx = getTableConfig(table).indexes.find(
      (i) => i.config.name === `uq_${name}_workspace_id`,
    );
    expect(idx?.config.unique).toBe(true);
    expect(idx?.config.where).toBeUndefined();
    expect(idx?.config.columns.map((c) => ('name' in c ? c.name : '?'))).toEqual([
      'workspace_id',
      'id',
    ]);
    expect(migration).toContain(
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_${name}_workspace_id ON ${name} (workspace_id, id);`,
    );
  });

  it('uq_deals_conversation continua global (conversation_id), parcial, e a 0085 não mexe nele', () => {
    const idx = getTableConfig(deals).indexes.find(
      (i) => i.config.name === 'uq_deals_conversation',
    );
    expect(idx?.config.unique).toBe(true);
    expect(idx?.config.where).toBeDefined();
    expect(idx?.config.columns.map((c) => ('name' in c ? c.name : '?'))).toEqual([
      'conversation_id',
    ]);
    expect(migration).not.toMatch(/(CREATE|DROP)[^;]*INDEX[^;]*uq_deals_conversation/i);
  });

  it('migração não apaga nem anula dado (só aborta)', () => {
    expect(migration).not.toMatch(/^\s*(DELETE|UPDATE|TRUNCATE)\b/im);
    expect(migration).toContain('RAISE EXCEPTION');
  });

  it('journal registra a 0085 logo depois da 0084', () => {
    const entries =
      typeof journal === 'object' &&
      journal !== null &&
      'entries' in journal &&
      Array.isArray(journal.entries)
        ? (journal.entries as Array<{ idx: number; tag: string }>)
        : [];
    const i = entries.findIndex((e) => e.tag === MIGRATION_TAG);
    expect(i).toBeGreaterThan(0);
    expect(entries[i]?.idx).toBe(85);
    expect(entries[i - 1]?.tag).toBe('0084_f70_agent_tools_catalog');
  });
});

// ─── 2 e 3. Postgres dev ─────────────────────────────────────────────────────────

type Tenant = {
  ws: string;
  pipeline: string;
  stage: string;
  contact: string;
  conversation: string;
  member: string;
};

let suffix = '';
let A: Tenant;
let B: Tenant;

async function seedTenant(label: string): Promise<Tenant> {
  const db = getDb(); // owner: bypassa a RLS no seed
  const [w] = await db
    .insert(workspaces)
    .values({ name: `S12 ${label} ${suffix}`, slug: `s12-${label}-${suffix}` })
    .returning();
  if (!w) throw new Error('seed workspace');
  const [pl] = await db
    .insert(pipelines)
    .values({ workspaceId: w.id, name: `P ${label}` })
    .returning();
  if (!pl) throw new Error('seed pipeline');
  const [st] = await db
    .insert(stages)
    .values({ workspaceId: w.id, pipelineId: pl.id, name: `S ${label}`, position: 0 })
    .returning();
  if (!st) throw new Error('seed stage');
  const [ct] = await db
    .insert(contacts)
    .values({ workspaceId: w.id, displayName: `C ${label}` })
    .returning();
  if (!ct) throw new Error('seed contact');
  const [ch] = await db
    .insert(channels)
    .values({
      workspaceId: w.id,
      provider: 'meta_whatsapp',
      name: `WA ${label} ${suffix}`,
      phoneNumberId: `s12-pn-${label}-${suffix}`,
      wabaId: `s12-waba-${label}-${suffix}`,
    })
    .returning();
  if (!ch) throw new Error('seed channel');
  const [cv] = await db
    .insert(conversations)
    .values({
      workspaceId: w.id,
      channelId: ch.id,
      remoteId: `s12-${label}-${suffix}`,
      contactId: ct.id,
    })
    .returning();
  if (!cv) throw new Error('seed conversation');
  const [m] = await db
    .insert(members)
    .values({
      workspaceId: w.id,
      authUserId: randomUUID(),
      email: `s12-${label}-${suffix}@test.local`,
      role: 'AGENT',
      status: 'active',
    })
    .returning();
  if (!m) throw new Error('seed member');
  return {
    ws: w.id,
    pipeline: pl.id,
    stage: st.id,
    contact: ct.id,
    conversation: cv.id,
    member: m.id,
  };
}

/** Deal válido do tenant `t`, com as referências sobrescritas por `over`. */
function dealValues(t: Tenant, over: Partial<typeof deals.$inferInsert> = {}) {
  return {
    workspaceId: t.ws,
    pipelineId: t.pipeline,
    stageId: t.stage,
    contactId: t.contact,
    conversationId: null,
    ownerId: t.member,
    title: `Deal ${suffix}`,
    ...over,
  } satisfies typeof deals.$inferInsert;
}

beforeAll(async () => {
  suffix = randomUUID().slice(0, 8);
  A = await seedTenant('a');
  B = await seedTenant('b');
});

afterAll(async () => {
  const db = getDb();
  for (const t of [A, B]) {
    if (!t) continue;
    // Deals antes: deals→stages é RESTRICT, e a cascata do workspace não tem ordem garantida.
    await db.delete(deals).where(eq(deals.workspaceId, t.ws));
    await db.delete(workspaces).where(eq(workspaces.id, t.ws));
  }
  await closeDb();
});

describe('Postgres dev: o que a 0085 deixou no catálogo', () => {
  it('as FKs compostas existem com a ação exata e as simples antigas sumiram', async () => {
    const rows = await getDb().execute<{ conname: string; def: string }>(sql`
      select conname, pg_get_constraintdef(oid) as def
        from pg_constraint
       where contype = 'f' and conrelid in ('deals'::regclass, 'stages'::regclass)`);
    const defs = new Map(rows.map((r) => [r.conname, r.def]));
    for (const fk of FKS) {
      expect(defs.get(fk.name), fk.name).toBe(
        `FOREIGN KEY (workspace_id, ${fk.column}) REFERENCES ${fk.target}(workspace_id, id) ${fk.onDeleteSql}`,
      );
      expect(defs.has(fk.legacy), fk.legacy).toBe(false);
    }
  });

  it('índices (workspace_id, id) e uq_deals_conversation global como na 0053', async () => {
    const rows = await getDb().execute<{ indexname: string; indexdef: string }>(sql`
      select indexname, indexdef from pg_indexes
       where schemaname = 'public'
         and (indexname like 'uq\_%\_workspace\_id' or indexname = 'uq_deals_conversation')`);
    const defs = new Map(rows.map((r) => [r.indexname, r.indexdef]));
    for (const [name] of TARGETS) {
      expect(defs.get(`uq_${name}_workspace_id`)).toBe(
        `CREATE UNIQUE INDEX uq_${name}_workspace_id ON public.${name} USING btree (workspace_id, id)`,
      );
    }
    expect(defs.get('uq_deals_conversation')).toBe(
      'CREATE UNIQUE INDEX uq_deals_conversation ON public.deals USING btree (conversation_id) WHERE (conversation_id IS NOT NULL)',
    );
  });
});

describe('referência cruzada entre workspaces é recusada (23503)', () => {
  const casos: Array<[string, (b: Tenant) => Partial<typeof deals.$inferInsert>, string]> = [
    ['pipeline_id', (b) => ({ pipelineId: b.pipeline }), 'deals_workspace_pipeline_fk'],
    ['stage_id', (b) => ({ stageId: b.stage }), 'deals_workspace_stage_fk'],
    ['contact_id', (b) => ({ contactId: b.contact }), 'deals_workspace_contact_fk'],
    [
      'conversation_id',
      (b) => ({ conversationId: b.conversation }),
      'deals_workspace_conversation_fk',
    ],
    ['owner_id', (b) => ({ ownerId: b.member }), 'deals_workspace_owner_fk'],
  ];

  it.each(casos)(
    'INSERT de deal com %s de outro workspace (papel owner, sem RLS)',
    async (_c, over, fk) => {
      const e = await falhaCom(
        getDb()
          .insert(deals)
          .values(dealValues(A, over(B))),
      );
      expect(e.code).toBe('23503');
      expect(e.constraint_name).toBe(fk);
    },
  );

  it.each(casos)('UPDATE de deal para %s de outro workspace', async (_c, over, fk) => {
    const db = getDb();
    const [d] = await db.insert(deals).values(dealValues(A)).returning({ id: deals.id });
    if (!d) throw new Error('seed deal');
    const e = await falhaCom(db.update(deals).set(over(B)).where(eq(deals.id, d.id)));
    expect(e.code).toBe('23503');
    expect(e.constraint_name).toBe(fk);
    await db.delete(deals).where(eq(deals.id, d.id));
  });

  it('INSERT sob hm_app + RLS (caminho da API) também é recusado', async () => {
    const e = await falhaCom(
      withWorkspace(A.ws, (tx) => tx.insert(deals).values(dealValues(A, { stageId: B.stage }))),
    );
    expect(e.code).toBe('23503');
    expect(e.constraint_name).toBe('deals_workspace_stage_fk');
  });

  it('stage com pipeline de outro workspace', async () => {
    const e = await falhaCom(
      getDb()
        .insert(stages)
        .values({ workspaceId: A.ws, pipelineId: B.pipeline, name: 'X', position: 99 }),
    );
    expect(e.code).toBe('23503');
    expect(e.constraint_name).toBe('stages_workspace_pipeline_fk');
  });
});

describe('caminho feliz', () => {
  it('deal com todas as referências do próprio workspace, via hm_app + RLS', async () => {
    const d = await withWorkspace(A.ws, async (tx) => {
      const [row] = await tx
        .insert(deals)
        .values(dealValues(A, { conversationId: A.conversation }))
        .returning();
      return row;
    });
    expect(d?.workspaceId).toBe(A.ws);
    expect(d?.conversationId).toBe(A.conversation);
    expect(d?.ownerId).toBe(A.member);

    // Mover de etapa dentro do mesmo pipeline/workspace segue funcionando.
    const [st2] = await getDb()
      .insert(stages)
      .values({ workspaceId: A.ws, pipelineId: A.pipeline, name: 'S2', position: 1 })
      .returning();
    if (!st2 || !d) throw new Error('seed');
    await withWorkspace(A.ws, (tx) =>
      tx.update(deals).set({ stageId: st2.id }).where(eq(deals.id, d.id)),
    );
    const [moved] = await getDb().select().from(deals).where(eq(deals.id, d.id));
    expect(moved?.stageId).toBe(st2.id);
    await getDb().delete(deals).where(eq(deals.id, d.id));
    await getDb().delete(stages).where(eq(stages.id, st2.id));
  });

  it('ON CONFLICT (conversation_id) dos chamadores segue casando: 1 deal por conversa', async () => {
    // Mesmo alvo de ensureDealForConversation e do insert de deal do leadgen.
    const inserir = (tx: Pick<ReturnType<typeof getDb>, 'insert'>) =>
      tx
        .insert(deals)
        .values(dealValues(A, { conversationId: A.conversation }))
        .onConflictDoNothing({
          target: deals.conversationId,
          where: sql`${deals.conversationId} is not null`,
        })
        .returning({ id: deals.id });
    const primeiro = await inserir(getDb());
    // Sob hm_app + RLS, como na API: o perdedor da corrida não aborta a transação.
    const segundo = await withWorkspace(A.ws, (tx) => inserir(tx));
    expect(primeiro).toHaveLength(1);
    expect(segundo).toHaveLength(0);

    // Deals sem conversa seguem coexistindo.
    const db = getDb();
    await db.insert(deals).values([dealValues(A), dealValues(A)]);
    await db.delete(deals).where(eq(deals.workspaceId, A.ws));
  });
});

describe('ações de exclusão preservadas', () => {
  it('conversation → SET NULL só em conversation_id (workspace_id intacto)', async () => {
    const t = await seedTenant(`cv${randomUUID().slice(0, 4)}`);
    const db = getDb();
    const [d] = await db
      .insert(deals)
      .values(dealValues(t, { conversationId: t.conversation }))
      .returning({ id: deals.id });
    if (!d) throw new Error('seed');
    await db.delete(conversations).where(eq(conversations.id, t.conversation));
    const [row] = await db.select().from(deals).where(eq(deals.id, d.id));
    expect(row?.conversationId).toBeNull();
    expect(row?.workspaceId).toBe(t.ws);
    await db.delete(deals).where(eq(deals.workspaceId, t.ws));
    await db.delete(workspaces).where(eq(workspaces.id, t.ws));
  });

  it('member → SET NULL só em owner_id (workspace_id intacto)', async () => {
    const t = await seedTenant(`mb${randomUUID().slice(0, 4)}`);
    const db = getDb();
    const [d] = await db.insert(deals).values(dealValues(t)).returning({ id: deals.id });
    if (!d) throw new Error('seed');
    await db.delete(members).where(eq(members.id, t.member));
    const [row] = await db.select().from(deals).where(eq(deals.id, d.id));
    expect(row?.ownerId).toBeNull();
    expect(row?.workspaceId).toBe(t.ws);
    await db.delete(deals).where(eq(deals.workspaceId, t.ws));
    await db.delete(workspaces).where(eq(workspaces.id, t.ws));
  });

  it('stage com deal → RESTRICT (23503); sem deal, apaga', async () => {
    const t = await seedTenant(`st${randomUUID().slice(0, 4)}`);
    const db = getDb();
    await db.insert(deals).values(dealValues(t));
    const e = await falhaCom(db.delete(stages).where(eq(stages.id, t.stage)));
    expect(e.code).toBe('23503');
    expect(e.constraint_name).toBe('deals_workspace_stage_fk');
    await db.delete(deals).where(eq(deals.workspaceId, t.ws));
    await db.delete(stages).where(eq(stages.id, t.stage));
    const sobra = await db.select().from(stages).where(eq(stages.id, t.stage));
    expect(sobra).toHaveLength(0);
    await db.delete(workspaces).where(eq(workspaces.id, t.ws));
  });

  it('contact → CASCADE no deal', async () => {
    const t = await seedTenant(`ct${randomUUID().slice(0, 4)}`);
    const db = getDb();
    const [d] = await db.insert(deals).values(dealValues(t)).returning({ id: deals.id });
    if (!d) throw new Error('seed');
    await db.delete(contacts).where(eq(contacts.id, t.contact));
    expect(await db.select().from(deals).where(eq(deals.id, d.id))).toHaveLength(0);
    await db.delete(workspaces).where(eq(workspaces.id, t.ws));
  });

  it('pipeline → CASCADE em stages e deals', async () => {
    const t = await seedTenant(`pl${randomUUID().slice(0, 4)}`);
    const db = getDb();
    const [d] = await db.insert(deals).values(dealValues(t)).returning({ id: deals.id });
    if (!d) throw new Error('seed');
    await db.delete(pipelines).where(eq(pipelines.id, t.pipeline));
    expect(await db.select().from(deals).where(eq(deals.id, d.id))).toHaveLength(0);
    expect(await db.select().from(stages).where(eq(stages.id, t.stage))).toHaveLength(0);
    await db.delete(workspaces).where(eq(workspaces.id, t.ws));
  });
});

describe('pré-voo da migração', () => {
  it('aborta com contagem por coluna quando há referência cruzada (e não altera nada)', async () => {
    const preflight = /DO \$preflight\$[\s\S]*?END \$preflight\$;/.exec(migration)?.[0];
    expect(preflight).toBeDefined();
    if (!preflight) return;

    const db = getDb();
    const rollback = new Error('rollback proposital');
    let erro: unknown;
    try {
      await db.transaction(async (tx) => {
        // Simula dado legado: sem a FK composta, o deal cruzado entra.
        await tx.execute(sql`alter table deals drop constraint deals_workspace_contact_fk`);
        await tx.insert(deals).values(dealValues(A, { contactId: B.contact }));
        await tx.execute(sql.raw(preflight));
        throw rollback; // não deveria chegar aqui
      });
    } catch (e) {
      erro = e;
    }
    expect(erro).not.toBe(rollback);
    const pg = causaPg(erro);
    expect(pg.code).toBe('P0001');
    expect(pg.message).toMatch(/^F70-S12: 1 referência\(s\) cruzada\(s\)/);
    expect(pg.detail).toContain('deals.contact_id=1');
    expect(pg.detail).toContain('deals.stage_id=0');

    // A transação voltou: FK composta de pé, nenhum deal cruzado ficou.
    const [c] = await db.execute<{ n: number }>(
      sql`select count(*)::int as n from pg_constraint where conname = 'deals_workspace_contact_fk'`,
    );
    expect(c?.n).toBe(1);
    expect(await db.select().from(deals).where(eq(deals.contactId, B.contact))).toHaveLength(0);
  });

  it('passa limpo no estado atual (sem referência cruzada)', async () => {
    const preflight = /DO \$preflight\$[\s\S]*?END \$preflight\$;/.exec(migration)?.[0];
    if (!preflight) throw new Error('pré-voo ausente');
    await expect(getDb().execute(sql.raw(preflight))).resolves.toBeDefined();
  });
});
