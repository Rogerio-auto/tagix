/**
 * Semeadura dos testes de integração do Copiloto (F73-S03) contra o Postgres de dev.
 *
 * Só para testes: cria um workspace isolado (sufixo aleatório) com um membro por papel e
 * sessão do `MockAuthProvider` (cookie), e turnos vivos com grant. A limpeza apaga o
 * workspace (tudo do Copiloto cai em cascata).
 */
import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { copilotSessionsRepo, copilotTurnsRepo, getDb, schema, withWorkspace } from '@hm/db';
import { ROLES, type Role } from '@hm/shared';
import { SESSION_COOKIE } from '../../../auth/session';
import { generateGrantNonce, mintGrant } from './grant';

export interface SeededMember {
  readonly id: string;
  readonly authUserId: string;
  readonly email: string;
  readonly role: Role;
  readonly cookie: string;
}

export interface SeededWorkspace {
  readonly workspaceId: string;
  readonly members: Readonly<Record<Role, SeededMember>>;
  cleanup(): Promise<void>;
}

/** Cookie de sessão do `MockAuthProvider` (o mesmo formato dos demais testes da API). */
export function sessionCookie(authUserId: string, email: string): string {
  const token = Buffer.from(JSON.stringify({ authUserId, email, iat: Date.now() })).toString(
    'base64url',
  );
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}`;
}

export async function seedCopilotWorkspace(
  options: { readonly subscriptionStatus?: string; readonly label?: string } = {},
): Promise<SeededWorkspace> {
  const db = getDb();
  const sfx = randomUUID().slice(0, 8);
  const [ws] = await db
    .insert(schema.workspaces)
    .values({
      name: `${options.label ?? 'Copilot'} ${sfx}`,
      slug: `copilot-${sfx}`,
      subscriptionStatus: options.subscriptionStatus ?? 'active',
    })
    .returning();
  if (!ws) throw new Error('seed: workspace');
  const members = {} as Record<Role, SeededMember>;
  for (const role of ROLES) {
    const authUserId = randomUUID();
    const email = `copilot-${role.toLowerCase()}-${sfx}@t.local`;
    const [m] = await db
      .insert(schema.members)
      .values({
        workspaceId: ws.id,
        authUserId,
        email,
        name: `${role} ${sfx}`,
        role,
        status: 'active',
      })
      .returning();
    if (!m) throw new Error(`seed: membro ${role}`);
    members[role] = { id: m.id, authUserId, email, role, cookie: sessionCookie(authUserId, email) };
  }
  return {
    workspaceId: ws.id,
    members,
    async cleanup() {
      await getDb().delete(schema.workspaces).where(eq(schema.workspaces.id, ws.id));
    },
  };
}

export interface SeededTurn {
  readonly turnId: string;
  readonly sessionId: string;
  readonly nonce: string;
  /** Grant válido para o turno (assinado com `secret`). */
  readonly grant: string;
}

/** Cria sessão + turno `running` do membro e assina o grant. */
export async function seedCopilotTurn(input: {
  readonly workspaceId: string;
  readonly memberId: string;
  readonly secret: Buffer;
  readonly maxToolCalls?: number;
  readonly expiresInSeconds?: number;
}): Promise<SeededTurn> {
  const nonce = generateGrantNonce();
  const { turnId, sessionId } = await withWorkspace(input.workspaceId, async (tx) => {
    const session = await copilotSessionsRepo.create(tx, {
      workspaceId: input.workspaceId,
      memberId: input.memberId,
      origin: 'bubble',
    });
    const { turn } = await copilotTurnsRepo.createRunning(tx, {
      workspaceId: input.workspaceId,
      memberId: input.memberId,
      sessionId: session.id,
      grantNonce: nonce,
      expiresAt: new Date(Date.now() + (input.expiresInSeconds ?? 120) * 1000),
      maxToolCalls: input.maxToolCalls ?? 16,
    });
    return { turnId: turn.id, sessionId: session.id };
  });
  const grant = mintGrant(
    { turnId, workspaceId: input.workspaceId, memberId: input.memberId, nonce },
    { secret: input.secret },
  );
  return { turnId, sessionId, nonce, grant };
}
