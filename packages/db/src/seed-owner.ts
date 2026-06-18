/**
 * Seed de PRODUÇÃO: provisiona o owner inicial + workspace real + catálogos globais.
 * Idempotente. Diferente de `seed.ts` (que cria o workspace 'dev' p/ login mock),
 * este cria o usuário REAL no Supabase Auth e linka um member OWNER por email.
 *
 * Env necessárias:
 *   DATABASE_URL, SUPABASE_URL, SUPABASE_SERVICE_KEY,
 *   OWNER_EMAIL, OWNER_PASSWORD, OWNER_NAME (opc),
 *   WORKSPACE_NAME (opc, default "Leadium"), WORKSPACE_SLUG (opc, default "leadium")
 *
 * Uso (no servidor):
 *   docker run --rm --network leadium_leadium_internal --env-file /opt/leadium/.env \
 *     -e DATABASE_URL=postgresql://USER:PASS@postgres:5432/DB \
 *     -e OWNER_EMAIL=... -e OWNER_PASSWORD=... -e OWNER_NAME='...' \
 *     leadium-api:latest pnpm --filter @hm/db seed:owner
 */
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { createClient } from './client';
import { members, plans, subscriptions, workspaces } from './schema';
import { seedAgentTemplates } from './seed/agent_templates';
import { seedCalendarTools } from './seed/calendar_tools';
import { seedLlmModels } from './seed/llm_models';
import { seedNicheAgentTemplates } from './seed/agent_templates_niche';
import { instantiatePipelineTemplate } from './seed/pipeline_templates';
import { seedHelpCenter } from './seeds/help';

function reqEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Env obrigatória ausente: ${name}`);
  return v;
}

const ownerEmail = reqEnv('OWNER_EMAIL').trim().toLowerCase();
const ownerPassword = reqEnv('OWNER_PASSWORD');
const ownerName = process.env['OWNER_NAME']?.trim() || 'Owner';
const wsName = process.env['WORKSPACE_NAME']?.trim() || 'Leadium';
const wsSlug = (process.env['WORKSPACE_SLUG']?.trim() || 'leadium').toLowerCase();

/** Cria o usuário no Supabase Auth (admin REST API). Idempotente. Retorna o id (ou null). */
async function ensureSupabaseUser(): Promise<string | null> {
  const url = reqEnv('SUPABASE_URL').replace(/\/$/, '');
  const serviceKey = reqEnv('SUPABASE_SERVICE_KEY');
  const res = await fetch(`${url}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email: ownerEmail, password: ownerPassword, email_confirm: true }),
  });
  if (res.ok) {
    const body = (await res.json()) as { id?: string };
    console.log(`[supabase] usuário criado: ${ownerEmail}`);
    return body.id ?? null;
  }
  const text = await res.text();
  if (res.status === 422 || /already.*registered|exists/i.test(text)) {
    console.log(`[supabase] usuário já existe: ${ownerEmail} (mantido)`);
    return null;
  }
  throw new Error(`[supabase] falha ao criar usuário (${res.status}): ${text}`);
}

const { db, sql } = createClient(reqEnv('DATABASE_URL'), 1);

// 1) Planos (catálogo) ------------------------------------------------------
const PLAN_SEED = [
  { key: 'free', name: 'Free', position: 0, priceMonthlyCents: 0 },
  { key: 'starter', name: 'Starter', position: 1, priceMonthlyCents: 9900 },
  { key: 'pro', name: 'Pro', position: 2, priceMonthlyCents: 29900 },
  { key: 'business', name: 'Business', position: 3, priceMonthlyCents: 99900 },
];
await db.insert(plans).values(PLAN_SEED).onConflictDoNothing({ target: plans.key });
const [freePlan] = await db.select().from(plans).where(eq(plans.key, 'free'));
if (!freePlan) throw new Error('Plano free não encontrado após seed.');

// 2) Usuário Supabase -------------------------------------------------------
const authUserId = (await ensureSupabaseUser()) ?? randomUUID();

// 3) Workspace --------------------------------------------------------------
let [workspace] = await db.select().from(workspaces).where(eq(workspaces.slug, wsSlug));
if (!workspace) {
  [workspace] = await db
    .insert(workspaces)
    .values({ name: wsName, slug: wsSlug, planId: freePlan.id, subscriptionStatus: 'trial' })
    .returning();
}
if (!workspace) throw new Error('Falha ao criar/obter workspace.');

// 4) Member OWNER (linkado por email; platform admin) -----------------------
const [existing] = await db
  .select()
  .from(members)
  .where(and(eq(members.workspaceId, workspace.id), eq(members.email, ownerEmail)));
if (!existing) {
  await db.insert(members).values({
    workspaceId: workspace.id,
    authUserId,
    email: ownerEmail,
    name: ownerName,
    role: 'OWNER',
    status: 'active',
    isPlatformAdmin: true,
    joinedAt: new Date(),
  });
  console.log(`[db] member OWNER criado: ${ownerEmail}`);
} else {
  console.log(`[db] member já existe: ${ownerEmail} (mantido)`);
}

// 5) Subscription trial -----------------------------------------------------
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

// 6) Catálogos globais (IA, calendário, central de ajuda) + pipelines de nicho
await seedAgentTemplates(db);
await seedNicheAgentTemplates(db);
await seedLlmModels(db);
await seedCalendarTools(db);
await instantiatePipelineTemplate(db, workspace.id, 'real_estate');
await instantiatePipelineTemplate(db, workspace.id, 'clinic');
await seedHelpCenter(db);

await sql.end();
console.log(`[db] seed-owner ok — workspace=${wsSlug} owner=${ownerEmail} (OWNER, platform admin)`);
