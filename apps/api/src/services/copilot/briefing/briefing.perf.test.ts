/**
 * F73-S12 · latência do briefing (meta: p95 ≤ 300 ms com os índices atuais).
 *
 * Duas medições:
 *  - mundo pequeno (sempre): p95 da GERAÇÃO e da leitura do briefing já gravado;
 *  - mundo grande (`HM_BRIEFING_PERF=1`): 30 mil negócios abertos, 30 mil conversas e 60 mil
 *    mensagens semeados por SQL e apagados no fim; p95 por papel (OWNER e AGENT) e tempo de
 *    cada coletor, para registrar na nota do slot qual consulta domina.
 *
 * Os tempos vão para o stdout (`[briefing-perf] ...`) para a nota de execução. O teto é
 * generoso no mundo pequeno (não quebra em máquina carregada) e é o do DoD (300 ms) no grande.
 */
import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, getDb, schema, withWorkspace } from '@hm/db';
import type { Role } from '@hm/shared';
import { loadWorkspaceFormat } from '../../../internal/copilot/read-crm/common';
import { startRead } from '../../../internal/copilot/read-crm/limits';
import { resolveCopilotPrincipal } from '../identity/principal';
import {
  collectAutopilotPending,
  collectCampaignIssues,
  collectDealsIdle,
  collectEventsToday,
  collectLeadsWaiting,
  lazyTicket,
} from './candidates';
import { getOrCreateToday } from './generate';
import { BRIEFING_DATE, BRIEFING_NOW, seedBriefingWorld, type BriefingWorld } from './test-fixtures';

const BIG = process.env['HM_BRIEFING_PERF'] === '1';
const DAY = 86_400_000;

function percentile(samples: readonly number[], p: number): number {
  const sorted = [...samples].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)] ?? 0;
}

const fmt = (n: number): string => `${n.toFixed(1)} ms`;

let world: BriefingWorld;

beforeAll(async () => {
  world = await seedBriefingWorld({ label: 'BriefingPerf' });
}, 120_000);

afterAll(async () => {
  await world?.cleanup();
  await closeDb();
});

async function generateOnce(w: BriefingWorld, role: Role, dayOffset: number): Promise<number> {
  const now = new Date(BRIEFING_NOW.getTime() + dayOffset * DAY);
  const t0 = performance.now();
  await withWorkspace(w.workspaceId, async (tx) => {
    const principal = await resolveCopilotPrincipal(tx, {
      workspaceId: w.workspaceId,
      memberId: w.member(role),
      now,
    });
    if (!principal) throw new Error('principal');
    await getOrCreateToday(tx, principal, { now });
  });
  return performance.now() - t0;
}


describe('latência do briefing', () => {
  it('mundo pequeno: p95 da geração e da leitura ≤ 300 ms', async () => {
    const gen: number[] = [];
    await generateOnce(world, 'OWNER', 500); // aquecimento (plano, conexões, JIT do V8)
    for (let i = 0; i < 30; i++) gen.push(await generateOnce(world, 'OWNER', i + 1));
    const read: number[] = [];
    for (let i = 0; i < 30; i++) read.push(await generateOnce(world, 'OWNER', 1)); // já gravado
    const g95 = percentile(gen, 95);
    const r95 = percentile(read, 95);
    console.log(
      `[briefing-perf] pequeno · geração OWNER p50=${fmt(percentile(gen, 50))} p95=${fmt(g95)} · leitura p50=${fmt(percentile(read, 50))} p95=${fmt(r95)}`,
    );
    expect(g95).toBeLessThanOrEqual(300);
    expect(r95).toBeLessThanOrEqual(300);
  }, 120_000);

  it.runIf(BIG)(
    'mundo grande (30 mil negócios/conversas): p95 por papel e custo de cada coletor',
    async () => {
      const big = await seedBriefingWorld({ label: 'BriefingBig' });
      try {
        const N = 30_000;
        const db = getDb();
        const ws = big.workspaceId;
        const [channel] = await db
          .select({ id: schema.channels.id })
          .from(schema.channels)
          .where(eq(schema.channels.workspaceId, ws))
          .limit(1);
        const [contact] = await db
          .select({ id: schema.contacts.id })
          .from(schema.contacts)
          .where(eq(schema.contacts.workspaceId, ws))
          .limit(1);
        if (!channel || !contact) throw new Error('seed grande: base');
        const owners = [big.agentA, big.agentB, big.member('OWNER')];
        const sfx = randomUUID().slice(0, 8);
        const nowIso = BRIEFING_NOW.toISOString();
        // Conversas: 1/3 esperando resposta; atribuídas em rodízio.
        await db.execute(sql`
          insert into conversations (workspace_id, channel_id, contact_id, remote_id, status,
                                     last_message_from, last_message_at, assigned_to)
          select ${ws}::uuid, ${channel.id}::uuid, ${contact.id}::uuid, 'big-' || ${sfx} || '-' || g,
                 'open', case when g % 3 = 0 then 'contact' else 'member' end,
                 ${nowIso}::timestamptz - (g % 5000) * interval '1 minute',
                 (array[${owners[0]}, ${owners[1]}, ${owners[2]}]::uuid[])[1 + g % 3]
            from generate_series(1, ${N}) g`);
        await db.execute(sql`
          insert into messages (workspace_id, conversation_id, direction, sender_type, content,
                                provider_timestamp)
          select c.workspace_id, c.id, d.direction, d.sender, 'x',
                 ${nowIso}::timestamptz - (random() * 20) * interval '1 day'
            from conversations c
            cross join (values ('inbound','contact'), ('outbound','member')) as d(direction, sender)
           where c.workspace_id = ${ws}::uuid and c.remote_id like ${'big-' + sfx + '-%'}`);
        await db.execute(sql`
          insert into deals (workspace_id, pipeline_id, stage_id, contact_id, conversation_id, title,
                             value_cents, owner_id, created_at, updated_at)
          select ${ws}::uuid, ${big.pipelineId}::uuid,
                 (array[${big.stage.novo}, ${big.stage.orcamento}]::uuid[])[1 + g % 2],
                 ${contact.id}::uuid, c.id, 'D' || g, 100000 + (g % 50) * 10000,
                 (array[${owners[0]}, ${owners[1]}, ${owners[2]}]::uuid[])[1 + g % 3],
                 ${nowIso}::timestamptz - interval '60 days',
                 ${nowIso}::timestamptz - (g % 30) * interval '1 day'
            from (select id, row_number() over (order by id) as g from conversations
                   where workspace_id = ${ws}::uuid and remote_id like ${'big-' + sfx + '-%'}) c(id, g)`);
        await db.execute(sql`analyze deals`);
        await db.execute(sql`analyze conversations`);
        await db.execute(sql`analyze messages`);

        const lines: string[] = [];
        for (const role of ['OWNER', 'AGENT'] as const) {
          await generateOnce(big, role, 600);
          const gen: number[] = [];
          for (let i = 0; i < 15; i++) gen.push(await generateOnce(big, role, i + 1));
          const p95 = percentile(gen, 95);
          lines.push(`${role} geração p50=${fmt(percentile(gen, 50))} p95=${fmt(p95)}`);
          expect(p95).toBeLessThanOrEqual(300);
        }

        // Custo de cada coletor (OWNER e AGENT), uma passada com plano quente.
        for (const role of ['OWNER', 'AGENT'] as const) {
          await withWorkspace(ws, async (tx) => {
            const principal = await resolveCopilotPrincipal(tx, {
              workspaceId: ws,
              memberId: big.member(role),
              now: BRIEFING_NOW,
            });
            if (!principal) throw new Error('principal');
            const f = await loadWorkspaceFormat(tx, ws);
            const ctx = { principal, fmt: f, now: BRIEFING_NOW, forDate: BRIEFING_DATE };
            await startRead(tx);
            const ticket = lazyTicket(tx, ctx);
            const timed: [string, () => Promise<unknown>][] = [
              ['ticket', () => ticket()],
              ['deals_idle', () => collectDealsIdle(tx, ctx)],
              ['leads_waiting', () => collectLeadsWaiting(tx, ctx, ticket)],
              ['events_today', () => collectEventsToday(tx, ctx)],
              ['autopilot', () => collectAutopilotPending(tx, ctx)],
              ['campaign', () => collectCampaignIssues(tx, ctx, ticket)],
            ];
            const parts: string[] = [];
            for (const [name, run] of timed) {
              await run();
              const t0 = performance.now();
              await run();
              parts.push(`${name}=${fmt(performance.now() - t0)}`);
            }
            lines.push(`${role} coletores: ${parts.join(' · ')}`);
          });
        }
        console.log(`[briefing-perf] grande (${N} negócios/conversas) · ${lines.join(' | ')}`);
      } finally {
        await big.cleanup();
      }
    },
    600_000,
  );
});
