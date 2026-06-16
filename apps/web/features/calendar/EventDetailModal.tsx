'use client';

import { useEffect, useState } from 'react';
import { CalendarClock, MapPin, Link2 } from 'lucide-react';
import { Button, Modal, useToast } from '@hm/ui';
import { Sheet } from '@/shared/components/Sheet';
import { useBreakpoint } from '@/shared/hooks/useBreakpoint';
import { useCancelEvent, useEventDetail } from './queries';
import type { EventRow } from './types';

const STATUS_LABEL: Record<string, string> = {
  scheduled: 'Agendado',
  confirmed: 'Confirmado',
  cancelled: 'Cancelado',
  completed: 'Concluído',
};

function fmt(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export interface EventDetailModalProps {
  readonly eventId: string | null;
  readonly onClose: () => void;
  readonly canEdit: boolean;
  readonly onEdit: (event: EventRow) => void;
}

export function EventDetailModal(props: EventDetailModalProps): React.JSX.Element {
  const { toast } = useToast();
  const { isMobile } = useBreakpoint();
  const detail = useEventDetail(props.eventId);
  const cancel = useCancelEvent();
  const event = detail.data?.event ?? null;
  // Confirmação inline proporcional (UX §2.9) antes do cancelamento destrutivo.
  const [confirmingCancel, setConfirmingCancel] = useState(false);

  // Reseta a confirmação a cada (re)abertura para outro evento.
  useEffect(() => {
    setConfirmingCancel(false);
  }, [props.eventId]);

  function doCancel(): void {
    if (!event) return;
    cancel.mutate(event.id, {
      onSuccess: () => {
        toast({ variant: 'success', title: 'Evento cancelado.' });
        props.onClose();
      },
      onError: (e) => toast({ variant: 'error', title: e.message }),
    });
  }

  const isCancelled = event?.status === 'cancelled';

  const footer =
    props.canEdit && event && !isCancelled ? (
      confirmingCancel ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-text-mid">Cancelar este evento? Os participantes serão notificados.</p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirmingCancel(false)} disabled={cancel.isPending}>
              Voltar
            </Button>
            <Button variant="danger" onClick={doCancel} disabled={cancel.isPending} loading={cancel.isPending}>
              Cancelar evento
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex justify-between gap-2">
          <Button variant="danger" onClick={() => setConfirmingCancel(true)}>
            Cancelar evento
          </Button>
          <Button variant="secondary" onClick={() => props.onEdit(event)}>
            Editar
          </Button>
        </div>
      )
    ) : (
      <div className="flex justify-end">
        <Button variant="ghost" onClick={props.onClose}>
          Fechar
        </Button>
      </div>
    );

  const body = (
    <>
      {detail.isLoading ? (
        <p className="text-sm text-text-low">Carregando…</p>
      ) : !event ? (
        <p className="text-sm text-text-low">Evento não encontrado.</p>
      ) : (
        <div className="flex flex-col gap-3 text-sm">
          <div className="flex items-center gap-2 text-text">
            <CalendarClock className="size-4 text-brand" />
            <span>
              {fmt(event.startAt)} — {fmt(event.endAt)}
            </span>
          </div>
          <div>
            <span className="rounded-md border border-border-subtle bg-surface-raised px-2 py-0.5 text-xs text-text-mid">
              {STATUS_LABEL[event.status] ?? event.status}
            </span>
          </div>
          {event.location && (
            <div className="flex items-center gap-2 text-text-mid">
              <MapPin className="size-4" /> {event.location}
            </div>
          )}
          {event.meetingUrl && (
            <a
              href={event.meetingUrl}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-2 text-brand hover:underline"
            >
              <Link2 className="size-4" /> Entrar na reunião
            </a>
          )}
          {event.description && <p className="text-text-mid">{event.description}</p>}
        </div>
      )}
    </>
  );

  const open = Boolean(props.eventId);
  const title = event?.title ?? 'Evento';

  // Mobile: detalhe em bottom-sheet (MOBILE_UX §2.3 — drawer/modal → sheet).
  if (isMobile) {
    return (
      <Sheet open={open} onClose={props.onClose} variant="bottom" title={title} footer={footer}>
        {body}
      </Sheet>
    );
  }

  return (
    <Modal open={open} onClose={props.onClose} title={title} footer={footer}>
      {body}
    </Modal>
  );
}
