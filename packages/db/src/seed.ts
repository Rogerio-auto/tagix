/* Seed idempotente: 4 planos + workspace dev + member OWNER + subscription trial. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { config } from 'dotenv';
import { and, eq } from 'drizzle-orm';
import { createClient } from './client';
import { members, plans, subscriptions, workspaces } from './schema';
import { seedAgentTemplates } from './seed/agent_templates';
import { seedCalendarTools } from './seed/calendar_tools';
import { seedLlmModels } from './seed/llm_models';
import { seedNicheAgentTemplates } from './seed/agent_templates_niche';
import { instantiatePipelineTemplate } from './seed/pipeline_templates';

const here = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(here, '../../../.env') });

const { db, sql } = createClient(process.env['DATABASE_URL'], 1);

const PLAN_SEED = [
  { key: 'free', name: 'Free', position: 0, priceMonthlyCents: 0 },
  { key: 'starter', name: 'Starter', position: 1, priceMonthlyCents: 9900 },
  { key: 'pro', name: 'Pro', position: 2, priceMonthlyCents: 29900 },
  { key: 'business', name: 'Business', position: 3, priceMonthlyCents: 99900 },
];

await db.insert(plans).values(PLAN_SEED).onConflictDoNothing({ target: plans.key });

const [freePlan] = await db.select().from(plans).where(eq(plans.key, 'free'));
if (!freePlan) throw new Error('Plano free não encontrado após seed.');

let [workspace] = await db.select().from(workspaces).where(eq(workspaces.slug, 'dev'));
if (!workspace) {
  [workspace] = await db
    .insert(workspaces)
    .values({ name: 'Dev Workspace', slug: 'dev', planId: freePlan.id, subscriptionStatus: 'trial' })
    .returning();
}
if (!workspace) throw new Error('Falha ao criar workspace dev.');

const ownerEmail = 'owner@dev.local';
const [existingOwner] = await db
  .select()
  .from(members)
  .where(and(eq(members.workspaceId, workspace.id), eq(members.email, ownerEmail)));
if (!existingOwner) {
  await db.insert(members).values({
    workspaceId: workspace.id,
    authUserId: randomUUID(),
    email: ownerEmail,
    name: 'Dev Owner',
    role: 'OWNER',
    status: 'active',
    isPlatformAdmin: true,
    joinedAt: new Date(),
  });
}

const [existingSub] = await db
  .select()
  .from(subscriptions)
  .where(eq(subscriptions.workspaceId, workspace.id));
if (!existingSub) {
  await db.insert(subscriptions).values({
    workspaceId: workspace.id,
    planId: freePlan.id,
    status: 'trial',
    billingCycle: 'monthly',
  });
}

// Catálogos globais de agentes IA (F2): templates de wizard + whitelist de modelos LLM.
await seedAgentTemplates(db);
await seedNicheAgentTemplates(db);
await seedLlmModels(db);
await seedCalendarTools(db);
// Pipelines de nicho no workspace dev (idempotente).
await instantiatePipelineTemplate(db, workspace.id, 'real_estate');
await instantiatePipelineTemplate(db, workspace.id, 'clinic');

await sql.end();
console.log(`[db] seed ok — workspace=${workspace.slug} owner=${ownerEmail} planos=${PLAN_SEED.length}`);
