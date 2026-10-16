'use client';

/**
 * Configuração de visibilidade da inbox (F30-S10).
 *
 * UX aplicadas:
 * - §2.4 — entrada óbvia na sidebar de settings (não escondida).
 * - §2.5 — explicação dos modos shared/private em HelpPanel `?`, não tooltip.
 * - §2.7 — salvar com feedback imediato: dirty-tracking, botão loading, toast.
 * - §2.9 — remoção de override com confirmação proporcional (soft = confirm window).
 * - §2.6 — empty state quando nenhum membro tem override.
 * - §2.11 — error state com 3 partes.
 * - Loading: skeletons no lugar do conteúdo.
 * - §2.10 — atalho Esc fecha HelpPanel (via Sheet).
 *
 * Gate de permissão: inbox.visibility.manage (OWNER/ADMIN).
 * Autoridade real está no backend (S08); a UI apenas esconde para outros roles.
 */

import { useState } from 'react';
import { Plus, ShieldCheck, Users, X } from 'lucide-react';
import { Button, Modal, useToast } from '@hm/ui';
import type { PeerVisibility, VisibilityPolicy } from '@hm/shared';
import { HelpPanel } from '@/shared/components/help';
import { EmptyState } from '@/shared/components/feedback/EmptyState';
import { ErrorState } from '@/shared/components/feedback/ErrorState';
import { Skeleton } from '@/shared/components/feedback/Skeleton';
import { ReadOnlyGuard, useIsReadOnly } from '@/shared/components/account-banner';
import { cn } from '@/shared/lib/cn';
import { Panel, Row, SaveFooter, Toggle, eyebrowClass, selectClass } from '../personal/components';
import {
  useInboxVisibility,
  useUpdateInboxVisibility,
  useMemberVisibilityOverrides,
  useUpdateMemberVisibilityOverrides,
  useMembers,
  useDepartments,
} from './queries';

// ─── Help content ─────────────────────────────────────────────────────────────

function InboxVisibilityHelp(): React.JSX.Element {
  return (
    <div className="flex flex-col gap-4 font-body text-sm text-text-mid">
      <section className="flex flex-col gap-2">
        <h3 className="font-head text-base font-semibold text-text">Peer-privacy: shared vs private</h3>
        <p>
          <strong className="text-text">Shared</strong> — todos os agentes do mesmo departamento/time
          enxergam as conversas uns dos outros. Ideal para times abertos onde qualquer um pode
          cobrir outro.
        </p>
        <p>
          <strong className="text-text">Private</strong> — cada agente só vê as conversas
          atribuídas a ele. Líderes de time (role &quot;lead&quot;) sempre enxergam tudo do seu
          time, independente desse modo.
        </p>
        <p className="rounded-md border border-warn/30 bg-warn/10 px-3 py-2 text-sm text-text">
          <strong>Atenção:</strong> mudar para &quot;Private&quot; é a configuração mais sensível.
          Agentes deixarão de ver conversas de colegas. Certifique-se de que supervisores
          (role &quot;lead&quot;) estão alocados nos times para manter visibilidade de gestão.
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="font-head text-base font-semibold text-text">Overrides por membro</h3>
        <p>
          Conceda visibilidade extra a um membro específico sobre departamentos fora dos seus.
          Útil para coordenadores que atuam em múltiplos setores sem pertencer a eles formalmente.
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="font-head text-base font-semibold text-text">Hierarquia de resolução</h3>
        <ol className="flex list-decimal flex-col gap-1 pl-4">
          <li>Time com <code className="rounded-xs bg-surface-3 px-1 font-mono text-xs">peer_visibility</code> definido → usa esse.</li>
          <li>Time com <code className="rounded-xs bg-surface-3 px-1 font-mono text-xs">inherit</code> → usa o default do workspace (esta tela).</li>
          <li>Conversa sem time → usa o default do workspace diretamente.</li>
        </ol>
      </section>
    </div>
  );
}

// ─── Policy form ──────────────────────────────────────────────────────────────

function VisibilityPolicyForm(): React.JSX.Element {
  const { toast } = useToast();
  const query = useInboxVisibility();
  const update = useUpdateInboxVisibility();
  const readOnly = useIsReadOnly();

  const remote = query.data?.policy;
  const [local, setLocal] = useState<VisibilityPolicy | null>(null);

  // Merge: local overrides remote when dirty
  const policy: VisibilityPolicy = local ?? remote ?? {
    defaultPeerVisibility: 'shared',
    readonlySeesAll: true,
  };

  const isDirty = local !== null;

  const setPeerVisibility = (v: PeerVisibility) =>
    setLocal({ ...policy, defaultPeerVisibility: v });

  const setReadonlySeesAll = (v: boolean) =>
    setLocal({ ...policy, readonlySeesAll: v });

  const handleSave = async () => {
    if (!isDirty) return;
    try {
      await update.mutateAsync(policy);
      setLocal(null);
      toast({ variant: 'success', title: 'Configuração de visibilidade salva.' });
    } catch (err) {
      toast({
        variant: 'error',
        title: err instanceof Error ? err.message : 'Falha ao salvar.',
      });
    }
  };

  if (query.isLoading) {
    return (
      <div className="flex flex-col gap-3" role="status" aria-busy="true" aria-label="Carregando política">
        <Skeleton className="h-12 rounded-lg" />
        <Skeleton className="h-12 rounded-lg" />
      </div>
    );
  }

  if (query.isError) {
    return (
      <ErrorState
        title="Falha ao carregar configuração"
        reason="Não foi possível ler a política de visibilidade do workspace."
        whatToDo="Recarregue a página ou entre em contato com o suporte."
      />
    );
  }

  return (
    <Panel
      body="rows"
      footer={
        <SaveFooter dirty={isDirty}>
          <ReadOnlyGuard>
            <Button variant="primary" disabled={!readOnly && !isDirty} loading={update.isPending} onClick={() => void handleSave()}>
              Salvar política
            </Button>
          </ReadOnlyGuard>
        </SaveFooter>
      }
    >
      <Row
        title="Privacidade padrão entre colegas"
        description="Define se agentes do mesmo departamento/time enxergam conversas uns dos outros."
      >
        <select
          value={policy.defaultPeerVisibility}
          onChange={(e) => setPeerVisibility(e.target.value as PeerVisibility)}
          className={selectClass}
          aria-label="Modo de peer-privacy padrão"
        >
          <option value="shared">Compartilhada: visível para o time</option>
          <option value="private">Privada: cada um só as suas</option>
        </select>
      </Row>

      <Row
        title="Somente leitura enxerga tudo"
        description="Membros com papel Somente leitura têm acesso de leitura a toda a inbox do workspace."
      >
        <Toggle checked={policy.readonlySeesAll} onChange={setReadonlySeesAll} label="READONLY enxerga toda a inbox" />
      </Row>
    </Panel>
  );
}

// ─── Member override row ──────────────────────────────────────────────────────

function MemberOverrideRow({
  memberId,
  memberName,
  memberEmail,
}: {
  memberId: string;
  memberName: string | null;
  memberEmail: string;
}): React.JSX.Element {
  const { toast } = useToast();
  const overridesQuery = useMemberVisibilityOverrides(memberId);
  const deptQuery = useDepartments();
  const updateOverrides = useUpdateMemberVisibilityOverrides();
  const readOnly = useIsReadOnly();

  const [selectedDeptId, setSelectedDeptId] = useState('');

  const currentOverrides = overridesQuery.data?.overrides ?? [];
  const currentDeptIds = new Set(currentOverrides.map((o) => o.departmentId));
  const allDepts = (deptQuery.data?.departments ?? []).filter((d) => d.isActive === 'active');
  const availableDepts = allDepts.filter((d) => !currentDeptIds.has(d.id));

  const addOverride = async () => {
    if (!selectedDeptId) return;
    const nextIds = [...currentDeptIds, selectedDeptId];
    try {
      await updateOverrides.mutateAsync({ memberId, departmentIds: nextIds });
      setSelectedDeptId('');
      toast({ variant: 'success', title: 'Acesso extra concedido.' });
    } catch (err) {
      toast({
        variant: 'error',
        title: err instanceof Error ? err.message : 'Falha ao adicionar acesso.',
      });
    }
  };

  const [removeTarget, setRemoveTarget] = useState<{ id: string; name: string } | null>(null);
  const label = memberName ?? memberEmail;

  const removeOverride = async () => {
    if (!removeTarget) return;
    const nextIds = [...currentDeptIds].filter((id) => id !== removeTarget.id);
    try {
      await updateOverrides.mutateAsync({ memberId, departmentIds: nextIds });
      setRemoveTarget(null);
      toast({ variant: 'success', title: 'Acesso removido.' });
    } catch (err) {
      toast({
        variant: 'error',
        title: err instanceof Error ? err.message : 'Falha ao remover acesso.',
      });
    }
  };

  return (
    <li className="flex flex-col gap-3 px-5 py-4">
      <p className="flex min-w-0 flex-wrap items-baseline gap-x-2 font-body text-sm">
        <span className="font-semibold text-text">{label}</span>
        {memberName && <span className="truncate text-text-low">{memberEmail}</span>}
      </p>

      {/* Acessos extras atuais */}
      {overridesQuery.isLoading ? (
        <Skeleton className="h-7 w-1/2" />
      ) : (
        <ul className="flex flex-wrap gap-2" aria-label={`Acessos extras de ${label}`}>
          {currentOverrides.length === 0 && (
            <li className="font-body text-sm text-text-low">Sem acesso extra a departamentos.</li>
          )}
          {currentOverrides.map((ov) => (
            <li
              key={ov.departmentId}
              className="inline-flex items-center gap-1 rounded-pill border border-border bg-surface-2 py-1 pl-3 pr-1 font-body text-sm text-text"
            >
              {ov.departmentName}
              <ReadOnlyGuard>
                <button
                  type="button"
                  aria-label={`Remover acesso ao departamento ${ov.departmentName}`}
                  onClick={() => setRemoveTarget({ id: ov.departmentId, name: ov.departmentName })}
                  className="grid size-6 place-items-center rounded-pill text-text-low outline-none transition-colors duration-(--dur-fast) hover:bg-surface-3 hover:text-danger focus-visible:focus-ring"
                >
                  <X className="size-3.5" aria-hidden />
                </button>
              </ReadOnlyGuard>
            </li>
          ))}
        </ul>
      )}

      {/* Conceder acesso */}
      {availableDepts.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={selectedDeptId}
            onChange={(e) => setSelectedDeptId(e.target.value)}
            className={cn(selectClass, 'min-w-0 flex-1 sm:max-w-72')}
            aria-label={`Conceder acesso a departamento para ${label}`}
          >
            <option value="">Escolha um departamento…</option>
            {availableDepts.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
          <ReadOnlyGuard>
            <Button
              variant="secondary"
              leftIcon={<Plus className="size-4" aria-hidden />}
              disabled={!readOnly && !selectedDeptId}
              loading={updateOverrides.isPending && removeTarget === null}
              aria-label={`Conceder acesso a ${label}`}
              onClick={() => void addOverride()}
            >
              Conceder
            </Button>
          </ReadOnlyGuard>
        </div>
      )}

      <Modal
        open={removeTarget !== null}
        onClose={() => setRemoveTarget(null)}
        title="Remover acesso extra"
        description={
          removeTarget
            ? `${label} deixa de ver as conversas do departamento ${removeTarget.name} que não forem dos times dele.`
            : undefined
        }
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setRemoveTarget(null)}>
              Cancelar
            </Button>
            <Button variant="danger" loading={updateOverrides.isPending} onClick={() => void removeOverride()}>
              Remover acesso
            </Button>
          </div>
        }
      />
    </li>
  );
}

// ─── Member overrides section ─────────────────────────────────────────────────

function MemberOverridesSection(): React.JSX.Element {
  const membersQuery = useMembers();
  const members = membersQuery.data?.members ?? [];
  const activeMembers = members.filter((m) => m.status === 'active' || m.status === 'invited');

  if (membersQuery.isLoading) {
    return (
      <div className="flex flex-col gap-3" role="status" aria-busy="true" aria-label="Carregando membros">
        <Skeleton className="h-24 rounded-lg" />
        <Skeleton className="h-24 rounded-lg" />
      </div>
    );
  }

  if (membersQuery.isError) {
    return (
      <ErrorState
        title="Falha ao carregar membros"
        reason="Não foi possível listar os membros do workspace."
        whatToDo="Recarregue a página ou entre em contato com o suporte."
      />
    );
  }

  if (activeMembers.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border-2">
        <EmptyState
          icon={Users}
          title="Nenhum membro"
          description="Convide membros ao workspace para gerenciar overrides de visibilidade."
        />
      </div>
    );
  }

  return (
    <ul className="flex flex-col divide-y divide-border rounded-lg border border-border bg-surface">
      {activeMembers.map((m) => (
        <MemberOverrideRow key={m.id} memberId={m.id} memberName={m.name} memberEmail={m.email} />
      ))}
    </ul>
  );
}

// ─── Root export ──────────────────────────────────────────────────────────────

export default function InboxVisibilitySection(): React.JSX.Element {
  return (
    <div className="flex flex-col gap-8">
      {/* Contexto + ajuda (UX §2.5) */}
      <div className="flex items-start justify-between gap-4 rounded-lg border border-border bg-surface px-5 py-4">
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 size-5 shrink-0 text-brand-text" aria-hidden />
          <p className="font-body text-sm text-text-mid">
            Controle quem enxerga o quê dentro da inbox. Configuração de proprietários e administradores.
          </p>
        </div>
        <HelpPanel title="Visibilidade da inbox">
          <InboxVisibilityHelp />
        </HelpPanel>
      </div>

      {/* Política padrão do workspace */}
      <section aria-labelledby="policy-heading" className="flex flex-col gap-3">
        <h3 id="policy-heading" className={eyebrowClass}>
          Política do workspace
        </h3>
        <VisibilityPolicyForm />
      </section>

      {/* Acessos extras por membro */}
      <section aria-labelledby="overrides-heading" className="flex flex-col gap-3">
        <div>
          <h3 id="overrides-heading" className={eyebrowClass}>
            Acesso extra por membro
          </h3>
          <p className="mt-1.5 font-body text-sm text-text-low">
            Conceda a um membro visibilidade sobre departamentos além dos seus times.
          </p>
        </div>
        <MemberOverridesSection />
      </section>
    </div>
  );
}
