import { and, eq } from 'drizzle-orm';
import { getDb } from '../client';
import { members, workspaces } from '../schema';

// Repo de roteamento agente↔departamento (F34-S01).
export * from './agent_departments';

export const workspacesRepo = {
  async findById(id: string) {
    const [row] = await getDb().select().from(workspaces).where(eq(workspaces.id, id));
    return row ?? null;
  },
  async findBySlug(slug: string) {
    const [row] = await getDb().select().from(workspaces).where(eq(workspaces.slug, slug));
    return row ?? null;
  },
};

export const membersRepo = {
  async findByAuthUser(workspaceId: string, authUserId: string) {
    const [row] = await getDb()
      .select()
      .from(members)
      .where(and(eq(members.workspaceId, workspaceId), eq(members.authUserId, authUserId)));
    return row ?? null;
  },
  async findByEmail(email: string) {
    const [row] = await getDb().select().from(members).where(eq(members.email, email));
    return row ?? null;
  },
};
