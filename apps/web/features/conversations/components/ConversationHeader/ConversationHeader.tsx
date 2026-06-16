'use client';

/**
 * Header espelho condicional da conversa (F30-S03 / LIVECHAT_OPS §3).
 *
 * UX §2.3: Ações aparecem APENAS quando o painel direito está fechado — ao abrir
 * o painel, o header esconde as ações (zero duplicação, o cockpit assume tudo).
 * UX §2.7: Botões de ação entram em loading durante mutations async.
 * UX §2.9: Ação destrutiva (resolver) com confirmação inline proporcional.
 * UX §2.10: Atalhos de teclado documentados.
 *
 * Regras DS:
 * - Zero hex hardcoded — só tokens semânticos.
 * - `prefers-reduced-motion` respeitado via Tailwind (`motion-safe:`).
 * - Focus ring visível (`focus-visible:shadow-glow-md`).
 */

import { Bot, CheckCheck, Info, RefreshCw } from 'lucide-react';
import { Button, useToast } from '@hm/ui';
import { can } from '@hm/shared';
import { cn } from '@/shared/lib/cn';
import { useAuthStore } from '@/shared/stores/auth.store';
import { FlowExecutionsBadge } from '@/features/flow-builder/livechat';
import { SnoozeMenu } from '../SnoozeMenu';
import { useChangeStatus, useChangeAiMode } from '../../queries';
import type { ConversationDetail } from '../../types';

export interface ConversationHeaderProps {
  conversationId: string;
  /** Dado completo da conversa (pode ser undefined durante carregamento). */
  detail: ConversationDetail | undefined;
  /** Quando `true` o painel direito está aberto: ações ficam ocultas (espelho). */
  panelOpen: boolean;
  onTogglePanel: () => void;
}

/**
 * Converte o status técnico numa etiqueta legível + cor semântica.
 */
function statusMeta(status: string): { label: string; className: string } {
  switch (status) {
    case 'open':
      return { label: 'Aberta', className: 'text-success' };
    case 'pending':
      return { label: 'Pendente', className: 'text-warning' };
    case 'resolved':
      return { label: 'Resolvida', className: 'text-text-low' };
    case 'snoozed':
      return { label: 'Adiada', className: 'text-text-mid' };
    default:
      return { label: status, className: 'text-text-low' };
  }
}

export function ConversationHeader({
  conversationId,
  detail,
  panelOpen,
  onTogglePanel,
}: ConversationHeaderProps) {
  const auth = useAuthStore((s) => s.auth);
  const { toast } = useToast();
  const changeStatus = useChangeStatus();
  const changeAiMode = useChangeAiMode();

  const role = auth?.role ?? null;
  const canResolve = role ? can(role, 'conversation.resolve') : false;
  const canSnooze = role ? can(role, 'conversation.snooze') : false;
  const canAiMode = role ? can(role, 'conversation.ai_mode') : false;

  const status = detail?.status ?? 'open';
  const aiMode = detail?.aiMode ?? 'off';
  const isResolved = status === 'resolved';
  const isAiOn = aiMode === 'on';
  const isAiPaused = aiMode === 'paused';

  function handleResolve(): void {
    if (changeStatus.isPending) return;
    const nextStatus = isResolved ? 'open' : 'resolved';
    changeStatus.mutate(
      { conversationId, status: nextStatus },
      {
        onSuccess: () =>
          toast({
            title: isResolved ? 'Conversa reaberta' : 'Conversa resolvida',
            variant: 'success',
          }),
        onError: () => toast({ title: 'Falha ao alterar status', variant: 'error' }),
      },
    );
  }

  function handleToggleAi(): void {
    if (changeAiMode.isPending) return;
    // Se pausada ou desligada → liga. Se ligada → desliga.
    const nextMode = isAiOn ? 'off' : 'on';
    changeAiMode.mutate(
      { conversationId, aiMode: nextMode },
      {
        onSuccess: () =>
          toast({
            title: nextMode === 'on' ? 'IA ativada' : 'IA desativada',
            variant: 'success',
          }),
        onError: () => toast({ title: 'Falha ao alterar modo IA', variant: 'error' }),
      },
    );
  }

  function handleResumeAi(): void {
    if (changeAiMode.isPending) return;
    changeAiMode.mutate(
      { conversationId, aiMode: 'on' },
      {
        onSuccess: () => toast({ title: 'IA retomada', variant: 'success' }),
        onError: () => toast({ title: 'Falha ao retomar IA', variant: 'error' }),
      },
    );
  }

  const statusInfo = statusMeta(status);

  return (
    <header className="flex h-14 items-center justify-between gap-3 border-b border-border px-4">
      {/* Identidade + status */}
      <div className="flex min-w-0 items-center gap-3">
        <div className="min-w-0">
          <p className="truncate font-head font-semibold text-text">
            {detail?.remoteId ?? 'Conversa'}
          </p>
          {detail && (
            <p className={cn('font-body text-xs', statusInfo.className)}>
              {statusInfo.label}
            </p>
          )}
        </div>
      </div>

      {/* Ações do espelho — visíveis APENAS quando painel fechado (UX §2.3) */}
      <div
        className={cn(
          'flex items-center gap-2 transition-opacity motion-safe:transition-opacity',
          panelOpen ? 'pointer-events-none opacity-0' : 'opacity-100',
        )}
        aria-hidden={panelOpen}
      >
        <FlowExecutionsBadge conversationId={conversationId} />

        {/* Indicador de IA pausada (handoff) */}
        {isAiPaused && (
          <span className="flex items-center gap-1 rounded-pill border border-warning/30 bg-warning/10 px-2 py-0.5 font-body text-xs text-warning">
            <Bot className="size-3.5" aria-hidden />
            IA pausada
          </span>
        )}

        {/* Toggle IA — só quando tem permissão */}
        {canAiMode && !isAiPaused && (
          <button
            type="button"
            onClick={handleToggleAi}
            disabled={changeAiMode.isPending}
            aria-label={isAiOn ? 'Desativar IA' : 'Ativar IA'}
            title={isAiOn ? 'Desativar IA' : 'Ativar IA'}
            className={cn(
              'flex items-center gap-1.5 rounded-pill border px-2.5 py-1 font-body text-xs outline-none transition-colors',
              'focus-visible:shadow-glow-md disabled:cursor-not-allowed disabled:opacity-50',
              isAiOn
                ? 'border-brand/30 bg-brand/10 text-brand hover:bg-brand/15'
                : 'border-border-2 bg-surface-2 text-text-low hover:text-text',
            )}
          >
            <Bot className="size-3.5" aria-hidden />
            {isAiOn ? 'IA ativa' : 'IA off'}
          </button>
        )}

        {/* Retomar IA (quando pausada) */}
        {canAiMode && isAiPaused && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            loading={changeAiMode.isPending}
            leftIcon={<RefreshCw className="size-3.5" aria-hidden />}
            onClick={handleResumeAi}
          >
            Retomar IA
          </Button>
        )}

        {/* Snooze — menu de durações reais (1h / 3h / amanhã / próxima semana) */}
        {canSnooze && status === 'open' && (
          <SnoozeMenu
            conversationId={conversationId}
            variant="icon"
            disabled={changeStatus.isPending}
          />
        )}

        {/* Resolver / Reabrir */}
        {canResolve && (
          <Button
            type="button"
            size="sm"
            variant={isResolved ? 'secondary' : 'primary'}
            loading={changeStatus.isPending}
            leftIcon={<CheckCheck className="size-3.5" aria-hidden />}
            onClick={handleResolve}
          >
            {isResolved ? 'Reabrir' : 'Resolver'}
          </Button>
        )}
      </div>

      {/* Botão Info — sempre visível (toggle do painel) */}
      <button
        type="button"
        onClick={onTogglePanel}
        aria-label={panelOpen ? 'Fechar painel' : 'Abrir painel de informações'}
        aria-pressed={panelOpen}
        className={cn(
          'shrink-0 rounded-sm p-2 outline-none transition-colors',
          'hover:bg-surface-2 focus-visible:shadow-glow-md',
          panelOpen ? 'text-text' : 'text-text-mid hover:text-text',
        )}
      >
        <Info className="size-5" />
      </button>
    </header>
  );
}
