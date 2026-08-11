import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, getDb } from './client';
import { channels, workspaces } from './schema';

let workspaceA = '';
let workspaceB = '';
let activeA = '';
let activeB = '';
let sharedWaba = '';
let otherWaba = '';

beforeAll(async () => {
  const db = getDb();
  const suffix = randomUUID().slice(0, 8);
  sharedWaba = `resolver-shared-${suffix}`;
  otherWaba = `resolver-other-${suffix}`;

  const [a] = await db
    .insert(workspaces)
    .values({ name: `Resolver A ${suffix}`, slug: `resolver-a-${suffix}` })
    .returning();
  const [b] = await db
    .insert(workspaces)
    .values({ name: `Resolver B ${suffix}`, slug: `resolver-b-${suffix}` })
    .returning();
  if (!a || !b) throw new Error('Falha ao criar workspaces do resolver.');
  workspaceA = a.id;
  workspaceB = b.id;

  const inserted = await db
    .insert(channels)
    .values([
      {
        workspaceId: workspaceA,
        provider: 'meta_whatsapp',
        name: `Ativo A ${suffix}`,
        phoneNumberId: `resolver-active-a-${suffix}`,
        wabaId: sharedWaba,
        isActive: true,
      },
      {
        workspaceId: workspaceB,
        provider: 'meta_whatsapp',
        name: `Ativo B ${suffix}`,
        phoneNumberId: `resolver-active-b-${suffix}`,
        wabaId: sharedWaba,
        isActive: true,
      },
      {
        workspaceId: workspaceA,
        provider: 'meta_whatsapp',
        name: `Inativo ${suffix}`,
        phoneNumberId: `resolver-inactive-${suffix}`,
        wabaId: sharedWaba,
        isActive: false,
      },
      {
        workspaceId: workspaceB,
        provider: 'meta_whatsapp',
        name: `Outra WABA ${suffix}`,
        phoneNumberId: `resolver-other-${suffix}`,
        wabaId: otherWaba,
        isActive: true,
      },
    ])
    .returning({ id: channels.id, isActive: channels.isActive, wabaId: channels.wabaId });
  const activeShared = inserted.filter((row) => row.isActive && row.wabaId === sharedWaba);
  if (!activeShared[0] || !activeShared[1]) throw new Error('Falha ao criar canais do resolver.');
  activeA = activeShared[0].id;
  activeB = activeShared[1].id;
});

afterAll(async () => {
  const db = getDb();
  if (workspaceA) await db.delete(workspaces).where(eq(workspaces.id, workspaceA));
  if (workspaceB) await db.delete(workspaces).where(eq(workspaces.id, workspaceB));
  await closeDb();
});

describe('resolve_meta_template_channels', () => {
  it('hm_app_login não enumera FORCE RLS, mas o resolver retorna só os canais elegíveis', async () => {
    const db = getDb();
    const result = await db.transaction(async (tx) => {
      await tx.execute(sql`set local role hm_app_login`);
      const direct = await tx.execute<{ id: string }>(sql`
        SELECT id FROM public.channels WHERE waba_id = ${sharedWaba}
      `);
      const resolved = await tx.execute<{ workspaceId: string; channelId: string }>(sql`
        SELECT workspace_id AS "workspaceId", channel_id AS "channelId"
        FROM public.resolve_meta_template_channels(${sharedWaba})
        ORDER BY channel_id
      `);
      const unrelated = await tx.execute<{ channelId: string }>(sql`
        SELECT channel_id AS "channelId"
        FROM public.resolve_meta_template_channels(${`missing-${otherWaba}`})
      `);
      return {
        direct: Array.from(direct),
        resolved: Array.from(resolved),
        unrelated: Array.from(unrelated),
      };
    });

    expect(result.direct).toEqual([]);
    expect(result.resolved.map((row) => row.channelId).sort()).toEqual([activeA, activeB].sort());
    expect(result.resolved.map((row) => row.workspaceId).sort()).toEqual(
      [workspaceA, workspaceB].sort(),
    );
    expect(result.unrelated).toEqual([]);
  });

  it('é SECURITY DEFINER, fixa search_path e não concede EXECUTE a PUBLIC', async () => {
    const db = getDb();
    const [definition] = Array.from(
      await db.execute<{
        securityDefiner: boolean;
        config: string[] | null;
        publicCanExecute: boolean;
        appCanExecute: boolean;
      }>(sql`
        SELECT
          p.prosecdef AS "securityDefiner",
          p.proconfig AS config,
          EXISTS (
            SELECT 1
            FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) AS privilege
            WHERE privilege.grantee = 0
              AND privilege.privilege_type = 'EXECUTE'
          ) AS "publicCanExecute",
          has_function_privilege('hm_app', p.oid, 'EXECUTE') AS "appCanExecute"
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname = 'resolve_meta_template_channels'
          AND pg_get_function_identity_arguments(p.oid) = 'p_waba_id text'
      `),
    );
    expect(definition).toBeTruthy();
    expect(definition?.securityDefiner).toBe(true);
    expect(definition?.config).toContain('search_path=pg_catalog');
    expect(definition?.publicCanExecute).toBe(false);
    expect(definition?.appCanExecute).toBe(true);
  });
});
