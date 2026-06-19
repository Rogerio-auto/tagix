/**
 * Integração do instanciador de Niche Blueprint (F43-S02 / ONBOARDING.md §2.2).
 *
 * Roda contra o Postgres dev. Cria um workspace + um agent_template GLOBAL,
 * monta um blueprint mínimo (1 de cada recurso) e aplica 2x sob a MESMA transação
 * scoped (`withWorkspace`). Asserta IDEMPOTÊNCIA: a contagem de cada recurso é igual
 * após a 2ª aplicação (nada duplica), o pipeline mantém o mesmo id, e
 * `workspaces.industry` foi gravado.
 */
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, getDb } from '../../client';
import { withWorkspace } from '../../rls';
import {
  agentTemplates,
  agents,
  conversionTypes,
  departments,
  flows,
  pipelines,
  quickReplies,
  stages,
  tags,
  workspaces,
} from '../../schema';
import { instantiateNicheBlueprint } from './instantiate';
import type { NicheBlueprint } from './types';

let ws = '';
let templateKey = '';

const sfx = randomUUID().slice(0, 8);

const buildBlueprint = (): NicheBlueprint => ({
  key: `test_niche_${sfx}`,
  name: 'Nicho de Teste',
  industry: `test_industry_${sfx}`,
  pipeline: {
    name: `Funil Teste ${sfx}`,
    description: 'Pipeline mínimo de teste.',
    customFields: [
      { key: 'budget', label: 'Orçamento', type: 'currency', required: false, position: 0 },
    ],
    stages: [
      { name: 'Novo', color: '#1FFF13', position: 0, probability: 10 },
      { name: 'Ganho', color: '#13FF6B', position: 1, isWon: true, probability: 100 },
    ],
  },
  agents: [{ templateKey, overrides: { name: `Agente Teste ${sfx}` } }],
  tags: [{ name: `tag-${sfx}`, color: '#13C7FF' }],
  conversionTypes: [{ key: `conv_${sfx}`, label: 'Venda', valueRequired: true }],
  departments: [{ name: `Vendas ${sfx}`, description: 'Time comercial.' }],
  quickReplies: [{ title: `Saudação ${sfx}`, body: 'Olá! Como posso ajudar?', departmentName: `Vendas ${sfx}` }],
  flows: [
    { name: `Boas-vindas ${sfx}`, description: 'Flow de boas-vindas.', status: 'draft', triggerType: 'manual' },
  ],
});

beforeAll(async () => {
  const db = getDb(); // owner → bypassa RLS (setup)
  const [w] = await db
    .insert(workspaces)
    .values({ name: `Blueprint ${sfx}`, slug: `blueprint-${sfx}` })
    .returning();
  if (!w) throw new Error('Falha ao criar workspace de teste.');
  ws = w.id;

  templateKey = `test_template_${sfx}`;
  const [t] = await db
    .insert(agentTemplates)
    .values({
      workspaceId: null,
      key: templateKey,
      name: 'Template Teste',
      category: 'Teste',
      description: 'Template global de teste.',
      promptTemplate: 'Você é um agente de teste.',
      defaultModel: 'openai/gpt-4o-mini',
      defaultModelParams: { temperature: 0.4 },
      defaultTools: ['query_contact'],
      isGlobal: true,
    })
    .returning();
  if (!t) throw new Error('Falha ao criar agent_template global de teste.');
});

afterAll(async () => {
  const db = getDb();
  if (ws) await db.delete(workspaces).where(eq(workspaces.id, ws));
  if (templateKey) await db.delete(agentTemplates).where(eq(agentTemplates.key, templateKey));
  await closeDb();
});

describe('instantiateNicheBlueprint — idempotência multi-recurso', () => {
  it('aplicar 2x não duplica nenhum recurso e grava workspaces.industry', async () => {
    const blueprint = buildBlueprint();

    const first = await withWorkspace(ws, (tx) => instantiateNicheBlueprint(tx, ws, blueprint));
    expect(first.pipelineId).toBeTruthy();
    expect(first.agentIds).toHaveLength(1);

    const second = await withWorkspace(ws, (tx) => instantiateNicheBlueprint(tx, ws, blueprint));
    // Pipeline e agente estáveis entre execuções.
    expect(second.pipelineId).toBe(first.pipelineId);
    expect(second.agentIds).toEqual(first.agentIds);

    // Contagens reais no banco após a 2ª aplicação == o que o blueprint declara.
    const count = async <T extends { id: unknown }>(
      rows: Promise<T[]>,
    ): Promise<number> => (await rows).length;

    const pipelineRows = await withWorkspace(ws, (tx) =>
      tx.select({ id: pipelines.id }).from(pipelines).where(eq(pipelines.workspaceId, ws)),
    );
    expect(pipelineRows).toHaveLength(1);

    const stageRows = await withWorkspace(ws, (tx) =>
      tx
        .select({ id: stages.id })
        .from(stages)
        .where(eq(stages.pipelineId, first.pipelineId)),
    );
    expect(stageRows).toHaveLength(blueprint.pipeline.stages.length);

    const agentCount = await count(
      withWorkspace(ws, (tx) =>
        tx
          .select({ id: agents.id })
          .from(agents)
          .where(and(eq(agents.workspaceId, ws), eq(agents.name, `Agente Teste ${sfx}`))),
      ),
    );
    expect(agentCount).toBe(1);

    const tagCount = await count(
      withWorkspace(ws, (tx) => tx.select({ id: tags.id }).from(tags).where(eq(tags.workspaceId, ws))),
    );
    expect(tagCount).toBe(blueprint.tags.length);

    const convCount = await count(
      withWorkspace(ws, (tx) =>
        tx.select({ id: conversionTypes.id }).from(conversionTypes).where(eq(conversionTypes.workspaceId, ws)),
      ),
    );
    expect(convCount).toBe(blueprint.conversionTypes.length);

    const deptRows = await withWorkspace(ws, (tx) =>
      tx
        .select({ id: departments.id })
        .from(departments)
        .where(eq(departments.workspaceId, ws)),
    );
    expect(deptRows).toHaveLength(blueprint.departments.length);

    const qrRows = await withWorkspace(ws, (tx) =>
      tx
        .select({ id: quickReplies.id, departmentId: quickReplies.departmentId })
        .from(quickReplies)
        .where(eq(quickReplies.workspaceId, ws)),
    );
    expect(qrRows).toHaveLength(blueprint.quickReplies.length);
    // Quick reply foi ligada ao departamento resolvido pelo nome.
    expect(qrRows[0]?.departmentId).toBe(deptRows[0]?.id);

    const flowCount = await count(
      withWorkspace(ws, (tx) => tx.select({ id: flows.id }).from(flows).where(eq(flows.workspaceId, ws))),
    );
    expect(flowCount).toBe(blueprint.flows.length);

    // industry gravado no workspace.
    const [wsRow] = await withWorkspace(ws, (tx) =>
      tx.select({ industry: workspaces.industry }).from(workspaces).where(eq(workspaces.id, ws)),
    );
    expect(wsRow?.industry).toBe(blueprint.industry);

    // createdCounts determinístico entre execuções.
    expect(second.createdCounts).toEqual(first.createdCounts);
  });
});
