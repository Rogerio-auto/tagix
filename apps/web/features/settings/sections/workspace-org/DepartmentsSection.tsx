'use client';

import { useState } from 'react';
import { Button, Input, useToast } from '@hm/ui';
import { useCreateDepartment, useDeleteDepartment, useDepartments } from './queries';

/** Departamentos: CRUD simples (archive em delete). */
export default function DepartmentsSection(): React.JSX.Element {
  const { toast } = useToast();
  const deptQuery = useDepartments();
  const create = useCreateDepartment();
  const remove = useDeleteDepartment();
  const [name, setName] = useState('');

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

  if (deptQuery.isLoading) return <p className="text-sm text-text-low">Carregando…</p>;

  return (
    <div className="flex max-w-md flex-col gap-4">
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome do departamento" />
        </div>
        <Button variant="primary" disabled={!name.trim() || create.isPending} onClick={() => void add()}>
          Adicionar
        </Button>
      </div>

      <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
        {active.length === 0 && <li className="px-4 py-3 text-sm text-text-low">Nenhum departamento.</li>}
        {active.map((d) => (
          <li key={d.id} className="flex items-center justify-between gap-4 px-4 py-3">
            <span className="text-sm text-text">{d.name}</span>
            <button
              type="button"
              disabled={remove.isPending}
              onClick={() =>
                remove.mutate(d.id, {
                  onSuccess: () => toast({ variant: 'success', title: 'Departamento arquivado.' }),
                  onError: (e) => toast({ variant: 'error', title: e.message }),
                })
              }
              className="text-xs text-text-low hover:text-danger"
            >
              Arquivar
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
