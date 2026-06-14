'use client';

import { useState } from 'react';
import { X } from 'lucide-react';
import { Button, Input, useToast } from '@hm/ui';
import type { TeamPeerVisibility } from '@hm/shared';
import { selectClass } from '../personal/components';
import {
  useCreateTeam,
  useDeleteTeam,
  useDepartments,
  useMembers,
  useRemoveTeamMember,
  useSetTeamMember,
  useSetTeamPeerVisibility,
  useTeams,
} from './queries';

/** Times: CRUD + alocação de membros + estratégia de auto-assign por time + peer-privacy (F30-S10). */
export default function TeamsSection(): React.JSX.Element {
  const { toast } = useToast();
  const teamsQuery = useTeams();
  const deptQuery = useDepartments();
  const membersQuery = useMembers();
  const create = useCreateTeam();
  const remove = useDeleteTeam();
  const setMember = useSetTeamMember();
  const removeMember = useRemoveTeamMember();
  const setPeerVisibility = useSetTeamPeerVisibility();

  const [name, setName] = useState('');
  const [deptId, setDeptId] = useState('');
  const [addTo, setAddTo] = useState<Record<string, string>>({});

  const teams = (teamsQuery.data?.teams ?? []).filter((t) => t.isActive === 'active');
  const departments = (deptQuery.data?.departments ?? []).filter((d) => d.isActive === 'active');
  const allMembers = membersQuery.data?.members ?? [];

  const add = async () => {
    if (!name.trim()) return;
    try {
      await create.mutateAsync({ name: name.trim(), departmentId: deptId || null });
      setName('');
      setDeptId('');
      toast({ variant: 'success', title: 'Time criado.' });
    } catch (err) {
      toast({ variant: 'error', title: err instanceof Error ? err.message : 'Falha ao criar.' });
    }
  };

  if (teamsQuery.isLoading) return <p className="text-sm text-text-low">Carregando…</p>;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex-1 min-w-48">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome do time" />
        </div>
        <select value={deptId} onChange={(e) => setDeptId(e.target.value)} className={selectClass} aria-label="Departamento">
          <option value="">Sem departamento</option>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
        <Button variant="primary" disabled={!name.trim() || create.isPending} onClick={() => void add()}>
          Adicionar
        </Button>
      </div>

      <div className="flex flex-col gap-3">
        {teams.length === 0 && <p className="text-sm text-text-low">Nenhum time.</p>}
        {teams.map((t) => {
          const memberIds = new Set(t.members.map((m) => m.memberId));
          const candidates = allMembers.filter((m) => !memberIds.has(m.id));
          return (
            <div key={t.id} className="rounded-lg border border-border p-4">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-medium text-text">{t.name}</span>
                <button
                  type="button"
                  onClick={() =>
                    remove.mutate(t.id, {
                      onSuccess: () => toast({ variant: 'success', title: 'Time arquivado.' }),
                      onError: (e) => toast({ variant: 'error', title: e.message }),
                    })
                  }
                  className="text-xs text-text-low hover:text-danger"
                >
                  Arquivar
                </button>
              </div>
              <div className="mb-3 flex flex-wrap gap-2">
                {t.members.map((m) => (
                  <span
                    key={m.memberId}
                    className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs text-text"
                  >
                    {m.name ?? m.email}
                    <button
                      type="button"
                      aria-label={`Remover ${m.email} do time`}
                      onClick={() =>
                        removeMember.mutate(
                          { teamId: t.id, memberId: m.memberId },
                          { onError: (e) => toast({ variant: 'error', title: e.message }) },
                        )
                      }
                      className="text-text-low hover:text-danger"
                    >
                      <X className="size-3" />
                    </button>
                  </span>
                ))}
                {t.members.length === 0 && <span className="text-xs text-text-low">Sem membros.</span>}
              </div>
              {/* Peer-privacy por time (F30-S10) */}
              <div className="mb-3 flex items-center gap-2">
                <label className="text-xs text-text-low" htmlFor={`peer-vis-${t.id}`}>
                  Peer-privacy:
                </label>
                <select
                  id={`peer-vis-${t.id}`}
                  value={t.peerVisibility ?? 'inherit'}
                  onChange={(e) => {
                    const peerVisibility = e.target.value as TeamPeerVisibility;
                    setPeerVisibility.mutate(
                      { teamId: t.id, peerVisibility },
                      {
                        onSuccess: () =>
                          toast({ variant: 'success', title: `Peer-privacy do time "${t.name}" atualizado.` }),
                        onError: (e) =>
                          toast({ variant: 'error', title: e.message }),
                      },
                    );
                  }}
                  className={selectClass}
                  aria-label={`Peer-privacy do time ${t.name}`}
                >
                  <option value="inherit">Inherit (padrão do workspace)</option>
                  <option value="shared">Shared — visível para o time</option>
                  <option value="private">Private — cada um só as suas</option>
                </select>
              </div>

              {candidates.length > 0 && (
                <div className="flex items-center gap-2">
                  <select
                    value={addTo[t.id] ?? ''}
                    onChange={(e) => setAddTo((s) => ({ ...s, [t.id]: e.target.value }))}
                    aria-label="Adicionar membro ao time"
                    className={selectClass}
                  >
                    <option value="">Adicionar membro…</option>
                    {candidates.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name ?? m.email}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    disabled={!addTo[t.id]}
                    onClick={() => {
                      const memberId = addTo[t.id];
                      if (!memberId) return;
                      setMember.mutate(
                        { teamId: t.id, memberId },
                        {
                          onSuccess: () => setAddTo((s) => ({ ...s, [t.id]: '' })),
                          onError: (e) => toast({ variant: 'error', title: e.message }),
                        },
                      );
                    }}
                    className="rounded-md border border-border px-2 py-1 text-xs text-text-mid hover:text-text disabled:opacity-50"
                  >
                    Adicionar
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
