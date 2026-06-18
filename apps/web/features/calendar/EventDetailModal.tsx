'use client';

import { useEffect, useState } from 'react';
import { CalendarClock, MapPin, Link2, Repeat, Users, Check, X as XIcon, HelpCircle } from 'lucide-react';
import { Button, Modal, useToast } from '@hm/ui';
import { cn } from '@hm/ui/cn';
import { Sheet } from '@/shared/components/Sheet';
import { useBreakpoint } from '@/shared/hooks/useBreakpoint';
import { useCalendarMembers, useCancelEvent, useEventDetail, useRsvpEvent } from './queries';
import { describeRecurrence, type EventParticipantRow, type EventRow } from './types';

const STATUS_LABEL: Record<string, string> = {
  scheduled: 'Agendado',
  confirmed: 'Confirmado',
  cancelled: 'Cancelado',
  completed: 'Concluído',
};

const RSVP_LABEL: Record<string, string> = {
  accepted: 'Confirmou',
  declined: 'Recusou',
  tentative: 'Talvez',
  pending: 'Pendente',
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
  /** Id do membro logado, para destacar o próprio RSVP. */
  readonly myMemberId?: string | undefined;
}

export function EventDetailModal(props: EventDetailModalProps): React.JSX.Element {
  const { toast } = useToast();
  const { isMobile } = useBreakpoint();
  const detail = useEventDetail(props.eventId);
  const membersQuery = useCalendarMembers();
  const cancel = useCancelEvent();
  const rsvp = useRsvpEvent();
  const event = detail.data?.event ?? null;
  const participants = detail.data?.participants ?? [];
  const memberName = new Map((membersQuery.data?.members ?? []).map((m) => [m.id, m.name?.trim() || m.email]));
  const [confirmingCancel, setConfirmingCancel] = useState(false);

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

  function setMyRsvp(value: 'accepted' | 'declined' | 'tentative'): void {
    if (!event) return;
    rsvp.mutate(
      { eventId: event.id, rsvp: value },
      {
        onSuccess: () => toast({ variant: 'success', title: 'Resposta registrada.' }),
        onError: (e) => toast({ variant: 'error', title: e.message }),
      },
    );
  }

  const isCancelled = event?.status === 'cancelled';
  const recurrenceText = event ? describeRecurrence(event.recurrenceRule, event.recurrenceUntil) : null;
  const myParticipant = props.myMemberId
    ? participants.find((p) => p.memberId === props.myMemberId)
    : undefined;

  const footer =
    props.canEdit && event && !isCancelled ? (
      confirmingCancel ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-text-mid">
            Cancelar este evento{recurrenceText ? ' (a série inteira)' : ''}? Os participantes serão
            notificados.
          </p>
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
            <CalendarClock className="size-4 text-text-low" />
            <span>
              {fmt(event.startAt)} — {fmt(event.endAt)}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-md border border-border-subtle bg-surface-raised px-2 py-0.5 text-xs text-text-mid">
              {STATUS_LABEL[event.status] ?? event.status}
            </span>
            {recurrenceText && (
              <span className="inline-flex items-center gap-1 rounded-md border border-border-subtle bg-surface-raised px-2 py-0.5 text-xs text-text-mid">
                <Repeat className="size-3" /> {recurrenceText}
              </span>
            )}
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

          {participants.length > 0 && (
            <div className="flex flex-col gap-2 border-t border-border-2 pt-3">
              <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-text-low">
                <Users className="size-3.5" /> Participantes
              </span>
              <ul className="flex flex-col gap-1">
                {participants.map((p) => (
                  <ParticipantRow key={p.id} participant={p} name={p.memberId ? memberName.get(p.memberId) : null} />
                ))}
              </ul>
            </div>
          )}

          {/* Meu RSVP (se sou participante e o evento está ativo) */}
          {myParticipant && !isCancelled && (
            <div className="flex flex-col gap-1.5 border-t border-border-2 pt-3">
              <span className="text-xs text-text-low">Você vai?</span>
              <div className="flex gap-2">
                <RsvpButton
                  active={myParticipant.rsvp === 'accepted'}
                  onClick={() => setMyRsvp('accepted')}
                  disabled={rsvp.isPending}
                  icon={<Check className="size-4" />}
                  label="Sim"
                  tone="success"
                />
                <RsvpButton
                  active={myParticipant.rsvp === 'tentative'}
                  onClick={() => setMyRsvp('tentative')}
                  disabled={rsvp.isPending}
                  icon={<HelpCircle className="size-4" />}
                  label="Talvez"
                  tone="warn"
                />
                <RsvpButton
                  active={myParticipant.rsvp === 'declined'}
                  onClick={() => setMyRsvp('declined')}
                  disabled={rsvp.isPending}
                  icon={<XIcon className="size-4" />}
                  label="Não"
                  tone="danger"
                />
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );

  const open = Boolean(props.eventId);
  const title = event?.title ?? 'Evento';

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

function ParticipantRow({
  participant,
  name,
}: {
  participant: EventParticipantRow;
  name: string | null | undefined;
}): React.JSX.Element {
  const label = name ?? (participant.contactId ? 'Contato' : 'Participante');
  const rsvpLabel = participant.rsvp ? RSVP_LABEL[participant.rsvp] : null;
  return (
    <li className="flex items-center justify-between gap-2 text-text-mid">
      <span className="truncate">
        {label}
        {participant.role === 'organizer' ? ' · organizador' : ''}
      </span>
      {rsvpLabel && (
        <span
          className={cn(
            'shrink-0 text-xs',
            participant.rsvp === 'accepted'
              ? 'text-success'
              : participant.rsvp === 'declined'
                ? 'text-danger'
                : 'text-text-low',
          )}
        >
          {rsvpLabel}
        </span>
      )}
    </li>
  );
}

function RsvpButton({
  active,
  onClick,
  disabled,
  icon,
  label,
  tone,
}: {
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
  icon: React.ReactNode;
  label: string;
  tone: 'success' | 'warn' | 'danger';
}): React.JSX.Element {
  const toneRing =
    tone === 'success' ? 'border-success text-success' : tone === 'warn' ? 'border-warn text-warn' : 'border-danger text-danger';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={cn(
        'flex flex-1 items-center justify-center gap-1.5 rounded-md border px-2 py-1.5 text-sm outline-none transition-colors duration-200 focus-visible:shadow-glow-md disabled:opacity-50',
        active
          ? `bg-surface-2 ${toneRing}`
          : 'border-border bg-surface-2 text-text-mid hover:text-text',
      )}
    >
      {icon}
      {label}
    </button>
  );
}
