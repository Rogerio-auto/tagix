'use client';

import { CalendarClock, MapPin, Link2 } from 'lucide-react';
import { Button, Modal, useToast } from '@hm/ui';
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
  const detail = useEventDetail(props.eventId);
  const cancel = useCancelEvent();
  const event = detail.data?.event ?? null;

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

  return (
    <Modal
      open={Boolean(props.eventId)}
      onClose={props.onClose}
      title={event?.title ?? 'Evento'}
      footer={
        props.canEdit && event && !isCancelled ? (
          <div className="flex justify-between gap-2">
            <Button variant="danger" onClick={doCancel} disabled={cancel.isPending}>
              Cancelar evento
            </Button>
            <Button variant="secondary" onClick={() => props.onEdit(event)}>
              Editar
            </Button>
          </div>
        ) : (
          <div className="flex justify-end">
            <Button variant="ghost" onClick={props.onClose}>
              Fechar
            </Button>
          </div>
        )
      }
    >
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
    </Modal>
  );
}
