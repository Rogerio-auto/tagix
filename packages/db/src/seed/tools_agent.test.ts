/**
 * F70-S10 — catálogo global das tools de agente.
 *
 * 1) Contrato (puro): toda tool semeada tem executor — classe `Tool` no runtime Python
 *    com a mesma `key`/categoria e, se `workflow`, handler registrado no endpoint interno
 *    da API. Nenhuma tool sem handler entra no catálogo.
 * 2) Divergência TS ↔ migration: a 0084 é exatamente o SQL gerado de `AGENT_TOOLS`.
 * 3) Integração (Postgres dev): o seed é idempotente (1 linha global por key).
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { and, inArray, isNull } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { closeDb, getDb } from '../client';
import { tools } from '../schema';
import { AGENT_TOOLS, renderAgentToolsInsertSql, seedAgentTools } from './tools_agent';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../../..');
const runtimeToolsDir = path.join(repoRoot, 'apps/agent-runtime/app/tools');

/** `key` → `category` de toda classe `Tool` declarada no runtime Python. */
function runtimeTools(): Map<string, string> {
  const out = new Map<string, string>();
  for (const sub of ['workflow', 'database', 'calendar']) {
    const dir = path.join(runtimeToolsDir, sub);
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.py'))) {
      const src = readFileSync(path.join(dir, file), 'utf8');
      const key = /^\s{4}key = "([a-z_]+)"$/m.exec(src)?.[1];
      if (key === undefined) continue;
      // Tools de DB herdam `category = "database"` de `DatabaseTool`.
      const category = /^\s{4}category = "([a-z]+)"$/m.exec(src)?.[1] ?? 'database';
      out.set(key, category);
    }
  }
  return out;
}

/** `toolKey`s com handler no endpoint interno `POST /internal/tools/:key` da API. */
function apiHandlerKeys(): Set<string> {
  const dir = path.join(repoRoot, 'apps/api/src/internal/tools');
  const keys = new Set<string>();
  for (const file of ['workflow-handlers.ts', 'calendar-handlers.ts', 'registry.ts']) {
    const src = readFileSync(path.join(dir, file), 'utf8');
    for (const m of src.matchAll(/\.register\('([a-z_]+)'/g)) {
      if (m[1] !== undefined) keys.add(m[1]);
    }
  }
  return keys;
}

describe('catálogo de tools de agente — contrato', () => {
  it('keys únicas e spec OpenAI com o nome da própria tool', () => {
    const keys = AGENT_TOOLS.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const t of AGENT_TOOLS) {
      expect(t.schema).toMatchObject({ type: 'function', function: { name: t.key } });
    }
  });

  it('toda tool semeada existe no runtime com a mesma categoria', () => {
    const runtime = runtimeTools();
    for (const t of AGENT_TOOLS) {
      expect(runtime.get(t.key), t.key).toBe(t.category);
    }
  });

  it('toda tool de workflow tem handler no endpoint interno da API', () => {
    const handlers = apiHandlerKeys();
    for (const t of AGENT_TOOLS.filter((x) => x.category === 'workflow')) {
      expect(handlers.has(t.key), t.key).toBe(true);
    }
  });

  it('tools database carregam ACL de coluna com tabela e sem escrita', () => {
    for (const t of AGENT_TOOLS.filter((x) => x.category === 'database')) {
      expect(typeof t.handlerConfig['table']).toBe('string');
      expect(t.handlerConfig['allowed_columns']).toMatchObject({ write: [] });
    }
  });

  it('a migration 0084 é exatamente o SQL gerado do catálogo', () => {
    const sql = readFileSync(
      path.resolve(here, '../../drizzle/0084_f70_agent_tools_catalog.sql'),
      'utf8',
    );
    expect(sql).toContain(renderAgentToolsInsertSql());
    expect(sql.match(/INSERT INTO "tools"/g)).toHaveLength(AGENT_TOOLS.length);
  });
});

describe('catálogo de tools de agente — seed no banco (dev)', () => {
  afterAll(async () => {
    await closeDb();
  });

  it('é idempotente: 2 rodadas deixam 1 linha global ativa por key', async () => {
    const db = getDb();
    await seedAgentTools(db);
    await seedAgentTools(db);

    const keys = AGENT_TOOLS.map((t) => t.key);
    const rows = await db
      .select({
        key: tools.key,
        category: tools.category,
        handlerConfig: tools.handlerConfig,
        isGlobal: tools.isGlobal,
        isActive: tools.isActive,
      })
      .from(tools)
      .where(and(inArray(tools.key, keys), isNull(tools.workspaceId)));

    expect(rows.map((r) => r.key).sort()).toEqual([...keys].sort());
    for (const t of AGENT_TOOLS) {
      const row = rows.find((r) => r.key === t.key);
      expect(row).toMatchObject({
        category: t.category,
        handlerConfig: t.handlerConfig,
        isGlobal: true,
        isActive: true,
      });
    }
    // 2 rodadas x 11 tools em série contra o Postgres dev compartilhado: folga sob carga.
  }, 30_000);
});
