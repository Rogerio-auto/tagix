'use client';

import { useState } from 'react';
import { Archive, Building2, Plus } from 'lucide-react';
import { Button, EmptyState, ErrorState, Input, useToast } from '@hm/ui';
import { ReadOnlyGuard, useIsReadOnly } from '@/shared/components/account-banner';
import { Panel, SectionLoading } from '../personal/components';
import { useCreateDepartment, useDeleteDepartment, useDepartments } from './queries';

/**
 * Departamentos: criar e arquivar (archive em delete), no DS 3.0 (F72-S07). Só leitura
 * (F71-S17): adicionar e arquivar ficam `aria-disabled` com a explicação.
 */
export default function DepartmentsSection(): React.JSX.Element {
  const { toast } = useToast();
  const deptQuery = useDepartments();
  const create = useCreateDepartment();
  const remove = useDeleteDepartment();
  // Só leitura: o botão fica focável (aria-disabled + explicação) mesmo sem alterações;
  // `disabled` tiraria o botão do Tab e a explicação nunca seria encontrada.
  const readOnly = useIsReadOnly();
  const [name, setName] = useState('');
  const [archivingId, setArchivingId] = useState<string | null>(null);

  const active = (deptQuery.data?.departments ?? []).filter((d) => d.isActive === 'active');

  const add = async () => {
    if (!name.trim()) return;
    try {
      await create.mutateAsync({ name: name.trim() });
      setName('');
      toast({ variant: 'success', title: 'Departamento criado.' });
    } catch (err) {
      toast({ variant: 'error', title: err instanceof Error ? err.message : 'Falha ao criar.' });
    }
  };

  const archive = (id: string, label: string) => {
    setArchivingId(id);
    remove.mutate(id, {
      onSuccess: () => toast({ variant: 'success', title: 'Departamento arquivado.', description: label }),
      onError: (e) => toast({ variant: 'error', title: e.message }),
      onSettled: () => setArchivingId(null),
    });
  };

  if (deptQuery.isLoading) return <SectionLoading label="Carregando departamentos" />;

  if (deptQuery.isError) {
    return (
      <ErrorState
        title="Não foi possível carregar os departamentos"
        reason="A lista não respondeu."
        whatToDo="Tente de novo em instantes."
        action={
          <Button variant="secondary" loading={deptQuery.isFetching} onClick={() => void deptQuery.refetch()}>
            Tentar de novo
          </Button>
        }
      />
    );
  }

  return (
    <Panel
      title="Departamentos"
      description="Agrupam times e definem quem enxerga quais conversas."
      body="flush"
    >
      <form
        className="flex flex-col gap-2 border-b border-border px-5 py-4 sm:flex-row sm:items-start"
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
      >
        <div className="flex-1">
          <Input
            aria-label="Nome do departamento"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nome do departamento"
          />
        </div>
        <ReadOnlyGuard>
          <Button
            type="submit"
            variant="secondary"
            leftIcon={<Plus className="size-4" aria-hidden />}
            disabled={!readOnly && !name.trim()}
            loading={create.isPending}
          >
            Adicionar
          </Button>
        </ReadOnlyGuard>
      </form>

      {active.length === 0 ? (
        <EmptyState
          className="py-8"
          icon={Building2}
          title="Nenhum departamento"
          description="Crie o primeiro acima: ex. Vendas, Suporte, Financeiro."
        />
      ) : (
        <ul className="divide-y divide-border px-5">
          {active.map((d) => (
            <li key={d.id} className="flex items-center justify-between gap-4 py-3">
              <span className="min-w-0">
                <span className="block truncate font-body text-sm font-semibold text-text">{d.name}</span>
                {d.description && <span className="block truncate text-xs text-text-low">{d.description}</span>}
              </span>
              <ReadOnlyGuard>
                <Button
                  variant="ghost"
                  size="sm"
                  className="max-md:h-11"
                  leftIcon={<Archive className="size-4" aria-hidden />}
                  loading={archivingId === d.id}
                  disabled={archivingId !== null && archivingId !== d.id}
                  aria-label={`Arquivar departamento ${d.name}`}
                  onClick={() => archive(d.id, d.name)}
                >
                  Arquivar
                </Button>
              </ReadOnlyGuard>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
