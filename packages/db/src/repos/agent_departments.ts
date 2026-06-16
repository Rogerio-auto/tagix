/**
 * Repo de roteamento agente↔departamento (F34-S01).
 *
 * Vínculo N:N `agent_departments`. Todas as queries rodam DENTRO de uma transação
 * RLS-escopada (`tx` de `withWorkspace`) e recebem o `DbTx` por parâmetro — nunca
 * abrem o próprio escopo. Isso mantém o isolamento por workspace consistente com o
 * resto do DAL e garante que `setAgentDepartments` seja atômico (replace-all numa
 * só transação).
 *
 * Consumido por S02 (config do editor de agente), S03 (resolução do agente por
 * departamento) e S05 (authz de transferência IA→IA).
 */
import { and, eq } from 'drizzle-orm';
import type { DbTx } from '../client';
import { agentDepartments } from '../schema';

export type AgentDepartment = typeof agentDepartments.$inferSelect;

/** Item de associação (departamento + flag de entrada) usado na escrita replace-all. */
export interface AgentDepartmentItem {
  departmentId: string;
  isDefault: boolean;
}

/** Departamento associado a um agente, com a flag de entrada. */
export interface DepartmentLink {
  departmentId: string;
  isDefault: boolean;
}

/** Agente associado a um departamento, com a flag de entrada. */
export interface AgentLink {
  agentId: string;
  isDefault: boolean;
}

export const agentDepartmentsRepo = {
  /** Departamentos que o agente atende (+ flag de entrada por dept). */
  async listDepartmentsForAgent(tx: DbTx, agentId: string): Promise<DepartmentLink[]> {
    return tx
      .select({ departmentId: agentDepartments.departmentId, isDefault: agentDepartments.isDefault })
      .from(agentDepartments)
      .where(eq(agentDepartments.agentId, agentId));
  },

  /** Agentes que atendem o departamento (+ flag de entrada). */
  async listAgentsForDepartment(tx: DbTx, departmentId: string): Promise<AgentLink[]> {
    return tx
      .select({ agentId: agentDepartments.agentId, isDefault: agentDepartments.isDefault })
      .from(agentDepartments)
      .where(eq(agentDepartments.departmentId, departmentId));
  },

  /** Agente de entrada do departamento (`is_default`), ou `null` se nenhum. */
  async getDefaultAgentForDepartment(tx: DbTx, departmentId: string): Promise<string | null> {
    const [row] = await tx
      .select({ agentId: agentDepartments.agentId })
      .from(agentDepartments)
      .where(
        and(
          eq(agentDepartments.departmentId, departmentId),
          eq(agentDepartments.isDefault, true),
        ),
      )
      .limit(1);
    return row?.agentId ?? null;
  },

  /**
   * Substitui (replace-all) o conjunto de departamentos de um agente, atômico na
   * transação dada: apaga os vínculos atuais do agente e insere os novos. Garante
   * ≤ 1 default por departamento — se este agente vira default de um dept, qualquer
   * default anterior daquele dept (de outro agente) é rebaixado na mesma transação,
   * de forma que o índice parcial único nunca conflite.
   *
   * `workspaceId` denormaliza o vínculo (casa com agents/departments). Idempotente:
   * chamar de novo com os mesmos itens resulta no mesmo estado.
   */
  async setAgentDepartments(
    tx: DbTx,
    workspaceId: string,
    agentId: string,
    items: AgentDepartmentItem[],
  ): Promise<void> {
    // Replace-all: remove os vínculos atuais do agente.
    await tx.delete(agentDepartments).where(eq(agentDepartments.agentId, agentId));

    if (items.length === 0) return;

    // Para cada dept onde ESTE agente será o default, rebaixa o default anterior
    // (de outro agente) — evita colidir com o índice parcial único na inserção.
    for (const item of items) {
      if (!item.isDefault) continue;
      await tx
        .update(agentDepartments)
        .set({ isDefault: false })
        .where(
          and(
            eq(agentDepartments.departmentId, item.departmentId),
            eq(agentDepartments.isDefault, true),
          ),
        );
    }

    await tx.insert(agentDepartments).values(
      items.map((item) => ({
        agentId,
        departmentId: item.departmentId,
        workspaceId,
        isDefault: item.isDefault,
      })),
    );
  },

  /**
   * `true` se os dois agentes compartilham ao menos um departamento. Usado pela
   * authz de transferência IA→IA (S05): um agente só transfere para pares do(s)
   * seu(s) departamento(s).
   */
  async areAgentsInSameDepartment(
    tx: DbTx,
    agentIdA: string,
    agentIdB: string,
  ): Promise<boolean> {
    if (agentIdA === agentIdB) return true;
    const deptsA = await tx
      .select({ departmentId: agentDepartments.departmentId })
      .from(agentDepartments)
      .where(eq(agentDepartments.agentId, agentIdA));
    if (deptsA.length === 0) return false;
    const setA = new Set(deptsA.map((d) => d.departmentId));
    const deptsB = await tx
      .select({ departmentId: agentDepartments.departmentId })
      .from(agentDepartments)
      .where(eq(agentDepartments.agentId, agentIdB));
    return deptsB.some((d) => setA.has(d.departmentId));
  },
};
