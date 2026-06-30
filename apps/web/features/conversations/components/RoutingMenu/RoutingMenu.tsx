'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRightLeft,
  Building2,
  Check,
  ChevronDown,
  History,
  UserCheck,
  UserPlus,
} from 'lucide-react';
import { Button, useToast } from '@hm/ui';
import { can, type Permission } from '@hm/shared';
import { cn } from '@/shared/lib/cn';
import { Sheet } from '@/shared/components/Sheet';
import { useBreakpoint } from '@/shared/hooks/useBreakpoint';
import { useAuthStore } from '@/shared/stores/auth.store';
import { useAssignConversation, useRoutingTargets, useTransferConversation } from './queries';
import { RoutingHistoryList } from './RoutingHistoryList';
import type { AssignableMember, RoutingDepartment } from './types';

type Mode = 'menu' | 'transfer_member' | 'transfer_department';

/**
 * Menu de roteamento de uma conversa (F1-S23). Vive dentro do `ContactInfoPanel`
 * (UX §2.3 — painel/menu, não modal aninhado). Permite:
 *  - assign-to-me (atribuir a conversa ao próprio membro);
 *  - transferir para outro membro (com motivo opcional);
 *  - transferir para outro departamento (com motivo opcional);
 *  - inspecionar a trilha de roteamento (histórico auditável).
 *
 * Gating de UI por permissão (`conversation.assign` / `conversation.transfer`)
 * espelha o backend (`requireRole`) — o controle real é no servidor; aqui só
 * escondemos ações que o papel não pode executar. Sem hex hardcoded: só tokens
 * semânticos do DS v2.
 */
export function RoutingMenu({
  conversationId,
  assignedTo,
  departmentId,
  members: propMembers,
  departments: propDepartments,
  hideHeader = false,
}: {
  conversationId: string;
  assignedTo: string | null;
  departmentId: string | null;
  /** Override (testes). Em produção o menu busca os alvos sozinho ao abrir. */
  members?: readonly AssignableMember[];
  departments?: readonly RoutingDepartment[];
  /** Suprime o header interno quando a seção já tem header colapsável no cockpit. */
  hideHeader?: boolean;
}) {
  const auth = useAuthStore((s) => s.auth);
  const { toast } = useToast();
  const { isMobile } = useBreakpoint();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>('menu');
  const [showHistory, setShowHistory] = useState(false);
  const [reason, setReason] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  const assign = useAssignConversation();
  const transfer = useTransferConversation();
  const pending = assign.isPending || transfer.isPending;

  const role = auth?.role ?? null;
  const allowed = (perm: Permission) => (role ? can(role, perm) : false);
  const canAssign = allowed('conversation.assign');
  const canTransfer = allowed('conversation.transfer');

  // O menu só monta com o cockpit aberto; busca os alvos quando o papel pode
  // rotear (popula tanto os pickers quanto os rótulos de responsável/depto atuais).
  // Props sobrescrevem (testes).
  const targets = useRoutingTargets(canAssign || canTransfer);
  const members: readonly AssignableMember[] =
    propMembers && propMembers.length > 0 ? propMembers : (targets.data?.members ?? []);
  const departments: readonly RoutingDepartment[] =
    propDepartments && propDepartments.length > 0 ? propDepartments : (targets.data?.departments ?? []);

  const membersById = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);
  const departmentsById = useMemo(
    () => new Map(departments.map((d) => [d.id, d])),
    [departments],
  );

  const currentOwner = assignedTo ? membersById.get(assignedTo) : undefined;
  const currentOwnerLabel = currentOwner?.name?.trim() || currentOwner?.email || null;
  const currentDept = departmentId ? departmentsById.get(departmentId) : undefined;

  const isAssignedToMe = Boolean(auth && assignedTo === auth.memberId);
  // Membros de transferência: todos menos o owner atual (evita no-op).
  const transferableMembers = useMemo(
    () => members.filter((m) => m.id !== assignedTo),
    [members, assignedTo],
  );

  // Click-outside só fecha o dropdown desktop; no mobile o Sheet se fecha sozinho.
  useEffect(() => {
    if (!open || isMobile) return;
    function onPointerDown(event: PointerEvent): void {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setMode('menu');
      }
    }
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open, isMobile]);

  function resetAndClose(): void {
    setOpen(false);
    setMode('menu');
    setReason('');
  }

  function handleAssignToMe(): void {
    if (!auth || pending) return;
    assign.mutate(
      { conversationId, memberId: auth.memberId },
      {
        onSuccess: () => {
          toast({ title: 'Conversa atribuída a você', variant: 'success' });
          resetAndClose();
        },
        onError: () => toast({ title: 'Falha ao atribuir', variant: 'error' }),
      },
    );
  }

  function handleTransferMember(memberId: string): void {
    if (pending) return;
    const trimmed = reason.trim();
    transfer.mutate(
      { conversationId, memberId, reason: trimmed || undefined },
      {
        onSuccess: () => {
          toast({ title: 'Conversa transferida', variant: 'success' });
          resetAndClose();
        },
        onError: () => toast({ title: 'Falha ao transferir', variant: 'error' }),
      },
    );
  }

  function handleTransferDepartment(deptId: string): void {
    if (pending) return;
    const trimmed = reason.trim();
    transfer.mutate(
      { conversationId, departmentId: deptId, reason: trimmed || undefined },
      {
        onSuccess: () => {
          toast({ title: 'Conversa transferida de departamento', variant: 'success' });
          resetAndClose();
        },
        onError: () => toast({ title: 'Falha ao transferir', variant: 'error' }),
      },
    );
  }

  // Conteúdo do fluxo de transferência — compartilhado entre o dropdown desktop
  // e o Sheet mobile (só o container muda; mode/reason/queries são os mesmos).
  const transferContent = (
    <>
      {mode === 'menu' && (
        <>
          <MenuButton
            icon={UserPlus}
            label="Transferir para membro"
            disabled={transferableMembers.length === 0}
            touch={isMobile}
            onClick={() => setMode('transfer_member')}
          />
          <MenuButton
            icon={Building2}
            label="Transferir para departamento"
            disabled={departments.length === 0}
            touch={isMobile}
            onClick={() => setMode('transfer_department')}
          />
        </>
      )}

      {mode === 'transfer_member' && (
        <TransferList
          ariaLabel="Selecionar membro destino"
          reason={reason}
          onReasonChange={setReason}
          pending={pending}
          touch={isMobile}
          options={transferableMembers.map((m) => ({
            id: m.id,
            label: m.name?.trim() || m.email,
          }))}
          onPick={handleTransferMember}
          onBack={() => setMode('menu')}
        />
      )}

      {mode === 'transfer_department' && (
        <TransferList
          ariaLabel="Selecionar departamento destino"
          reason={reason}
          onReasonChange={setReason}
          pending={pending}
          touch={isMobile}
          options={departments
            .filter((d) => d.id !== departmentId)
            .map((d) => ({ id: d.id, label: d.name }))}
          onPick={handleTransferDepartment}
          onBack={() => setMode('menu')}
        />
      )}
    </>
  );

  return (
    <section aria-label="Roteamento da conversa" className="flex flex-col gap-3">
      {!hideHeader && (
        <header className="flex items-center gap-2">
          <ArrowRightLeft className="size-4 text-text-low" aria-hidden />
          <h3 className="font-head text-sm font-semibold text-text">Roteamento</h3>
        </header>
      )}

      {/* Estado atual */}
      <div className="rounded-md border border-border-2 bg-surface-2 p-3 font-body text-sm">
        <div className="flex items-center justify-between gap-2">
          <span className="text-text-low">Responsável</span>
          <span className="truncate font-medium text-text">
            {currentOwnerLabel ?? 'Não atribuída'}
          </span>
        </div>
        {departments.length > 0 && (
          <div className="mt-1.5 flex items-center justify-between gap-2">
            <span className="text-text-low">Departamento</span>
            <span className="truncate font-medium text-text">
              {currentDept?.name ?? 'Nenhum'}
            </span>
          </div>
        )}
      </div>

      {/* Ações */}
      {(canAssign || canTransfer) && (
        <div ref={containerRef} className="relative flex flex-col gap-2">
          <div className="flex items-center gap-2">
            {canAssign && (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={isAssignedToMe || pending || !auth}
                loading={assign.isPending}
                leftIcon={<UserCheck className="size-3.5" aria-hidden />}
                onClick={handleAssignToMe}
              >
                {isAssignedToMe ? 'Atribuída a você' : 'Atribuir a mim'}
              </Button>
            )}
            {canTransfer && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                aria-haspopup="menu"
                aria-expanded={open}
                leftIcon={<ArrowRightLeft className="size-3.5" aria-hidden />}
                rightIcon={<ChevronDown className="size-3.5" aria-hidden />}
                onClick={() => {
                  setOpen((v) => !v);
                  setMode('menu');
                }}
              >
                Transferir
              </Button>
            )}
          </div>

          {/* Mobile: o fluxo de transferência vive num bottom-sheet (toque);
              desktop: dropdown ancorado. A lógica/queries são idênticas. */}
          {isMobile
            ? canTransfer && (
                <Sheet
                  open={open}
                  onClose={resetAndClose}
                  title="Transferir conversa"
                  variant="bottom"
                >
                  {transferContent}
                </Sheet>
              )
            : open &&
              canTransfer && (
                <div
                  role="menu"
                  className="z-10 flex flex-col gap-1 rounded-md border border-border bg-surface-2 p-1 shadow-glow-md"
                >
                  {transferContent}
                </div>
              )}
        </div>
      )}

      {/* Histórico (lazy) */}
      <div className="flex flex-col gap-2">
        <button
          type="button"
          aria-expanded={showHistory}
          onClick={() => setShowHistory((v) => !v)}
          className={cn(
            'flex items-center gap-1.5 self-start rounded-sm font-body text-xs text-text-low outline-none',
            'hover:text-text-mid focus-visible:shadow-glow-md',
          )}
        >
          <History className="size-3.5" aria-hidden />
          {showHistory ? 'Ocultar histórico' : 'Ver histórico de roteamento'}
        </button>
        {showHistory && (
          <RoutingHistoryList
            conversationId={conversationId}
            membersById={membersById}
            departmentsById={departmentsById}
            enabled={showHistory}
          />
        )}
      </div>
    </section>
  );
}

function MenuButton({
  icon: Icon,
  label,
  disabled,
  touch = false,
  onClick,
}: {
  icon: typeof UserPlus;
  label: string;
  disabled?: boolean;
  /** Alvo de toque ≥44px e tipografia maior no mobile. */
  touch?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2 rounded-sm text-left font-body outline-none',
        touch ? 'touch-target rounded-md px-3 text-base' : 'px-2 py-1.5 text-sm',
        'text-text-mid hover:bg-surface-3 hover:text-text focus-visible:shadow-glow-md',
        'disabled:cursor-not-allowed disabled:opacity-50',
      )}
    >
      <Icon className={cn('text-text-low', touch ? 'size-5' : 'size-3.5')} aria-hidden />
      <span className="truncate">{label}</span>
    </button>
  );
}

function TransferList({
  ariaLabel,
  options,
  reason,
  onReasonChange,
  pending,
  touch = false,
  onPick,
  onBack,
}: {
  ariaLabel: string;
  options: ReadonlyArray<{ id: string; label: string }>;
  reason: string;
  onReasonChange: (value: string) => void;
  pending: boolean;
  /** Alvos de toque ≥44px e tipografia maior no mobile. */
  touch?: boolean;
  onPick: (id: string) => void;
  onBack: () => void;
}) {
  return (
    <div className="flex flex-col gap-2 p-1">
      <button
        type="button"
        onClick={onBack}
        className={cn(
          'self-start font-body text-text-low underline-offset-4 outline-none hover:text-text-mid focus-visible:shadow-glow-md',
          touch ? 'py-2 text-sm' : 'text-xs',
        )}
      >
        ← Voltar
      </button>
      <input
        type="text"
        value={reason}
        maxLength={500}
        placeholder="Motivo (opcional)"
        aria-label="Motivo da transferência"
        onChange={(e) => onReasonChange(e.target.value)}
        className={cn(
          'w-full rounded-sm border border-border bg-surface-inset px-2 font-body text-text outline-none placeholder:text-text-low focus:border-brand focus:shadow-glow-sm',
          touch ? 'py-2.5 text-base' : 'py-1.5 text-sm',
        )}
      />
      <ul
        role="listbox"
        aria-label={ariaLabel}
        className={cn('overflow-y-auto', touch ? 'max-h-[50dvh]' : 'max-h-48')}
      >
        {options.map((opt) => (
          <li key={opt.id} role="option" aria-selected={false}>
            <button
              type="button"
              disabled={pending}
              onClick={() => onPick(opt.id)}
              className={cn(
                'flex w-full items-center gap-2 rounded-sm text-left font-body outline-none',
                touch ? 'touch-target rounded-md px-3 text-base' : 'px-2 py-1.5 text-sm',
                'text-text-mid hover:bg-surface-3 hover:text-text focus-visible:shadow-glow-md',
                'disabled:cursor-not-allowed disabled:opacity-50',
              )}
            >
              <Check
                className={cn('shrink-0 text-text-low opacity-0', touch ? 'size-5' : 'size-3.5')}
                aria-hidden
              />
              <span className="truncate">{opt.label}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
