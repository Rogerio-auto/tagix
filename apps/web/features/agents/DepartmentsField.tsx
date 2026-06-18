'use client';

import { Building2, DoorOpen } from 'lucide-react';
import { cn } from '@/shared/lib/cn';
import type { AgentDepartmentLink } from './types';
import { useWorkspaceDepartments } from './queries';

/**
 * Seletor de departamentos do agente (F34-S02) — usado no wizard de criação e na
 * ConfigTab do detalhe. É um campo de configuração VISÍVEL e NOMEADO (UX §2):
 * o owner escolhe quais departamentos o agente atende (N:N) e, por departamento
 * selecionado, se ele é o **agente de entrada** (`isDefault`).
 *
 * Regra ≤ 1 default por departamento: como cada departamento aparece no máximo 1×
 * no conjunto do agente, o `isDefault` é uma flag independente por departamento —
 * não há conflito a barrar na UI (a colisão entre AGENTES é resolvida no backend,
 * que rebaixa o default anterior daquele dept). A API reforça unicidade.
 *
 * Controlado: recebe `value` (lista atual) + `onChange`. Sem hex hardcoded —
 * tokens DS v2. Lista de departamentos reusa `GET /api/departments` (mesmo
 * endpoint de settings/workspace-org), filtrando `is_active = 'active'`.
 */
export function DepartmentsField({
  value,
  onChange,
  disabled = false,
}: {
  value: AgentDepartmentLink[];
  onChange: (next: AgentDepartmentLink[]) => void;
  disabled?: boolean;
}) {
  const query = useWorkspaceDepartments();
  // GOTCHA: is_active é text('active'|'archived'), não boolean.
  const departments = (query.data?.departments ?? []).filter((d) => d.isActive === 'active');

  const selected = new Map(value.map((v) => [v.departmentId, v.isDefault]));

  const toggleDepartment = (departmentId: string) => {
    if (disabled) return;
    if (selected.has(departmentId)) {
      onChange(value.filter((v) => v.departmentId !== departmentId));
    } else {
      onChange([...value, { departmentId, isDefault: false }]);
    }
  };

  const setDefault = (departmentId: string, isDefault: boolean) => {
    if (disabled) return;
    onChange(value.map((v) => (v.departmentId === departmentId ? { ...v, isDefault } : v)));
  };

  if (query.isLoading) {
    return (
      <div className="flex flex-col gap-2" aria-busy>
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-12 animate-pulse rounded-sm bg-surface-inset" />
        ))}
      </div>
    );
  }

  if (query.isError) {
    return (
      <p className="rounded-sm border border-border bg-surface-inset px-3 py-2.5 font-body text-sm text-text-low">
        Não foi possível carregar os departamentos. Tente recarregar a página.
      </p>
    );
  }

  if (departments.length === 0) {
    return (
      <p className="rounded-sm border border-dashed border-border bg-surface-inset px-3 py-2.5 font-body text-sm text-text-low">
        Nenhum departamento ativo no workspace. Crie um em Configurações &rsaquo; Organização para
        rotear este agente.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {departments.map((dept) => {
        const isSelected = selected.has(dept.id);
        const isDefault = selected.get(dept.id) === true;
        const checkboxId = `dept-${dept.id}`;
        return (
          <li
            key={dept.id}
            className={cn(
              'rounded-sm border transition-colors',
              isSelected
                ? 'border-border-2 bg-surface-inset'
                : 'border-border bg-surface-2 hover:border-border-2',
            )}
          >
            <div className="flex min-h-11 flex-wrap items-center gap-3 px-3 py-2.5">

              <input
                id={checkboxId}
                type="checkbox"
                checked={isSelected}
                disabled={disabled}
                onChange={() => toggleDepartment(dept.id)}
                className={cn(
                  'size-4 shrink-0 cursor-pointer rounded-xs border-border accent-brand outline-none',
                  'focus-visible:shadow-glow-sm disabled:cursor-not-allowed disabled:opacity-40',
                )}
              />
              <label
                htmlFor={checkboxId}
                className={cn(
                  'flex min-w-0 flex-1 cursor-pointer items-center gap-2',
                  disabled && 'cursor-not-allowed',
                )}
              >
                <Building2 className="size-4 shrink-0 text-text-low" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-head text-sm font-medium text-text">
                    {dept.name}
                  </span>
                  {dept.description && (
                    <span className="block truncate font-body text-xs text-text-low">
                      {dept.description}
                    </span>
                  )}
                </span>
              </label>

              {isSelected && (
                <button
                  type="button"
                  disabled={disabled}
                  aria-pressed={isDefault}
                  onClick={() => setDefault(dept.id, !isDefault)}
                  className={cn(
                    'inline-flex shrink-0 items-center gap-1.5 rounded-pill border px-2.5 py-1',
                    'font-head text-xs font-medium outline-none transition-colors',
                    'focus-visible:shadow-glow-md disabled:cursor-not-allowed disabled:opacity-40',
                    isDefault
                      ? 'border-transparent bg-brand text-text-on-brand'
                      : 'border-border text-text-low hover:border-border-2 hover:text-text-mid',
                  )}
                  title={
                    isDefault
                      ? 'Este agente recebe a primeira mensagem deste departamento.'
                      : 'Marcar como agente de entrada deste departamento.'
                  }
                >
                  <DoorOpen className="size-3.5" aria-hidden />
                  {isDefault ? 'Agente de entrada' : 'Definir entrada'}
                </button>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
