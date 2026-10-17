/**
 * F73-S10 — oferta de escritas na montagem do turno, contra o Postgres de dev.
 *
 * `copilotToolDescriptorsFor` carrega o contexto de oferta (papéis dos outros membros ativos)
 * sob o `tx` RLS: uma `propose_*` que só um gestor executa aparece ao AGENT quando há gestor
 * ativo (o motor grava `blocked` com "Pedir aprovação"); sem aprovador possível, não aparece.
 * Executor FAKE registrado só aqui (ainda não há executores reais no registro).
 */
import { randomUUID } from 'node:crypto';
import { and, eq, ne } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { closeDb, getDb, schema, withWorkspace } from '@hm/db';
import type { Role } from '@hm/shared';
import { copilotToolDescriptorsFor } from '../../../internal/copilot';
import { defineCopilotTool } from '../../../internal/copilot/core/registry';
import { resolveCopilotPrincipal } from '../identity/principal';
import { seedCopilotWorkspace, type SeededWorkspace } from '../identity/test-fixtures';
import { makeProposeTool } from '../proposals/propose';
import { FakeStore, fakeCampaignPauseExecutor } from '../proposals/test-fixtures';
import { loadTurnInputs } from './assemble';

const tools = [
  defineCopilotTool({
    key: 'list_deals',
    capability: 'query',
    area: 'pipeline',
    description: 'Lista negócios.',
    args: z.object({}).strict(),
    requires: ['pipeline.view'],
    taintsTurn: false,
    handler: async () => ({ ok: true, decision: 'executed' as const, model_view: 'ok' }),
  }),
  // `campaign.pause`: só gestores executam (MANAGERS); AGENT só pode pedir aprovação.
  makeProposeTool(fakeCampaignPauseExecutor(new FakeStore()), {
    description: 'Propõe pausar campanhas.',
  }),
];

const PROPOSE_KEY = tools[1]?.key ?? '';

let seeded: SeededWorkspace;

beforeAll(async () => {
  seeded = await seedCopilotWorkspace({ label: 'Offer' });
});

afterAll(async () => {
  await seeded?.cleanup();
  await closeDb();
});

async function keysFor(role: Role): Promise<string[]> {
  return withWorkspace(seeded.workspaceId, async (tx) => {
    const principal = await resolveCopilotPrincipal(tx, {
      workspaceId: seeded.workspaceId,
      memberId: seeded.members[role].id,
    });
    if (!principal) throw new Error(`principal ${role}`);
    const descriptors = await copilotToolDescriptorsFor(tx, principal, tools);
    return descriptors.map((d) => d.key);
  });
}

async function assembledKeysFor(role: Role): Promise<string[]> {
  return withWorkspace(seeded.workspaceId, async (tx) => {
    const principal = await resolveCopilotPrincipal(tx, {
      workspaceId: seeded.workspaceId,
      memberId: seeded.members[role].id,
    });
    if (!principal) throw new Error(`principal ${role}`);
    const inputs = await loadTurnInputs(tx, {
      principal,
      sessionId: randomUUID(),
      pageContext: undefined,
      tools,
    });
    return inputs.tools.map((d) => d.key);
  });
}

describe('oferta de propose_* a quem só pode pedir aprovação (F73-S10 × S05)', () => {
  it('a ferramenta de teste é uma escrita do motor', () => {
    expect(PROPOSE_KEY.startsWith('propose_')).toBe(true);
  });

  it('há gestor ativo → o AGENT recebe a propose_* (descritor e montagem do turno)', async () => {
    expect(await keysFor('AGENT')).toEqual(['list_deals', PROPOSE_KEY]);
    expect(await assembledKeysFor('AGENT')).toEqual(['list_deals', PROPOSE_KEY]);
    // Quem executa recebe de qualquer forma.
    expect(await keysFor('OWNER')).toContain(PROPOSE_KEY);
  });

  it('sem aprovador possível (só o AGENT e o READONLY ativos) → o AGENT NÃO recebe', async () => {
    const m = schema.members;
    const managers = (['OWNER', 'ADMIN', 'SUPERVISOR'] as const).map((r) => seeded.members[r].id);
    for (const id of managers) {
      await getDb().update(m).set({ status: 'inactive' }).where(eq(m.id, id));
    }
    try {
      expect(await keysFor('AGENT')).toEqual(['list_deals']);
      expect(await assembledKeysFor('AGENT')).toEqual(['list_deals']);
    } finally {
      await getDb()
        .update(m)
        .set({ status: 'active' })
        .where(and(eq(m.workspaceId, seeded.workspaceId), ne(m.id, seeded.members.AGENT.id)));
    }
  });
});
