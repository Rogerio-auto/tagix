'use client';

import { useState } from 'react';
import { Archive, Plus, UsersRound, X } from 'lucide-react';
import { Button, EmptyState, ErrorState, Input, useToast } from '@hm/ui';
import type { TeamPeerVisibility } from '@hm/shared';
import { ReadOnlyGuard, useIsReadOnly } from '@/shared/components/account-banner';
import { cn } from '@/shared/lib/cn';
import { formatNumber } from '@/shared/lib/locale';
import { Panel, SectionLoading, eyebrowClass, selectClass } from '../personal/components';
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

/** Select que respeita o só leitura: focável, `aria-disabled` e a troca é ignorada. */
const guardedSelect = 'aria-disabled:cursor-not-allowed aria-disabled:opacity-50';

/**
 * Times: CRUD + alocação de membros + peer-privacy por time (F30-S10), no DS 3.0
 * (F72-S07): cada time é um painel com os membros em chips, a privacidade e o "adicionar".
 * Só leitura (F71-S17): criar, arquivar, adicionar/remover membro e trocar a privacidade
 * ficam `aria-disabled` com a explicação.
 */
export default function TeamsSection(): React.JSX.Element {
  const { toast } = useToast();
  const readOnly = useIsReadOnly();
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

  if (teamsQuery.isLoading) return <SectionLoading label="Carregando times" />;

  if (teamsQuery.isError) {
    return (
      <ErrorState
        title="Não foi possível carregar os times"
        reason="A lista não respondeu."
        whatToDo="Tente de novo em instantes."
        action={
          <Button variant="secondary" loading={teamsQuery.isFetching} onClick={() => void teamsQuery.refetch()}>
            Tentar de novo
          </Button>
        }
      />
    );
  }

  const departmentName = (id: string | null) => departments.find((d) => d.id === id)?.name ?? null;

  return (
    <div className="flex flex-col gap-5">
      <Panel title="Novo time" body="flush">
        <form
          className="flex flex-col gap-2 px-5 py-4 sm:flex-row sm:items-start"
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          <div className="min-w-48 flex-1">
            <Input aria-label="Nome do time" value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome do time" />
          </div>
          <select value={deptId} onChange={(e) => setDeptId(e.target.value)} className={selectClass} aria-label="Departamento">
            <option value="">Sem departamento</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
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
      </Panel>

      {teams.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border-2">
          <EmptyState
            className="py-8"
            icon={UsersRound}
            title="Nenhum time"
            description="Times dividem a fila de atendimento e definem a privacidade entre colegas."
          />
        </div>
      ) : (
        teams.map((t) => {
          const memberIds = new Set(t.members.map((m) => m.memberId));
          const candidates = allMembers.filter((m) => !memberIds.has(m.id));
          const dept = departmentName(t.departmentId);
          return (
            <Panel
              key={t.id}
              title={t.name}
              description={
                <span className="flex flex-wrap items-center gap-x-2">
                  {dept && <span>{dept}</span>}
                  {dept && <span aria-hidden>·</span>}
                  <span>
                    <span className="font-mono tabular-nums text-text-mid">{formatNumber(t.members.length)}</span>{' '}
                    {t.members.length === 1 ? 'membro' : 'membros'}
                  </span>
                </span>
              }
              action={
                <ReadOnlyGuard>
                  <Button
                    variant="ghost"
                    size="sm"
                    leftIcon={<Archive className="size-4" aria-hidden />}
                    aria-label={`Arquivar time ${t.name}`}
                    onClick={() =>
                      remove.mutate(t.id, {
                        onSuccess: () => toast({ variant: 'success', title: 'Time arquivado.' }),
                        onError: (e) => toast({ variant: 'error', title: e.message }),
                      })
                    }
                  >
                    Arquivar
                  </Button>
                </ReadOnlyGuard>
              }
            >
              <div className="flex flex-col gap-2">
                <p className={eyebrowClass}>Membros</p>
                <ul className="flex flex-wrap gap-2">
                  {t.members.map((m) => (
                    <li
                      key={m.memberId}
                      className="inline-flex items-center gap-1 rounded-pill border border-border bg-surface-2 py-1 pl-3 pr-1 font-body text-sm text-text"
                    >
                      {m.name ?? m.email}
                      <ReadOnlyGuard>
                        <button
                          type="button"
                          aria-label={`Remover ${m.email} do time`}
                          onClick={() =>
                            removeMember.mutate(
                              { teamId: t.id, memberId: m.memberId },
                              { onError: (e) => toast({ variant: 'error', title: e.message }) },
                            )
                          }
                          className="grid size-6 place-items-center rounded-pill text-text-low outline-none transition-colors duration-(--dur-fast) hover:bg-surface-3 hover:text-danger focus-visible:focus-ring"
                        >
                          <X className="size-3.5" aria-hidden />
                        </button>
                      </ReadOnlyGuard>
                    </li>
                  ))}
                  {t.members.length === 0 && <li className="font-body text-sm text-text-low">Sem membros.</li>}
                </ul>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                {/* Peer-privacy por time (F30-S10) */}
                <label className="flex flex-col gap-1.5 font-body text-sm font-bold text-text-mid" htmlFor={`peer-vis-${t.id}`}>
                  Privacidade entre colegas
                  <ReadOnlyGuard align="start">
                    <select
                      id={`peer-vis-${t.id}`}
                      value={t.peerVisibility ?? 'inherit'}
                      onMouseDown={readOnly ? (e) => e.preventDefault() : undefined}
                      onChange={(e) => {
                        if (readOnly) return;
                        const peerVisibility = e.target.value as TeamPeerVisibility;
                        setPeerVisibility.mutate(
                          { teamId: t.id, peerVisibility },
                          {
                            onSuccess: () =>
                              toast({ variant: 'success', title: `Privacidade do time "${t.name}" atualizada.` }),
                            onError: (e) => toast({ variant: 'error', title: e.message }),
                          },
                        );
                      }}
                      className={cn(selectClass, 'w-full font-normal', guardedSelect)}
                      aria-label={`Peer-privacy do time ${t.name}`}
                    >
                      <option value="inherit">Herdar o padrão do workspace</option>
                      <option value="shared">Compartilhada: visível para o time</option>
                      <option value="private">Privada: cada um só as suas</option>
                    </select>
                  </ReadOnlyGuard>
                </label>

                {candidates.length > 0 && (
                  <div className="flex flex-col gap-1.5">
                    <span className="font-body text-sm font-bold text-text-mid">
                      Adicionar membro
                    </span>
                    <div className="flex items-center gap-2">
                      <select
                        value={addTo[t.id] ?? ''}
                        onChange={(e) => setAddTo((s) => ({ ...s, [t.id]: e.target.value }))}
                        aria-label="Adicionar membro ao time"
                        className={cn(selectClass, 'min-w-0 flex-1')}
                      >
                        <option value="">Escolha…</option>
                        {candidates.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name ?? m.email}
                          </option>
                        ))}
                      </select>
                      <ReadOnlyGuard>
                        <Button
                          variant="secondary"
                          disabled={!readOnly && !addTo[t.id]}
                          loading={setMember.isPending && setMember.variables?.teamId === t.id}
                          aria-label={`Adicionar ao time ${t.name}`}
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
                        >
                          Adicionar
                        </Button>
                      </ReadOnlyGuard>
                    </div>
                  </div>
                )}
              </div>
            </Panel>
          );
        })
      )}
    </div>
  );
}
