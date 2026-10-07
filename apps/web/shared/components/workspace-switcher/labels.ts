import type { Role } from '@hm/shared';

/**
 * Rótulos PT-BR dos papéis (a API expõe o enum em maiúsculas). `AGENT` é a pessoa
 * que atende: "Atendente", igual a Membros/Convites — "Agente" no produto é o bot de
 * IA (glossário em docs/INDEX.md) e aparece ao lado, no item "Agentes" da navegação.
 */
export const ROLE_LABEL: Record<Role, string> = {
  OWNER: 'Proprietário',
  ADMIN: 'Administrador',
  SUPERVISOR: 'Supervisor',
  AGENT: 'Atendente',
  READONLY: 'Somente leitura',
};

/** Inicial da empresa para o "tile" (sem logo no contrato de `/api/me`). */
export function workspaceInitial(name: string): string {
  const first = name.trim().charAt(0);
  return first ? first.toUpperCase() : '?';
}
