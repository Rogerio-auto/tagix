import { and, eq } from 'drizzle-orm';
import { getDb } from '../client';
import { members, workspaces } from '../schema';

// Repo de roteamento agente↔departamento (F34-S01).
export * from './agent_departments';
// Repo do Calendar 2.0 (F37-S01): provisionamento + acesso.
export * from './calendar';
// Central de Ajuda (F38-S01): catalogo global + feedback workspace-scoped.
export * from './help';
// Chat de Suporte (F38-S01): threads/mensagens (membro + plataforma).
export * from './support';
// Payments (F41-S02): ledger de eventos de pagamento (idempotente por provider+event).
export * from './payment-events';
// Onboarding (F43-S01): respostas rápidas + estado de first-run/tour.
export * from './quick-replies';
export * from './onboarding';

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
