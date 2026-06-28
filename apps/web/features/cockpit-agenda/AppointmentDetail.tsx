'use client';

/**
 * Detalhe de um compromisso da agenda (F53-S04). Abre em **drawer/sheet** ao
 * clicar no item da `AgendaSection` (UX §2.3 — não é modal full-screen): Modal
 * contido no desktop, bottom-sheet no mobile (mesmo padrão do `QuickScheduleModal`).
 *
 * Ações (gated `event.edit`): marcar **Em andamento** / **Concluído**, **Adiar**
 * (status `postponed` + nova data futura), **Cancelar** (confirmação proporcional,
 * UX §2.9 — passo duplo inline). E **Abrir conversa** → navega à conversa de origem.
 *
 * Reuso: mutações via `useUpdateEvent`/`useCancelEvent` de features/calendar; helpers
 * de data (`toLocalParts`/`fromLocalParts`/`addMinutes`) de S03. Sem hex hardcoded;
 * feedback imediato (botões loading + toast). Alvos ≥ 44px no mobile.
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, Calendar, Check, MessageSquare, Play, X } from 'lucide-react';
import { Button, Input, Modal, useToast } from '@hm/ui';
import { cn } from '@hm/ui/cn';
import { Sheet } from '@/shared/components/Sheet';
import { useBreakpoint } from '@/shared/hooks/useBreakpoint';
import { ApiError } from '@/shared/lib/api-client';
import { useCancelEvent, useUpdateEvent } from '@/features/calendar/queries';
import type { UpdateEventInput } from '@/features/calendar/types';
import { addMinutes, fromLocalParts, toLocalParts, DEFAULT_DURATION_MIN } from './quickDates';
import {
  formatWhen,
  priorityBadgeClass,
  priorityLabel,
  statusBadgeClass,
  statusLabel,
  typeIcon,
  typeLabel,
  type AgendaEvent,
} from './AgendaSection';

/** Status-destino aceitos pela API via PUT (cancel tem canal próprio). */
type TransitionStatus = 'scheduled' | 'confirmed' | 'in_progress' | 'postponed' | 'completed';

interface AgendaUpdatePatch {
  readonly status: TransitionStatus;
  readonly startAt?: string;
  readonly endAt?: string;
}

export interface AppointmentDetailProps {
  /** Compromisso selecionado, ou `null` quando nada está aberto. */
  readonly event: AgendaEvent | null;
  /** Visível quando `true`. */
  readonly open: boolean;
  /** `event.edit` — habilita transições/cancelar/adiar. */
  readonly canEdit: boolean;
  /** Fecha o drawer/sheet. */
  onClose: () => void;
}

export function AppointmentDetail(props: AppointmentDetailProps): React.JSX.Element | null {
  const { event, open, canEdit, onClose } = props;
  const { isMobile } = useBreakpoint();
  const { toast } = useToast();
  const router = useRouter();
  const update = useUpdateEvent();
  const cancel = useCancelEvent();

  // Sub-fluxos locais: adiamento (pickers) e confirmação de cancelamento.
  const [postponing, setPostponing] = useState(false);
  const [pDate, setPDate] = useState('');
  const [pTime, setPTime] = useState('');
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Reset dos sub-fluxos sempre que o compromisso (ou a visibilidade) muda.
  useEffect(() => {
    setPostponing(false);
    setConfirmingCancel(false);
    setErrorMsg(null);
    if (event) {
      const parts = toLocalParts(event.startAt);
      setPDate(parts.date);
      setPTime(parts.time);
    }
  }, [event, open]);

  if (!event) return null;

  const pending = update.isPending || cancel.isPending;
  const terminal = event.status === 'completed' || event.status === 'cancelled';
  const Icon = typeIcon(event.type);

  function describe(err: unknown): string {
    if (err instanceof ApiError) return err.issues?.[0]?.message ?? err.message;
    return 'Não foi possível concluir a ação. Aguarde um instante e tente novamente.';
  }

  function applyTransition(patch: AgendaUpdatePatch, successMsg: string): void {
    if (!event) return;
    setErrorMsg(null);
    // Único ponto de estreitamento: a API (F53-S02) aceita `in_progress`/`postponed`,
    // mas `UpdateEventInput` (features/calendar — fronteira proibida) ainda não os
    // declara. O patch é montado de forma estrita acima (AgendaUpdatePatch).
    update.mutate(
      { id: event.masterId, patch: patch as unknown as UpdateEventInput },
      {
        onSuccess: () => {
          toast({ variant: 'success', title: successMsg });
          onClose();
        },
        onError: (err) => {
          setErrorMsg(describe(err));
          toast({ variant: 'error', title: 'Ação não concluída.' });
        },
      },
    );
  }

  function confirmPostpone(): void {
    const startAt = fromLocalParts(pDate, pTime);
    if (!startAt) {
      setErrorMsg('Informe uma nova data e hora válidas para adiar.');
      return;
    }
    if (new Date(startAt).getTime() <= Date.now()) {
      setErrorMsg('Para adiar, escolha uma data e hora no futuro.');
      return;
    }
    applyTransition(
      { status: 'postponed', startAt, endAt: addMinutes(startAt, DEFAULT_DURATION_MIN) },
      'Compromisso adiado.',
    );
  }

  function doCancel(): void {
    if (!event) return;
    setErrorMsg(null);
    cancel.mutate(event.masterId, {
      onSuccess: () => {
        toast({ variant: 'success', title: 'Compromisso cancelado.' });
        onClose();
      },
      onError: (err) => {
        setErrorMsg(describe(err));
        toast({ variant: 'error', title: 'Não foi possível cancelar.' });
      },
    });
  }

  function openConversation(): void {
    if (!event?.conversationId) return;
    onClose();
    router.push(`/conversations/${event.conversationId}`);
  }

  const ctaSize = isMobile ? 'lg' : 'md';

  const body = (
    <div className="flex flex-col gap-4">
      {/* Cabeçalho: tipo + título + quando + badges */}
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-md bg-surface-3 text-text-mid">
          <Icon className="size-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="font-head text-base font-semibold text-text">{event.title}</h3>
          <p className="font-body text-sm text-text-mid">{formatWhen(event.startAt, new Date())}</p>
          <p className="mt-2 flex flex-wrap items-center gap-1.5">
            <span
              className={cn(
                'inline-flex items-center rounded-pill border px-2 py-0.5 font-body text-xs font-medium leading-none',
                statusBadgeClass(event.status),
              )}
            >
              {statusLabel(event.status)}
            </span>
            <span
              className={cn(
                'inline-flex items-center rounded-pill border px-2 py-0.5 font-body text-xs font-medium leading-none',
                priorityBadgeClass(event.priority),
              )}
            >
              Prioridade {priorityLabel(event.priority).toLowerCase()}
            </span>
            <span className="font-body text-xs text-text-low">{typeLabel(event.type)}</span>
          </p>
        </div>
      </div>

      {event.description ? (
        <p className="rounded-md border border-border-2 bg-surface-2 px-3 py-2.5 font-body text-sm text-text-mid">
          {event.description}
        </p>
      ) : null}

      {errorMsg ? (
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-md border border-danger/40 bg-danger/10 px-3 py-2.5"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden />
          <span className="font-body text-sm text-text-mid">{errorMsg}</span>
        </div>
      ) : null}

      {/* Adiamento: pickers de nova data/hora (futuro) */}
      {postponing ? (
        <div className="flex flex-col gap-3 rounded-md border border-border-2 bg-surface-2 p-3">
          <span className="font-body text-xs font-semibold text-text">Nova data e hora</span>
          <div className="flex gap-3">
            <label className="flex flex-1 flex-col gap-1.5">
              <span className="font-body text-xs text-text-low">Data</span>
              <Input
                type="date"
                size={isMobile ? 'lg' : 'md'}
                value={pDate}
                onChange={(e) => setPDate(e.target.value)}
              />
            </label>
            <label className="flex flex-1 flex-col gap-1.5">
              <span className="font-body text-xs text-text-low">Hora</span>
              <Input
                type="time"
                size={isMobile ? 'lg' : 'md'}
                value={pTime}
                onChange={(e) => setPTime(e.target.value)}
              />
            </label>
          </div>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              size={ctaSize}
              variant="ghost"
              disabled={pending}
              onClick={() => setPostponing(false)}
            >
              Voltar
            </Button>
            <Button
              type="button"
              size={ctaSize}
              variant="secondary"
              loading={update.isPending}
              onClick={confirmPostpone}
            >
              Confirmar adiamento
            </Button>
          </div>
        </div>
      ) : null}

      {/* Confirmação de cancelamento (UX §2.9 — passo duplo proporcional) */}
      {confirmingCancel ? (
        <div className="flex flex-col gap-3 rounded-md border border-danger/40 bg-danger/10 p-3">
          <span className="font-body text-sm text-text">
            Cancelar este compromisso? Esta ação não pode ser desfeita.
          </span>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              size={ctaSize}
              variant="ghost"
              disabled={pending}
              onClick={() => setConfirmingCancel(false)}
            >
              Voltar
            </Button>
            <Button
              type="button"
              size={ctaSize}
              variant="danger"
              loading={cancel.isPending}
              onClick={doCancel}
            >
              Cancelar compromisso
            </Button>
          </div>
        </div>
      ) : null}

      {/* Ações de transição (gated event.edit; ocultas em estado terminal) */}
      {canEdit && !terminal && !postponing && !confirmingCancel ? (
        <div className="flex flex-wrap gap-2">
          {event.status !== 'in_progress' ? (
            <Button
              type="button"
              size={ctaSize}
              variant="secondary"
              leftIcon={<Play className="size-3.5" aria-hidden />}
              loading={update.isPending}
              onClick={() => applyTransition({ status: 'in_progress' }, 'Compromisso em andamento.')}
            >
              Iniciar
            </Button>
          ) : null}
          <Button
            type="button"
            size={ctaSize}
            variant="secondary"
            leftIcon={<Check className="size-3.5" aria-hidden />}
            loading={update.isPending}
            onClick={() => applyTransition({ status: 'completed' }, 'Compromisso concluído.')}
          >
            Concluir
          </Button>
          <Button
            type="button"
            size={ctaSize}
            variant="ghost"
            leftIcon={<Calendar className="size-3.5" aria-hidden />}
            disabled={pending}
            onClick={() => setPostponing(true)}
          >
            Adiar
          </Button>
          <Button
            type="button"
            size={ctaSize}
            variant="ghost"
            leftIcon={<X className="size-3.5" aria-hidden />}
            disabled={pending}
            onClick={() => setConfirmingCancel(true)}
          >
            Cancelar
          </Button>
        </div>
      ) : null}

      {/* Abrir conversa de origem (sempre disponível quando houver vínculo) */}
      {event.conversationId ? (
        <Button
          type="button"
          size={ctaSize}
          variant="outline"
          className="self-start"
          leftIcon={<MessageSquare className="size-3.5" aria-hidden />}
          disabled={pending}
          onClick={openConversation}
        >
          Abrir conversa
        </Button>
      ) : null}
    </div>
  );

  const title = 'Compromisso';

  if (isMobile) {
    return (
      <Sheet open={open} onClose={onClose} variant="bottom" title={title}>
        {body}
      </Sheet>
    );
  }

  return (
    <Modal open={open} onClose={onClose} title={title} className="max-w-md">
      {body}
    </Modal>
  );
}
