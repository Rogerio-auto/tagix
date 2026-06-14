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
import { Users, ShieldCheck } from 'lucide-react';
import { Button, useToast } from '@hm/ui';
import type { PeerVisibility, VisibilityPolicy } from '@hm/shared';
import { HelpPanel } from '@/shared/components/help';
import { EmptyState } from '@/shared/components/feedback/EmptyState';
import { ErrorState } from '@/shared/components/feedback/ErrorState';
import { Skeleton } from '@/shared/components/feedback/Skeleton';
import { selectClass, Row, Toggle } from '../personal/components';
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
        <p className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
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
        <ol className="list-decimal pl-4 flex flex-col gap-1">
          <li>Time com <code className="rounded bg-surface-3 px-1">peer_visibility</code> definido → usa esse.</li>
          <li>Time com <code className="rounded bg-surface-3 px-1">inherit</code> → usa o default do workspace (esta tela).</li>
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
      <div className="flex flex-col gap-3">
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
    <div className="flex flex-col gap-1">
      <Row
        title="Default peer-privacy"
        description="Define se agentes do mesmo departamento/time enxergam conversas uns dos outros."
      >
        <select
          value={policy.defaultPeerVisibility}
          onChange={(e) => setPeerVisibility(e.target.value as PeerVisibility)}
          className={selectClass}
          aria-label="Modo de peer-privacy padrão"
        >
          <option value="shared">Shared — visível para o time</option>
          <option value="private">Private — cada um só as suas</option>
        </select>
      </Row>

      <Row
        title="READONLY enxerga tudo"
        description="Membros com role READONLY têm acesso de leitura a toda a inbox do workspace."
      >
        <Toggle
          checked={policy.readonlySeesAll}
          onChange={setReadonlySeesAll}
          label="READONLY enxerga toda a inbox"
        />
      </Row>

      <div className="mt-4 flex justify-end">
        <Button
          variant="primary"
          disabled={!isDirty || update.isPending}
          onClick={() => void handleSave()}
        >
          {update.isPending ? 'Salvando…' : 'Salvar'}
        </Button>
      </div>
    </div>
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

  const removeOverride = async (deptId: string, deptName: string) => {
    const confirmed = window.confirm(
      `Remover acesso de "${memberName ?? memberEmail}" ao departamento "${deptName}"?`,
    );
    if (!confirmed) return;
    const nextIds = [...currentDeptIds].filter((id) => id !== deptId);
    try {
      await updateOverrides.mutateAsync({ memberId, departmentIds: nextIds });
      toast({ variant: 'success', title: 'Acesso removido.' });
    } catch (err) {
      toast({
        variant: 'error',
        title: err instanceof Error ? err.message : 'Falha ao remover acesso.',
      });
    }
  };

  return (
    <div className="rounded-lg border border-border bg-surface-2 p-4">
      <p className="mb-3 text-sm font-medium text-text">
        {memberName ?? memberEmail}
        <span className="ml-2 font-normal text-text-low">{memberEmail}</span>
      </p>

      {/* Current overrides */}
      {overridesQuery.isLoading ? (
        <Skeleton className="h-7 w-1/2" />
      ) : (
        <div className="mb-3 flex flex-wrap gap-2">
          {currentOverrides.length === 0 && (
            <span className="text-xs text-text-low">Sem acesso extra a departamentos.</span>
          )}
          {currentOverrides.map((ov) => (
            <span
              key={ov.departmentId}
              className="inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-0.5 text-xs text-text"
            >
              {ov.departmentName}
              <button
                type="button"
                aria-label={`Remover acesso ao departamento ${ov.departmentName}`}
                onClick={() => void removeOverride(ov.departmentId, ov.departmentName)}
                className="text-text-low transition-colors hover:text-danger focus-visible:shadow-glow-md focus-visible:outline-none"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Add override */}
      {availableDepts.length > 0 && (
        <div className="flex items-center gap-2">
          <select
            value={selectedDeptId}
            onChange={(e) => setSelectedDeptId(e.target.value)}
            className={selectClass}
            aria-label={`Conceder acesso a departamento para ${memberName ?? memberEmail}`}
          >
            <option value="">Adicionar acesso a departamento…</option>
            {availableDepts.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={!selectedDeptId || updateOverrides.isPending}
            onClick={() => void addOverride()}
            className="rounded-md border border-border px-2 py-1.5 text-xs text-text-mid transition-colors hover:text-text disabled:opacity-50 focus-visible:shadow-glow-md focus-visible:outline-none"
          >
            Conceder
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Member overrides section ─────────────────────────────────────────────────

function MemberOverridesSection(): React.JSX.Element {
  const membersQuery = useMembers();
  const members = membersQuery.data?.members ?? [];
  const activeMembers = members.filter((m) => m.status === 'active' || m.status === 'invited');

  if (membersQuery.isLoading) {
    return (
      <div className="flex flex-col gap-3">
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
      <EmptyState
        icon={Users}
        title="Nenhum membro"
        description="Convide membros ao workspace para gerenciar overrides de visibilidade."
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {activeMembers.map((m) => (
        <MemberOverrideRow
          key={m.id}
          memberId={m.id}
          memberName={m.name}
          memberEmail={m.email}
        />
      ))}
    </div>
  );
}

// ─── Root export ──────────────────────────────────────────────────────────────

export default function InboxVisibilitySection(): React.JSX.Element {
  return (
    <div className="flex flex-col gap-8">
      {/* Header + help */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-2">
          <ShieldCheck className="size-5 text-text-low" aria-hidden />
          <div>
            <p className="text-sm text-text-low">
              Controle quem enxerga o quê dentro da inbox. Configuração de OWNER/ADMIN.
            </p>
          </div>
        </div>
        <HelpPanel title="Visibilidade da inbox">
          <InboxVisibilityHelp />
        </HelpPanel>
      </div>

      {/* Política default do workspace */}
      <section aria-labelledby="policy-heading">
        <h3
          id="policy-heading"
          className="mb-4 text-sm font-semibold uppercase tracking-wide text-text-low"
        >
          Política do workspace
        </h3>
        <VisibilityPolicyForm />
      </section>

      {/* Overrides por membro */}
      <section aria-labelledby="overrides-heading">
        <h3
          id="overrides-heading"
          className="mb-1 text-sm font-semibold uppercase tracking-wide text-text-low"
        >
          Acesso extra por membro
        </h3>
        <p className="mb-4 text-xs text-text-low">
          Conceda a um membro visibilidade sobre departamentos além dos seus times.
        </p>
        <MemberOverridesSection />
      </section>
    </div>
  );
}
