'use client';

import { useMemo } from 'react';
import { ArrowRight, History } from 'lucide-react';
import { EmptyState, ErrorState, SkeletonList } from '@/shared/components/feedback';
import { ApiError } from '@/shared/lib/api-client';
import { useRoutingHistory } from './queries';
import type { AssignableMember, RoutingAction, RoutingDepartment } from './types';

const timeFmt = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

const ACTION_LABEL: Record<RoutingAction, string> = {
  assign: 'Atribuição',
  unassign: 'Remoção de atribuição',
  transfer_member: 'Transferência de responsável',
  transfer_department: 'Transferência de departamento',
  auto_assign: 'Atribuição automática',
};

/**
 * Trilha auditável de roteamento (F1-S23). Lista as mudanças de responsável e
 * departamento, mais recentes primeiro. UX §3: empty/loading(skeleton)/error(3
 * partes). Carrega sob demanda (`enabled`) para não buscar quando oculta.
 */
export function RoutingHistoryList({
  conversationId,
  membersById,
  departmentsById,
  enabled,
}: {
  conversationId: string;
  membersById: ReadonlyMap<string, AssignableMember>;
  departmentsById: ReadonlyMap<string, RoutingDepartment>;
  enabled: boolean;
}) {
  const { data, isLoading, isError, error, refetch } = useRoutingHistory(conversationId, enabled);
  const entries = data?.history ?? [];

  const memberLabel = useMemo(
    () => (id: string | null) => {
      if (!id) return 'Ninguém';
      const m = membersById.get(id);
      return m?.name?.trim() || m?.email || 'Membro';
    },
    [membersById],
  );
  const deptLabel = useMemo(
    () => (id: string | null) => (id ? departmentsById.get(id)?.name ?? 'Departamento' : 'Nenhum'),
    [departmentsById],
  );

  if (isLoading) return <SkeletonList rows={3} />;
  if (isError) {
    return (
      <ErrorState
        title="Não foi possível carregar o histórico"
        reason="A trilha de roteamento desta conversa não respondeu."
        whatToDo="Tente novamente em instantes."
        reference={error instanceof ApiError ? error.ref : undefined}
      />
    );
  }
  if (entries.length === 0) {
    return (
      <EmptyState
        icon={History}
        title="Sem histórico de roteamento"
        description="Atribuições e transferências desta conversa aparecem aqui."
      />
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {entries.map((entry) => {
        const isDept = entry.action === 'transfer_department';
        const from = isDept ? deptLabel(entry.fromDepartment) : memberLabel(entry.fromMemberId);
        const to = isDept ? deptLabel(entry.toDepartment) : memberLabel(entry.toMemberId);
        return (
          <li
            key={entry.id}
            className="rounded-md border border-border-2 bg-surface-2 p-3"
          >
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="truncate font-head text-xs font-semibold text-text-mid">
                {ACTION_LABEL[entry.action]}
              </span>
              <time
                dateTime={entry.createdAt}
                className="shrink-0 font-body text-xs text-text-low"
              >
                {timeFmt.format(new Date(entry.createdAt))}
              </time>
            </div>
            <div className="flex items-center gap-1.5 font-body text-sm text-text">
              <span className="truncate text-text-low">{from}</span>
              <ArrowRight className="size-3.5 shrink-0 text-text-low" aria-hidden />
              <span className="truncate">{to}</span>
            </div>
            {entry.reason && (
              <p className="mt-1 break-words font-body text-xs text-text-low">“{entry.reason}”</p>
            )}
          </li>
        );
      })}
      <li>
        <button
          type="button"
          onClick={() => void refetch()}
          className="font-body text-xs text-text-low underline-offset-4 outline-none hover:text-text-mid focus-visible:shadow-glow-md"
        >
          Atualizar histórico
        </button>
      </li>
    </ul>
  );
}
