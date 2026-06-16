'use client';

import { useEffect, useState } from 'react';
import { Button, Input, Modal, useToast } from '@hm/ui';
import { Sheet } from '@/shared/components/Sheet';
import { useBreakpoint } from '@/shared/hooks/useBreakpoint';
import { useCreateEvent, useUpdateEvent } from './queries';
import type { CalendarRow, EventRow, EventType } from './types';

const EVENT_TYPES: ReadonlyArray<{ value: EventType; label: string }> = [
  { value: 'meeting', label: 'Reunião' },
  { value: 'demo', label: 'Demo' },
  { value: 'follow_up', label: 'Follow-up' },
  { value: 'task', label: 'Tarefa' },
  { value: 'reminder', label: 'Lembrete' },
  { value: 'other', label: 'Outro' },
];

/** Converte ISO → valor para <input type="datetime-local"> (no tz local do browser). */
function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const off = d.getTimezoneOffset();
  const local = new Date(d.getTime() - off * 60_000);
  return local.toISOString().slice(0, 16);
}

/** datetime-local (local) → ISO com offset, para a API persistir em UTC. */
function fromLocalInput(value: string): string {
  return new Date(value).toISOString();
}

export interface EventFormProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly calendars: readonly CalendarRow[];
  /** Calendar pré-selecionado (selector da página). */
  readonly defaultCalendarId?: string;
  /** Horário clicado no grid (slot vazio) → preenche start/end. */
  readonly defaultStart?: string | null;
  readonly defaultEnd?: string | null;
  /** Edição: evento existente. Ausente = criação. */
  readonly event?: EventRow | null;
}

export function EventForm(props: EventFormProps): React.JSX.Element {
  const { toast } = useToast();
  const { isMobile } = useBreakpoint();
  const create = useCreateEvent();
  const update = useUpdateEvent();
  const isEdit = Boolean(props.event);

  const [calendarId, setCalendarId] = useState('');
  const [title, setTitle] = useState('');
  const [type, setType] = useState<EventType>('meeting');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [location, setLocation] = useState('');
  const [meetingUrl, setMeetingUrl] = useState('');
  const [description, setDescription] = useState('');

  useEffect(() => {
    if (!props.open) return;
    const ev = props.event;
    setCalendarId(ev?.calendarId ?? props.defaultCalendarId ?? props.calendars[0]?.id ?? '');
    setTitle(ev?.title ?? '');
    setType(ev?.type ?? 'meeting');
    setStart(toLocalInput(ev?.startAt ?? props.defaultStart ?? null));
    setEnd(toLocalInput(ev?.endAt ?? props.defaultEnd ?? null));
    setLocation(ev?.location ?? '');
    setMeetingUrl(ev?.meetingUrl ?? '');
    setDescription(ev?.description ?? '');
  }, [props.open, props.event, props.defaultCalendarId, props.defaultStart, props.defaultEnd, props.calendars]);

  const pending = create.isPending || update.isPending;
  const valid = title.trim().length >= 1 && calendarId && start && end && start < end;

  function submit(): void {
    if (!valid) {
      toast({ variant: 'error', title: 'Preencha título, calendário e horários válidos.' });
      return;
    }
    const common = {
      title: title.trim(),
      startAt: fromLocalInput(start),
      endAt: fromLocalInput(end),
      type,
      description: description.trim() || null,
      location: location.trim() || null,
      meetingUrl: meetingUrl.trim() || null,
    };
    if (isEdit && props.event) {
      update.mutate(
        { id: props.event.id, patch: common },
        {
          onSuccess: () => {
            toast({ variant: 'success', title: 'Evento atualizado.' });
            props.onClose();
          },
          onError: (e) => toast({ variant: 'error', title: e.message }),
        },
      );
    } else {
      create.mutate(
        { calendarId, ...common },
        {
          onSuccess: () => {
            toast({ variant: 'success', title: 'Evento criado.' });
            props.onClose();
          },
          onError: (e) => toast({ variant: 'error', title: e.message }),
        },
      );
    }
  }

  const formTitle = isEdit ? 'Editar evento' : 'Novo evento';
  const footer = (
    <div className="flex justify-end gap-2">
      <Button variant="ghost" onClick={props.onClose} disabled={pending}>
        Cancelar
      </Button>
      <Button variant="primary" onClick={submit} disabled={!valid || pending} loading={pending}>
        {isEdit ? 'Salvar' : 'Criar'}
      </Button>
    </div>
  );

  const body = (
    <div className="flex flex-col gap-3">
        <Field label="Título">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Reunião com…" />
        </Field>

        <div className="flex gap-3">
          <Field label="Calendário" className="flex-1">
            <Select value={calendarId} onChange={setCalendarId} disabled={isEdit}>
              {props.calendars.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Tipo" className="flex-1">
            <Select value={type} onChange={(v) => setType(v as EventType)}>
              {EVENT_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="flex gap-3">
          <Field label="Início" className="flex-1">
            <Input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} />
          </Field>
          <Field label="Fim" className="flex-1">
            <Input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} />
          </Field>
        </div>

        <Field label="Local (opcional)">
          <Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Sala / endereço" />
        </Field>
        <Field label="Link da reunião (opcional)">
          <Input value={meetingUrl} onChange={(e) => setMeetingUrl(e.target.value)} placeholder="https://…" />
        </Field>
        <Field label="Descrição (opcional)">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            className="w-full resize-none rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-text outline-none focus-visible:border-border-brand"
          />
        </Field>
      </div>
  );

  // Mobile: form em bottom-sheet (denso → full) na zona do polegar (MOBILE_UX §2.3).
  // Desktop: mantém o Modal de wizard/criação (UX §2.3).
  if (isMobile) {
    return (
      <Sheet open={props.open} onClose={props.onClose} variant="full" title={formTitle} footer={footer}>
        {body}
      </Sheet>
    );
  }

  return (
    <Modal open={props.open} onClose={props.onClose} title={formTitle} footer={footer}>
      {body}
    </Modal>
  );
}

function Field({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <label className={`flex flex-col gap-1.5 ${className ?? ''}`}>
      <span className="text-xs text-text-low">{label}</span>
      {children}
    </label>
  );
}

function Select({
  value,
  onChange,
  disabled,
  children,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className="h-10 rounded-md border border-border bg-surface-2 px-3 text-sm text-text outline-none focus-visible:border-border-brand disabled:opacity-40"
    >
      {children}
    </select>
  );
}
